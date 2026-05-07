"""CareLinker 加算チェッカー判定エンジン（外販MVP alpha2）

マスタ（regulatory_master/）と事業所ステータス（tenant_data/status/）を結合して
加算ごとの算定可否を判定し、経営者・管理者向けのMarkdown レポートを出力する。

使い方（公開デモ・DEMO事業所コードでの例）:
    python judge_kasan.py --service kyotaku_shien --office DEMO-0006
    python judge_kasan.py --domain kaigo --service houmon_kaigo --office DEMO-0005 \\
        --tenant-status ../tenant_data/demo_status/DEMO-0005/tenant_status.json \\
        --staff-data ../tenant_data/demo_staff/DEMO-0005/staff.json \\
        --report-md ../out/report.md
    python judge_kasan.py --service tsusho_kaigo --office DEMO-0004 --json out.json
"""
import argparse
import json
import sys
import io
from pathlib import Path
from datetime import datetime

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "regulatory_master" / "service_registry.json"
DEFAULT_STATUS_DIR = ROOT / "tenant_data" / "status"

STATUS_LABELS = {"clear": "✅ 取得済/要件クリア", "waiting": "⏸ 確認待ち", "not_clear": "❌ 対象外/不可", "unknown": "❔ 情報不足",
                 "currently_claimed": "💰 現在算定中", "claimed_but_requirements_unknown": "💰❔ 算定中（要件未確認）",
                 "not_detected_in_pdf": "📄❔ PDF未検出", "not_applicable": "🚫 当サービスでは算定対象外"}
STATUS_MARKS = {"clear": "✅", "waiting": "⏸", "not_clear": "❌", "unknown": "❔",
                "currently_claimed": "💰", "claimed_but_requirements_unknown": "💰❔", "not_detected_in_pdf": "📄❔",
                "not_applicable": "🚫"}

UNKNOWN_TAXONOMY = {
    "tenant_status_missing": "事業所ステータスファイル未登録（tenant_data/status/<office>.jsonを作成すれば判定可）",
    "data_missing": "職員情報・利用者情報が未入力（staff/user データ取込で解決）",
    "source_required": "公式根拠の確認待ち（マスタ要件側に確定値が未投入）",
    "logic_not_implemented": "判定ロジック未実装（OR/AND等のネスト評価が今後の対応事項）",
    "not_applicable_unknown": "対象外の可能性があるが未確認（地域要件等）",
}

USER_INFO_KEYS = {"kongan_jirei_ratio", "juudosha_ratio", "chusankan_user_count", "user_ratio"}
STAFF_INFO_KEYS = {"saseki_qualifications", "helper_qualifications", "joukin_senjuu_cm_count",
                   "shunin_cm_count", "saseki_health_check", "kinzoku_7nen_ratio", "saseki_uwanose_count"}


def load_registry() -> dict:
    with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def find_service(registry: dict, service: str, domain: str | None = None, status_filter: str | None = None) -> dict | None:
    for s in registry["services"]:
        if s["service_key"] != service:
            continue
        if domain and s.get("domain") != domain:
            continue
        if status_filter and s.get("status") != status_filter:
            continue
        return s
    return None


def load_master(service_def: dict) -> dict:
    path = ROOT / service_def["master_file"]
    if not path.exists():
        raise FileNotFoundError(f"マスタファイルが見つかりません: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_tenant_status(office: str | None, explicit_path: str | None = None) -> dict | None:
    if explicit_path:
        path = Path(explicit_path)
        if not path.is_absolute():
            path = (Path.cwd() / path).resolve()
    elif office:
        path = DEFAULT_STATUS_DIR / f"{office}.json"
    else:
        return None
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def collect_status_keys(req_value: dict) -> list[str]:
    keys = []
    if not isinstance(req_value, dict):
        return keys
    if "tenant_status_key" in req_value:
        keys.append(req_value["tenant_status_key"])
    for v in req_value.values():
        if isinstance(v, dict):
            keys.extend(collect_status_keys(v))
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, dict):
                    keys.extend(collect_status_keys(item))
    return keys


def classify_unknown(reason: str | None, tenant_loaded: bool) -> str:
    """unknown理由を5分類に振り分け。"""
    if not tenant_loaded:
        return "tenant_status_missing"
    if not reason:
        return "logic_not_implemented"
    if "no tenant_status_key bound" in reason:
        return "logic_not_implemented"
    if reason in USER_INFO_KEYS:
        return "data_missing"
    if reason in STAFF_INFO_KEYS:
        return "data_missing"
    return "data_missing"


def judge_requirement(req_value, tenant_status: dict) -> tuple[str, str | None]:
    if not isinstance(req_value, dict):
        return "unknown", None
    keys = collect_status_keys(req_value)
    if not keys:
        return "unknown", "no tenant_status_key bound"
    rs_map = tenant_status.get("requirement_status", {}) if tenant_status else {}
    statuses = []
    for k in keys:
        entry = rs_map.get(k)
        if not entry:
            statuses.append(("unknown", k))
        else:
            statuses.append((entry.get("status", "unknown"), k))
    levels = [s[0] for s in statuses]
    if any(s == "not_clear" for s in levels):
        return "not_clear", next(s for s in statuses if s[0] == "not_clear")[1]
    if any(s == "waiting" for s in levels):
        return "waiting", next(s for s in statuses if s[0] == "waiting")[1]
    if any(s == "unknown" for s in levels):
        return "unknown", next(s for s in statuses if s[0] == "unknown")[1]
    return "clear", None


def judge_kasan(kasan_key: str, kasan_def: dict, tenant_status: dict | None) -> dict:
    requirements = kasan_def.get("requirements", {})
    req_judgements = {}
    for req_key, req_val in requirements.items():
        status, reason = judge_requirement(req_val, tenant_status or {})
        req_judgements[req_key] = {"status": status, "reason": reason}

    # alpha.5 安全弁: applicability=not_applicable は別ステータス
    if kasan_def.get("applicability") == "not_applicable":
        overall = "not_applicable"
    else:
        statuses = [r["status"] for r in req_judgements.values()]
        if not statuses:
            overall = "unknown"
        elif all(s == "clear" for s in statuses):
            overall = "clear"
        elif any(s == "not_clear" for s in statuses):
            overall = "not_clear"
        elif any(s == "waiting" for s in statuses):
            overall = "waiting"
        else:
            overall = "unknown"

    return {
        "name": kasan_def.get("name"),
        "short_name": kasan_def.get("short_name"),
        "category": kasan_def.get("category"),
        "priority_hint": kasan_def.get("priority_hint"),
        "unit_per_month": kasan_def.get("unit_per_month"),
        "unit_per_day": kasan_def.get("unit_per_day"),
        "unit_per_visit": kasan_def.get("unit_per_visit"),
        "rate": kasan_def.get("rate"),
        "requirements_judgement": req_judgements,
        "algorithm_judgement": overall,
        "documents_required": kasan_def.get("documents_required", []),
        "roi_estimation": kasan_def.get("roi_estimation"),
        "interaction": kasan_def.get("interaction"),
        "tips": kasan_def.get("tips", []),
    }


def load_evidence(path: str | None) -> dict | None:
    """receipt_pdf evidence JSONを読み込む。"""
    if not path:
        return None
    p = Path(path)
    if not p.is_absolute():
        p = (Path.cwd() / p).resolve()
    if not p.exists():
        return None
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
    if "evidence" in data and isinstance(data["evidence"], list) and data["evidence"]:
        return data["evidence"][0]
    return data


def apply_evidence_to_judgements(judgements: dict, evidence: dict | None) -> dict:
    """receipt_pdf evidenceの current_kasan_counts に基づき判定を上書き。
    既存判定の status を以下のいずれかへ更新:
    - clear → currently_claimed（PDFで算定中検出 + 要件clear）
    - waiting/unknown → claimed_but_requirements_unknown（PDFで算定中検出 + 要件未確認）
    - PDF未検出: 既存判定をそのまま残す（not_detected_in_pdf は別フィールドで補足）
    """
    if not evidence:
        return judgements
    counts = evidence.get("current_kasan_counts", {}) or {}
    out = {}
    for kasan_key, j in judgements.items():
        new_j = dict(j)
        in_pdf = kasan_key in counts
        new_j["pdf_detected"] = in_pdf
        new_j["pdf_count"] = counts.get(kasan_key, 0)
        if in_pdf:
            if j["algorithm_judgement"] == "clear":
                new_j["algorithm_judgement"] = "currently_claimed"
            elif j["algorithm_judgement"] in ("waiting", "unknown"):
                new_j["algorithm_judgement"] = "claimed_but_requirements_unknown"
        out[kasan_key] = new_j
    return out


def run(service: str, office: str | None = None, domain: str | None = None,
        status_filter: str | None = None, status_path: str | None = None,
        evidence_path: str | None = None, apply_evidence: bool = False,
        inline_evidence: dict | None = None,
        demo_tenant_status_path: str | None = None,
        staff_data_path: str | None = None,
        user_summary_path: str | None = None) -> dict:
    registry = load_registry()
    service_def = find_service(registry, service, domain=domain, status_filter=status_filter)
    if not service_def:
        raise ValueError(f"サービスが見つかりません: service={service}, domain={domain}, status={status_filter}")

    master = load_master(service_def)
    if service_def.get("status") == "draft" and not master.get("kasans"):
        return {
            "service": service,
            "service_def": service_def,
            "master_meta": master.get("_meta", {}),
            "office_code": office,
            "draft_warning": "このサービスはdraftで、加算マスタは未実装(source_required)です。中身は推測で埋めず、source_requiredのまま空マスタとして配置されています。",
            "kasan_count": 0,
            "judgements": {},
            "summary": {"clear": [], "waiting": [], "not_clear": [], "unknown": []},
            "tenant_status_loaded": False,
            "tenant_status_inquiry": None,
            "executed_at": datetime.now().isoformat(timespec="seconds"),
        }

    tenant_status = load_tenant_status(office, status_path)
    kasans = master.get("kasans", {})
    judgements = {key: judge_kasan(key, val, tenant_status) for key, val in kasans.items()}

    evidence = None
    if apply_evidence:
        if evidence_path:
            evidence = load_evidence(evidence_path)
        elif inline_evidence:
            # inline_evidence は import_receipt_pdf.run_extraction() の戻り値（dict with "evidence":[...]）
            if "evidence" in inline_evidence and inline_evidence["evidence"]:
                evidence = inline_evidence["evidence"][0]
            else:
                evidence = inline_evidence
    if apply_evidence and evidence:
        judgements = apply_evidence_to_judgements(judgements, evidence)

    summary = {}
    for status in ("clear", "waiting", "not_clear", "unknown",
                   "currently_claimed", "claimed_but_requirements_unknown", "not_applicable"):
        summary[status] = [k for k, j in judgements.items() if j["algorithm_judgement"] == status]

    # alpha.5: DSL 評価 / alpha.5.2: DEMO tenant_status / alpha.5.3: DEMO staff / alpha.5.4: DEMO user_summary
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from requirement_dsl import (evaluate_requirement_logic, build_facts_from_evidence,
                                  load_demo_tenant_status, merge_demo_tenant_facts,
                                  load_evidence_labels, build_evidence_checklist,
                                  load_staff_data, build_facts_from_staff_data,
                                  merge_requirement_facts, build_staff_summary_display,
                                  load_user_summary, build_facts_from_user_summary,
                                  build_user_summary_display)
    facts = build_facts_from_evidence(evidence, tenant_status)
    # alpha.5.2: DEMO tenant_status をマージ
    if demo_tenant_status_path:
        demo_ts = load_demo_tenant_status(demo_tenant_status_path)
        facts = merge_demo_tenant_facts(facts, demo_ts)
    # alpha.5.3: DEMO staff.json から staff_summary facts を生成
    staff_data = None
    staff_summary_facts = {}
    staff_summary_display = {}
    if staff_data_path:
        staff_data = load_staff_data(staff_data_path)
        staff_summary_facts = build_facts_from_staff_data(staff_data, service_key=service)
        staff_summary_display = build_staff_summary_display(staff_summary_facts, service_key=service)
    # alpha.5.4: DEMO user_summary.json から user_summary facts を生成
    user_summary = None
    user_summary_facts = {}
    user_summary_display = {}
    if user_summary_path:
        user_summary = load_user_summary(user_summary_path)
        user_summary_facts = build_facts_from_user_summary(user_summary, service_key=service)
        user_summary_display = build_user_summary_display(user_summary_facts, service_key=service)
    # 統合マージ（receipt_pdf > tenant_status > staff_summary > user_summary）
    facts = merge_requirement_facts(facts, staff_summary_facts, user_summary_facts)

    dsl_results = {}
    for kasan_key, kasan_def in kasans.items():
        if kasan_def.get("applicability") == "not_applicable":
            item_meta = {"source_status": kasan_def.get("source_status"),
                         "applicability": "not_applicable",
                         "applicability_reason": kasan_def.get("applicability_reason")}
        else:
            item_meta = {"source_status": kasan_def.get("source_status", "checked")}
        logic = kasan_def.get("requirement_logic")
        dsl_results[kasan_key] = evaluate_requirement_logic(logic, facts, item_meta)

    # alpha.5.2: 不足証跡チェックリスト生成
    label_config = load_evidence_labels()
    evidence_checklist = build_evidence_checklist(dsl_results, judgements, label_config)

    return {
        "service": service,
        "service_def": service_def,
        "master_meta": master.get("_meta", {}),
        "office_code": office,
        "tenant_status_loaded": tenant_status is not None,
        "tenant_status": tenant_status,
        "tenant_status_inquiry": tenant_status.get("inquiry") if tenant_status else None,
        "evidence": evidence,
        "evidence_applied": apply_evidence and evidence is not None,
        "kasan_count": len(kasans),
        "summary": summary,
        "judgements": judgements,
        "dsl_results": dsl_results,
        "evidence_checklist": evidence_checklist,
        "demo_tenant_status_loaded": demo_tenant_status_path is not None,
        "staff_data_loaded": staff_data_path is not None,
        "staff_summary_display": staff_summary_display,
        "user_summary_loaded": user_summary_path is not None,
        "user_summary_display": user_summary_display,
        "executed_at": datetime.now().isoformat(timespec="seconds"),
    }


# ============================================================
# Markdown レンダリング (alpha2: 経営者・管理者向け商品レポート)
# ============================================================

DISCLAIMER = """> **⚠️ 重要なお断り**: 本レポートは加算算定可否を**法的に保証するものではありません**。
> 取得候補・確認待ち項目・必要書類・増収目安を提示する**支援ツール**です。
> 実際の届出・算定は各自治体の指導課・監査担当および顧問の社労士等に確認してください。"""


def unit_text(j: dict) -> str:
    if j.get("unit_per_month"):
        return f"{j['unit_per_month']}単位/月"
    if j.get("unit_per_day"):
        return f"{j['unit_per_day']}単位/日"
    if j.get("unit_per_visit"):
        return f"{j['unit_per_visit']}単位/回"
    if j.get("rate") is not None:
        return f"所定単位×{int(j['rate']*100)}%"
    return "-"


def estimate_yearly_yen(j: dict, users_assumed: int = 40) -> str:
    """超概算の年間増収目安（単価10円・地域単価補正なし・40名想定）"""
    if j.get("unit_per_month"):
        v = j["unit_per_month"] * 10 * users_assumed * 12
        return f"約{v:,}円/年（{users_assumed}名想定）"
    if j.get("unit_per_day"):
        v = j["unit_per_day"] * 10 * users_assumed * 22 * 12
        return f"約{v:,}円/年（月22日×{users_assumed}名想定）"
    if j.get("unit_per_visit"):
        v = j["unit_per_visit"] * 10 * users_assumed * 4 * 12
        return f"約{v:,}円/年（月4回×{users_assumed}名想定）"
    if j.get("rate"):
        return f"所定単位の{int(j['rate']*100)}%（規模により大）"
    return "-"


def collect_unknown_classified(result: dict) -> dict:
    """全unknown要件を5分類で集計"""
    classified = {k: [] for k in UNKNOWN_TAXONOMY}
    tenant_loaded = result.get("tenant_status_loaded", False)
    for kasan_key, j in result.get("judgements", {}).items():
        for req_key, req_j in j.get("requirements_judgement", {}).items():
            if req_j["status"] != "unknown":
                continue
            cat = classify_unknown(req_j.get("reason"), tenant_loaded)
            classified[cat].append({
                "kasan": kasan_key,
                "req": req_key,
                "reason": req_j.get("reason"),
            })
    return classified


def top5_actions(result: dict) -> list[str]:
    """すぐ確認すべき項目TOP5を抽出"""
    actions = []
    inquiry = result.get("tenant_status_inquiry") or {}
    # 1. M1-M5
    for it in inquiry.get("remaining_5_items", [])[:5]:
        actions.append(f"[{it['id']}] {it['item']}")
    # 2. 40%要件
    if "tokujituI_youkaigo3_ratio" in inquiry:
        r = inquiry["tokujituI_youkaigo3_ratio"]
        actions.append(f"[要介護3以上40%要件] 現状{r.get('current', 0)*100:.1f}% / 目標{r.get('target', 0)*100:.1f}% / {r.get('needed_subtraction_for_clear', '')}")
    # 3. waiting加算の最重要要件
    waiting_kasans = [k for k, j in result.get("judgements", {}).items() if j["algorithm_judgement"] == "waiting" and j.get("priority_hint")]
    for k in waiting_kasans:
        if len(actions) >= 5:
            break
        j = result["judgements"][k]
        actions.append(f"[{j['name']}] {j.get('priority_hint', '')}")
    return actions[:5]


def render_markdown(result: dict) -> str:
    sd = result.get("service_def", {})
    mm = result.get("master_meta", {})
    L = []

    # ============ 1ページ目: 結論サマリ ============
    L.append(f"# CareLinker 加算チェッカー 判定レポート")
    L.append("")
    L.append(f"> **{sd.get('display_name')}** | 事業所コード `{result.get('office_code') or '(未指定)'}` | 生成日時 `{result['executed_at']}`")
    L.append(f"> マスタ版 `{mm.get('version')}` / 改定タグ `{mm.get('revision_tag')}` / 適用開始 `{mm.get('effective_from')}`")
    L.append("")
    # alpha.5.3-public-demo.1: DEMO事業所コード or DEMOデータロード時は冒頭で架空サンプルである旨を明示
    office_code = result.get("office_code") or ""
    is_demo_context = (
        office_code.startswith("DEMO-")
        or result.get("demo_tenant_status_loaded")
        or result.get("staff_data_loaded")
        or result.get("user_summary_loaded")
    )
    if is_demo_context:
        L.append("> **🧪 公開デモ用の架空サンプル**: 本レポートは公開デモ用の架空事業所コード・架空職員サマリ・架空証跡データを使用しています。実事業所のデータではありません。")
        L.append("")
    L.append(DISCLAIMER)
    L.append("")
    if result.get("evidence_applied"):
        L.append("> **📄 PDF取込モード**: 本レポートはレセプトPDFから抽出した算定中加算を反映しています。")
        L.append("> - PDFで検出された加算は **「算定中の推定」** です（要件充足を保証するものではありません）")
        L.append("> - PDFから検出されないことは **「未算定」を意味しません**（帳票形式・抽出ロジック未対応の可能性）")
        L.append("> - **個人情報は保存していません**（被保険者番号・氏名・住所・電話番号は意図的に非抽出）")
        L.append("")

    if "draft_warning" in result:
        L.append("## ⚠️ Draft サービス警告")
        L.append("")
        L.append(result["draft_warning"])
        L.append("")
        L.append("---")
        L.append("")
        L.append("## 今後の予定")
        L.append("")
        L.append("- マスタ実装（要件・単位・書類のJSON化）")
        L.append("- 自社事業所での実証 → 顧客向け公開")
        L.append("")
        L.append(f"_Generated by CareLinker / judge_kasan.py at {result['executed_at']}_")
        return "\n".join(L)

    # PDF取込結果サマリ（apply_evidence適用時のみ）
    if result.get("evidence_applied"):
        ev = result["evidence"]
        L.append("## 📄 PDF取込結果サマリ")
        L.append("")
        L.append(f"- ソースファイル: `{ev.get('source_file_name', '-')}`")
        L.append(f"- 抽出日時: {ev.get('extracted_at', '-')}")
        L.append(f"- 抽出版: `{ev.get('extraction_version', '-')}`")
        L.append(f"- 推定利用者数: **{ev.get('total_users_estimated', 0)}名**")
        cl = ev.get("care_level_distribution") or {}
        if cl:
            L.append(f"- 要介護度分布: " + " / ".join(f"{k}: {v}名" for k, v in sorted(cl.items())))
        if ev.get("yokaigo_3plus_ratio") is not None:
            L.append(f"- 要介護3以上割合: **{ev['yokaigo_3plus_ratio']*100:.1f}%**")
        if ev.get("raw_yokaigo_3plus_ratio") is not None and ev.get("yokaigo_3plus_ratio") is None:
            L.append(f"- 要介護3以上割合（参考値・PDFのみで要件clearしない）: **{ev['raw_yokaigo_3plus_ratio']*100:.1f}%**")
            L.append(f"    - 居宅介護支援の特定事業所加算(I)40%要件は地域包括紹介除外などPDFだけでは確定できないため参考値扱い")
        L.append(f"- 抽出信頼度: `{ev.get('extraction_confidence', '-')}`")
        if ev.get("service_code_mapping_status"):
            # 公開向け表現: pattern_based_unverified を「暫定パターンによる推定」と表示
            mapping_label = {
                "pattern_based_unverified": "暫定パターンによる推定（公式サービスコード表との完全照合は継続更新対象）",
                "checked": "公式サービスコード表で確認済",
                "source_required": "公式根拠未確認（使用前確認必須）",
            }.get(ev["service_code_mapping_status"], ev["service_code_mapping_status"])
            L.append(f"- サービスコード抽出: {mapping_label}")
            L.append(f"- 帳票形式により抽出精度が変動します")
        L.append("")
        L.append(f"> **個人情報を保存していません**: {ev.get('pii_policy', {}).get('policy_note', '個人情報非保存設計')}")
        L.append("")
        if ev.get("warnings"):
            L.append("**抽出警告**:")
            for w in ev["warnings"]:
                L.append(f"- ⚠️ {w}")
            L.append("")
        L.append("---")
        L.append("")

    # 結論サマリ
    s = result["summary"]
    L.append("## 📌 結論サマリ")
    L.append("")
    L.append(f"**全{result['kasan_count']}加算中、取得可能性が高い加算は {len(s['waiting']) + len(s['clear'])} 件**")
    L.append("")
    L.append("| 状態 | 件数 | 意味 |")
    L.append("|---|---:|---|")
    L.append(f"| ✅ 取得済/要件クリア | {len(s['clear'])} | 既に要件を満たしている／届出済 |")
    L.append(f"| ⏸ 確認待ち | {len(s['waiting'])} | 一部の確認・書類整備で取得可能 |")
    L.append(f"| ❌ 対象外/不可 | {len(s['not_clear'])} | 地域要件等で対象外 |")
    L.append(f"| ❔ 情報不足 | {len(s['unknown'])} | 職員/利用者データ取込・追加実装で判定可 |")
    not_applicable_count = len(s.get("not_applicable", []))
    if not_applicable_count:
        L.append(f"| 🚫 当サービスでは算定対象外 | {not_applicable_count} | 公式根拠で対象外確定（改善候補・収益機会には含めない） |")
    if result.get("evidence_applied"):
        # PDF検出の集計を主語にする
        currently_kashan_keys = [k for k, j in result["judgements"].items() if j.get("pdf_detected")]
        confirmed = len(s.get("currently_claimed", []))
        unconfirmed = len(s.get("claimed_but_requirements_unknown", []))
        L.append(f"| 📄 PDFで算定中として検出 | {len(currently_kashan_keys)} | レセプトPDFから算定中と推定された加算 |")
        L.append(f"| 　└ うち要件確認済 | {confirmed} | 要件マスタとも整合（自信度高） |")
        L.append(f"| 　└ うち要件未確認 | {unconfirmed} | 算定中だが要件マスタは未確認 |")
        not_in_pdf_total = sum(1 for k, j in result["judgements"].items()
                                if not j.get("pdf_detected") and j.get("priority_hint"))
        L.append(f"| 📄❔ PDFから未検出だが取得候補 | {not_in_pdf_total} | PDF未検出≠未算定。要追加確認 |")
    L.append("")

    # 現在算定中・PDF未検出だが取得候補（evidence適用時のみ）
    if result.get("evidence_applied"):
        ev = result["evidence"]
        L.append("## 📄 PDFで算定中として検出された加算")
        L.append("")
        L.append("> **重要**: PDF検出は「算定中の推定」です。要件充足を保証するものではありません。要件マスタとの整合性は別途確認が必要です。")
        L.append("")
        currently = [k for k, j in result["judgements"].items() if j.get("pdf_detected")]
        if currently:
            L.append("| 加算 | PDF検出件数 | 要件状態 |")
            L.append("|---|---:|---|")
            for k in currently:
                j = result["judgements"][k]
                req_state = STATUS_LABELS.get(j["algorithm_judgement"], "-")
                L.append(f"| {j['name']} (`{k}`) | {j.get('pdf_count', 0)}件 | {req_state} |")
        else:
            L.append("（PDFから算定中加算を検出できませんでした）")
        L.append("")

        L.append("## 📄❔ PDFから未検出だが取得候補の加算")
        L.append("")
        L.append("> **重要**: PDFから検出されないことは「未算定」を断定するものではありません。サービスコード未収載・帳票形式違い・PDF抽出ロジック未対応の場合があります。")
        L.append("")
        not_in_pdf = [k for k, j in result["judgements"].items()
                      if not j.get("pdf_detected") and j.get("priority_hint")]
        if not_in_pdf:
            for k in not_in_pdf[:10]:
                j = result["judgements"][k]
                L.append(f"- 📄❔ **{j['name']}** (`{k}`) — {j.get('priority_hint', '')}")
        else:
            L.append("（該当なし）")
        L.append("")
        L.append("---")
        L.append("")

    # すぐ確認すべき項目TOP5
    L.append("## 🎯 すぐ確認すべき項目 TOP5")
    L.append("")
    actions = top5_actions(result)
    if actions:
        for i, a in enumerate(actions, 1):
            L.append(f"{i}. {a}")
    else:
        L.append("（事業所ステータスを `tenant_data/status/<office>.json` に登録すると、確認すべき項目が表示されます）")
    L.append("")

    # 今月やること
    L.append("## 🗓️ 今月やること")
    L.append("")
    if result.get("tenant_status_loaded"):
        history = result.get("tenant_status", {}).get("history", [])
        L.append("- 確認待ち項目の回答を依頼先（記載のowner）から回収")
        L.append("- waiting加算のうち、必要書類が整備済のものを今月中に届出")
        L.append("- マスタ更新（changelog.md）の有無をチェック")
        if history:
            L.append("")
            L.append("**最近の動き**:")
            for h in history[-3:]:
                L.append(f"  - {h.get('date')}: {h.get('event')}")
    else:
        L.append("- `tenant_data/status/<office_code>.json` を作成し、職員情報・利用者構成・確認進捗を登録")
        L.append("- 請求明細書PDF（直近3か月）を取り込み、現状算定中の加算を抽出")
    L.append("")

    L.append("---")
    L.append("")

    # ============ 2ページ以降: 詳細 ============
    L.append("## 1. 取得可能性が高い加算（waiting + clear）")
    L.append("")
    high = [(k, j) for k, j in result["judgements"].items()
            if j["algorithm_judgement"] in ("clear", "waiting")]
    if not high:
        L.append("（該当なし）")
    else:
        L.append("| 加算 | 状態 | 単位 | 増収目安 | 重要度 |")
        L.append("|---|---|---|---|---|")
        for key, j in high:
            mark = STATUS_MARKS.get(j["algorithm_judgement"], "❔")
            L.append(f"| {j['name']} | {mark} | {unit_text(j)} | {estimate_yearly_yen(j)} | {(j.get('priority_hint') or '-')[:40]} |")
        L.append("")
        L.append("### 各加算の要件詳細")
        L.append("")
        for key, j in high:
            mark = STATUS_LABELS.get(j["algorithm_judgement"], "❔")
            L.append(f"#### {mark} {j['name']} (`{key}`)")
            L.append("")
            if j.get("priority_hint"):
                L.append(f"- 重要度: {j['priority_hint']}")
            L.append(f"- 単位/レート: **{unit_text(j)}**")
            L.append(f"- 増収目安: {estimate_yearly_yen(j)}")
            L.append(f"- 要件状態:")
            for rk, rj in j["requirements_judgement"].items():
                rmark = STATUS_MARKS.get(rj["status"], "❔")
                reason = f" (確認: {rj['reason']})" if rj.get("reason") else ""
                L.append(f"    - {rmark} `{rk}`{reason}")
            if j.get("tips"):
                L.append(f"- ヒント:")
                for tip in j["tips"][:3]:
                    L.append(f"    - {tip}")
            L.append("")

    # 取得できない/対象外
    L.append("## 2. 対象外・取得不可の加算")
    L.append("")
    not_clear_list = [(k, j) for k, j in result["judgements"].items() if j["algorithm_judgement"] == "not_clear"]
    if not not_clear_list:
        L.append("（該当なし）")
    else:
        for key, j in not_clear_list:
            L.append(f"- ❌ **{j['name']}** (`{key}`)")
            for rk, rj in j["requirements_judgement"].items():
                if rj["status"] == "not_clear":
                    L.append(f"    - 対象外理由: `{rk}` ({rj.get('reason', '-')})")
            if j.get("tips"):
                for tip in j["tips"]:
                    if "対象外" in tip or "中山間" in tip or "級地" in tip:
                        L.append(f"    - 補足: {tip}")
    L.append("")

    # 確認待ち項目（テナント側 inquiry から）
    L.append("## 3. 確認待ち項目（テナント側）")
    L.append("")
    inquiry = result.get("tenant_status_inquiry") or {}
    if not inquiry:
        L.append("（事業所ステータス未読込）")
    else:
        for it in inquiry.get("remaining_5_items", []):
            mark = STATUS_MARKS.get(it.get("status", "waiting"), "❔")
            L.append(f"- {mark} **[{it['id']}]** {it['item']}")
            if it.get("linked_kasan_req"):
                L.append(f"    - 紐付け要件: `{it['linked_kasan_req']}`")
        for k, v in inquiry.items():
            if k in ("remaining_5_items", "saseki_status", "helper_count"):
                continue
            if isinstance(v, dict) and "current" in v:
                L.append(f"- ⏸ **{k}**: 現状{v.get('current', 0)*100:.1f}% / 目標{v.get('target', 0)*100:.1f}% — {v.get('needed_subtraction_for_clear', '')}")
        if "saseki_status" in inquiry:
            ss = inquiry["saseki_status"]
            mk = STATUS_MARKS.get(ss.get("status", "unknown"), "❔")
            L.append(f"- {mk} **サ責状況**: {ss.get('count')}名 — {ss.get('jitumu_keiken_youken', '')}")
    L.append("")

    # unknown 5分類
    L.append("## 4. ❔ 情報不足の内訳（5分類）")
    L.append("")
    classified = collect_unknown_classified(result)
    L.append("| 分類 | 件数 | 説明 |")
    L.append("|---|---:|---|")
    for cat, desc in UNKNOWN_TAXONOMY.items():
        L.append(f"| `{cat}` | {len(classified[cat])} | {desc} |")
    L.append("")
    for cat in UNKNOWN_TAXONOMY:
        items = classified[cat]
        if not items:
            continue
        L.append(f"### {cat}")
        L.append("")
        for it in items[:10]:
            L.append(f"- `{it['kasan']}.{it['req']}` ← {it.get('reason', '-')}")
        if len(items) > 10:
            L.append(f"- ... 他 {len(items) - 10} 件")
        L.append("")

    # 不足書類
    L.append("## 5. 必要書類チェックリスト（waiting加算分）")
    L.append("")
    docs_set = []
    for key, j in result["judgements"].items():
        if j["algorithm_judgement"] == "waiting":
            for d in j.get("documents_required", []):
                if d not in docs_set:
                    docs_set.append(d)
    if not docs_set:
        L.append("（取得対象加算なし、または書類リスト未定義）")
    else:
        for d in docs_set:
            L.append(f"- [ ] {d}")
    L.append("")

    # 追加確認すべき職員情報・利用者情報
    rs_keys_unknown = []
    for key, j in result["judgements"].items():
        for rk, rj in j["requirements_judgement"].items():
            if rj["status"] in ("waiting", "unknown") and rj.get("reason"):
                rs_keys_unknown.append(rj["reason"])
    rs_keys_unknown = list(dict.fromkeys(rs_keys_unknown))

    L.append("## 6. 追加確認すべき職員情報")
    L.append("")
    staff_keys = [k for k in rs_keys_unknown if k in STAFF_INFO_KEYS]
    if not staff_keys:
        L.append("（該当なし）")
    else:
        for k in staff_keys:
            L.append(f"- [ ] {k}")
    L.append("")

    L.append("## 7. 追加確認すべき利用者情報")
    L.append("")
    user_keys = [k for k in rs_keys_unknown if k in USER_INFO_KEYS]
    if not user_keys:
        L.append("（該当なし）")
    else:
        for k in user_keys:
            L.append(f"- [ ] {k}")
    L.append("")

    # 増収見込み
    L.append("## 8. 増収見込み（waiting/clear加算）")
    L.append("")
    L.append("| 加算 | 状態 | 単位/レート | 年間増収目安 |")
    L.append("|---|---|---|---|")
    for key, j in result["judgements"].items():
        if j["algorithm_judgement"] in ("clear", "waiting"):
            mark = STATUS_MARKS.get(j["algorithm_judgement"])
            L.append(f"| {j['name']} | {mark} | {unit_text(j)} | {estimate_yearly_yen(j)} |")
    L.append("")
    L.append("> 増収目安は40名想定の超概算（単価10円・地域単価補正なし）。実際は要介護度構成・地域単価・実利用者数で変動します。")
    L.append("")

    # 根拠マスタのバージョン
    L.append("## 9. 根拠マスタのバージョン")
    L.append("")
    L.append(f"- service_key: `{result['service']}`")
    L.append(f"- version: `{mm.get('version')}`")
    L.append(f"- revision_tag: `{mm.get('revision_tag')}`")
    L.append(f"- effective_from: `{mm.get('effective_from')}`")
    L.append(f"- source_status: `{mm.get('source_status')}`")
    L.append(f"- 法令出典: {mm.get('source')}")
    L.append(f"- generated_at: `{result['executed_at']}`")
    L.append("")

    # alpha.5: 要件ロジック評価セクション
    dsl_results = result.get("dsl_results") or {}
    evaluated = {k: v for k, v in dsl_results.items()
                 if v.get("status") not in ("unknown",) or v.get("logic_status") == "checked"}
    # logic未登録(unknown + logic_status=absent)以外を表示
    show = {k: v for k, v in dsl_results.items()
            if v.get("logic_status") in ("checked", "n/a")}
    if show:
        L.append("## 🧠 要件ロジック評価（alpha）")
        L.append("")
        L.append("> 公式根拠確認済みの要件のみ、登録済みevidenceに基づいて機械的に評価しています。")
        L.append("> 本結果は算定可否を法的に保証するものではありません。算定可否の最終確認は事業所資料・届出状況・自治体確認が必要です。")
        L.append("")
        L.append("| 加算 | PDF検出 | 要件評価 | 達成ルート | 不足証跡 | 注意 |")
        L.append("|---|---|---|---|---|---|")
        for kasan_key, dsl in show.items():
            j = result["judgements"].get(kasan_key, {})
            kasan_name = j.get("name", kasan_key)
            pdf_state = "対象外" if dsl["status"] == "not_applicable" else (
                "算定中の推定" if j.get("pdf_detected") else "未検出"
            )
            dsl_label = {
                "clear": "✅ clear",
                "not_clear": "❌ not_clear",
                "partially_clear": "🟡 partially_clear",
                "blocked_by_missing_evidence": "📭 不足証跡あり",
                "blocked_by_unverified_mapping": "🔒 サービスコード照合未完了のため保留",
                "not_evaluated_source_required": "⏳ 根拠未確認",
                "not_evaluated_logic_unchecked": "⏳ ロジック未確認",
                "not_applicable": "🚫 当サービス対象外",
                "unknown": "❔ unknown",
            }.get(dsl["status"], dsl["status"])
            route = " / ".join(dsl.get("satisfied_route") or []) or "-"
            missing = ", ".join(dsl.get("missing_evidence") or []) or "-"
            held = dsl.get("mapping_held_conditions") or []
            note_cell = "🔒 mapping保留" if held else (
                "ℹ️ pattern_based_unverified" if any("pattern_based_unverified" in n for n in (dsl.get("notes") or [])) else "-"
            )
            L.append(f"| {kasan_name} | {pdf_state} | {dsl_label} | {route} | {missing} | {note_cell} |")
        L.append("")
        L.append("> 「不足証跡あり」と表示された加算は、職員情報・利用者状態・書類整備状況等の追加確認が必要です。")
        L.append("")

    # alpha.5.4: 利用者データ連携（DEMO alpha・集計値のみ）
    user_display = result.get("user_summary_display") or {}
    if result.get("user_summary_loaded") and user_display:
        L.append("## 🧑‍🤝‍🧑 利用者データ連携（DEMO alpha）")
        L.append("")
        L.append("> DEMO用の架空利用者集計データから組み立てた利用者サマリです。")
        L.append("> 個別利用者の氏名・被保険者番号・住所・電話番号・生年月日・家族情報・医療機関名・具体的病名は表示しません（集計値のみ）。")
        L.append("> 本セクションの値は **要件確認補助** であり、算定可否を保証するものではありません。")
        L.append("")
        L.append("| 集計項目 | 値 |")
        L.append("|---|---|")
        ordered = [
            "data_source_type", "source_status",
            "target_period_start", "target_period_end",
            "users_total",
            "care_level_3_or_higher_count", "care_level_3_or_higher_ratio",
            "care_level_4_or_higher_count", "care_level_4_or_higher_ratio",
            "severe_user_count", "severe_user_ratio",
            "dementia_related_count",
            "medical_dependency_count",
            "terminal_care_related_count",
            "discharge_support_related_count",
            "emergency_response_related_count",
        ]
        for k in ordered:
            if k in user_display:
                v = user_display[k]
                if isinstance(v, dict):
                    v_str = " / ".join(f"{kk}: {vv}" for kk, vv in v.items())
                elif isinstance(v, float):
                    v_str = f"{v:.3f}" if v != int(v) else f"{int(v)}"
                else:
                    v_str = str(v) if v is not None else "-"
                L.append(f"| {k} | {v_str} |")
        # 分布は別行で出す
        for distr_key in ("care_level_distribution", "dementia_care_level_distribution"):
            if distr_key in user_display and isinstance(user_display[distr_key], dict):
                v = user_display[distr_key]
                v_str = " / ".join(f"{kk}: {vv}" for kk, vv in v.items())
                L.append(f"| {distr_key} | {v_str} |")
        L.append("")
        L.append("> 上記サマリは要件DSLでも参照されます（user_summary.* facts）。")
        L.append("> source_status は `demo_aggregate_unverified` であり、本番運用前に集計根拠の確認が必要です。")
        L.append("")

    # alpha.5.3: 職員データ連携サマリ（DEMO・集計値のみ）
    staff_display = result.get("staff_summary_display") or {}
    if result.get("staff_data_loaded") and staff_display:
        L.append("## 👥 職員データ連携（DEMO alpha）")
        L.append("")
        L.append("> DEMO用の架空staff.jsonから集計した職員サマリです。")
        L.append("> 個別の氏名・staff_id・資格詳細は表示しません（集計値のみ）。")
        L.append("> 算定可否を法的に保証するものではありません。")
        L.append("")
        L.append("| 集計項目 | 値 |")
        L.append("|---|---|")
        # 表示順を整える
        ordered_keys = [
            "saseki_qualified_count", "saseki_uwanose_fte",
            "helper_total_count", "helper_total_fte",
            "helper_kaigo_fukushishi_count", "helper_kaigo_fukushishi_ratio",
            "helper_fukushishi_jitsumusha_kiso_ratio", "helper_qualified_any_count",
            "kango_count", "kango_fte", "kango_joukin_count",
            "kaigo_count", "kaigo_fte", "kango_kaigo_total_fte",
            "kinou_kunren_qualified",
            "rihabilitation_count",
            "cm_count", "shunin_cm_count", "cm_total_fte",
        ]
        for k in ordered_keys:
            if k in staff_display:
                v = staff_display[k]
                if isinstance(v, bool):
                    v_str = "✅ あり" if v else "❌ なし"
                elif isinstance(v, float):
                    v_str = f"{v:.2f}" if v != int(v) else f"{int(v)}"
                else:
                    v_str = str(v) if v is not None else "-"
                L.append(f"| {k} | {v_str} |")
        # 順序外があれば末尾追記
        for k, v in staff_display.items():
            if k not in ordered_keys:
                L.append(f"| {k} | {v} |")
        L.append("")
        L.append("> 上記サマリは要件DSLの判定にも使用されます（staff_summary.* facts）。")
        L.append("")

    # alpha.5.2: 不足証跡チェックリスト
    checklist = result.get("evidence_checklist") or []
    if checklist:
        L.append("## 🧾 不足証跡チェックリスト（alpha）")
        L.append("")
        L.append("> 要件ロジック評価で不足している証跡を、確認作業用に整理したものです。")
        L.append("> 本チェックリストは算定可否を法的に保証するものではありません。")
        if result.get("demo_tenant_status_loaded"):
            L.append("> DEMO用の架空tenant_statusを使用。実事業所データではありません。")
        if result.get("staff_data_loaded"):
            L.append("> DEMO用の架空staff.jsonから集計した職員サマリも参照しています。")
        if result.get("user_summary_loaded"):
            L.append("> DEMO用の架空利用者集計（user_summary）も参照しています（要件確認補助・算定可否は保証しません）。")
        L.append("")
        L.append("| 加算 | 不足証跡 | 推奨確認資料 | 優先度 | 次アクション |")
        L.append("|---|---|---|---|---|")
        for it in checklist:
            docs = "・".join(it.get("recommended_documents") or []) or "-"
            next_action = it.get("next_action") or "-"
            L.append(f"| {it['kasan_name']} | {it['label']} | {docs} | {it.get('priority', '-')} | {next_action} |")
        L.append("")

    L.append("---")
    L.append("")
    L.append(DISCLAIMER)
    L.append("")
    L.append(f"_Generated by CareLinker 加算チェッカー / judge_kasan.py / v2026.05.06-alpha.5.4_")
    return "\n".join(L)


def print_console_report(result: dict) -> None:
    sd = result.get("service_def", {})
    print(f"\n=== CareLinker 加算チェッカー判定 ===")
    print(f"サービス: {sd.get('display_name')} ({result['service']})")
    print(f"事業所: {result.get('office_code') or '(未指定)'}")
    if "draft_warning" in result:
        print(f"\n⚠️  {result['draft_warning']}\n")
        return
    s = result["summary"]
    print(f"\n--- 加算判定サマリ（全{result['kasan_count']}加算）---")
    print(f"  ✅ clear     : {len(s['clear'])} 件")
    print(f"  ⏸ waiting   : {len(s['waiting'])} 件")
    print(f"  ❌ not_clear : {len(s['not_clear'])} 件")
    print(f"  ❔ unknown   : {len(s['unknown'])} 件")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", required=True)
    parser.add_argument("--office")
    parser.add_argument("--domain")
    parser.add_argument("--status")
    parser.add_argument("--status-filter", choices=["implemented", "draft", "planned"])
    parser.add_argument("--evidence", help="receipt_pdf evidence JSON path（--apply-evidenceと併用）")
    parser.add_argument("--apply-evidence", action="store_true", help="evidenceを判定に反映")
    parser.add_argument("--receipt-pdf", help="（参考）レセプトPDFパス。実取込はimport_receipt_pdf.pyで実施")
    parser.add_argument("--evidence-out", help="（参考）evidence出力先。実取込はimport_receipt_pdf.pyで実施")
    parser.add_argument("--tenant-status", dest="demo_tenant_status",
                        help="alpha.5.2: DEMO tenant_status JSONパス（不足証跡チェックリスト生成用）")
    parser.add_argument("--staff-data", dest="staff_data",
                        help="alpha.5.3: DEMO staff.json パス（staff_summary facts用・公開デモ専用）")
    parser.add_argument("--user-summary", dest="user_summary",
                        help="alpha.5.4: DEMO user_summary.json パス（user_summary facts用・公開デモ専用・集計値のみ）")
    parser.add_argument("--json")
    parser.add_argument("--report-md")
    args = parser.parse_args()

    # --receipt-pdf 実動作: 内部で抽出→evidence生成→保存→読込
    inline_evidence = None
    inline_evidence_path = None
    if args.receipt_pdf:
        if args.evidence:
            print("WARN: --receipt-pdfと--evidenceが両方指定されました。--evidenceを優先し、--receipt-pdfは無視します。", file=sys.stderr)
        else:
            if not args.office:
                print("ERROR: --receipt-pdf指定時は--office必須", file=sys.stderr)
                sys.exit(1)
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            from import_receipt_pdf import run_extraction
            inline_evidence, inline_evidence_path = run_extraction(
                office=args.office, service=args.service, tenant=None,
                pdf_path=args.receipt_pdf,
                evidence_out=args.evidence_out,
            )
            print(f"INFO: --receipt-pdfからevidence生成: {inline_evidence_path or '(保存先未指定・メモリのみ)'}", file=sys.stderr)

    result = run(args.service, office=args.office, domain=args.domain,
                 status_filter=args.status_filter, status_path=args.status,
                 evidence_path=args.evidence, apply_evidence=args.apply_evidence,
                 inline_evidence=inline_evidence,
                 demo_tenant_status_path=args.demo_tenant_status,
                 staff_data_path=args.staff_data,
                 user_summary_path=args.user_summary)

    if args.json:
        out = Path(args.json)
        out.parent.mkdir(parents=True, exist_ok=True)
        # tenant_status はそのままだとサイズ大なのでmetaのみ残す
        result_json = {**result}
        if "tenant_status" in result_json and result_json["tenant_status"]:
            result_json["tenant_status_meta"] = result_json["tenant_status"].get("_meta")
            del result_json["tenant_status"]
        with open(out, "w", encoding="utf-8") as f:
            json.dump(result_json, f, ensure_ascii=False, indent=2)
        print(f"JSON書き出し: {out}")

    if args.report_md:
        out = Path(args.report_md)
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            f.write(render_markdown(result))
        print(f"Markdownレポート書き出し: {out}")

    if not args.json and not args.report_md:
        print_console_report(result)


if __name__ == "__main__":
    main()
