"""CareLinker 加算チェッカー alpha.5: 要件論理式DSL evaluator

JSON ベースの DSL で AND / OR / ネスト条件を評価する。

設計方針:
- source_status != checked の要件は評価しない（not_evaluated_source_required）
- logic_status != checked のロジックは評価しない（not_evaluated_logic_unchecked）
- applicability=not_applicable の加算は評価しない（not_applicable）
- factが存在しない場合は blocked_by_missing_evidence
- pattern_based_unverified の evidence ベースで充足するルートは clear にしない（warning付与）
- 「算定可否の保証」ではなく「公式根拠確認済み要件に対する機械的な充足推定」

DSLノード種別:
- all: 全子要件がclearならclear
- any: 1つでもclearならclear
- condition: factとop+valueで評価

対応op: ==, !=, >, >=, <, <=, exists, not_exists, in, not_in, bool_true, bool_false

評価結果status:
- clear / not_clear / partially_clear
- blocked_by_missing_evidence
- not_evaluated_source_required
- not_evaluated_logic_unchecked
- not_applicable / unknown
"""
from __future__ import annotations

from typing import Any


VALID_OPS = {"==", "!=", ">", ">=", "<", "<=", "exists", "not_exists",
             "in", "not_in", "bool_true", "bool_false"}

# サービスコードマッピング依存と判定する fact path のサブストリング
MAPPING_DEPENDENT_FACT_TOKENS = (
    "current_kasan_counts",
    "detected_claim_status",
    "service_code",
    "claim_item_code",
    "claimed_units",
)

PATTERN_UNVERIFIED_NOTE = (
    "evidenceの service_code_mapping_status=pattern_based_unverified を含むため、"
    "サービスコード完全照合前提の評価は確定値ではありません。"
)
MAPPING_DEPENDENT_HOLD_NOTE = (
    "サービスコード照合未完了のため、サービスコード依存条件は保留扱いとしました。"
)
DEFAULT_DISCLAIMER = (
    "PDF evidenceに基づく機械的推定。算定可否を保証するものではありません。"
)


def is_mapping_dependent(node: dict) -> bool:
    """conditionがサービスコードマッピング依存かを判定。
    明示フラグ depends_on_service_code_mapping があればそれを優先、
    なければ fact path を見て推定する。"""
    if "depends_on_service_code_mapping" in node:
        return bool(node["depends_on_service_code_mapping"])
    fact = node.get("fact") or ""
    return any(tok in fact for tok in MAPPING_DEPENDENT_FACT_TOKENS)


def get_fact(facts: dict, dotted_key: str) -> tuple[Any, bool]:
    """dotted_key（例 'receipt_pdf.yokaigo_3plus_ratio'）でfactsから値を取得。
    戻り値: (value, found)"""
    cur: Any = facts
    for part in dotted_key.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None, False
    return cur, True


def evaluate_condition(node: dict, facts: dict, mapping_unverified: bool = False) -> dict:
    """単一conditionを評価。
    mapping_unverified=True かつ mapping依存factの場合、clearにせず blocked_by_unverified_mapping を返す。"""
    fact_path = node.get("fact")
    op = node.get("op")
    value = node.get("value")
    label = node.get("label") or f"{fact_path} {op} {value}"

    if op not in VALID_OPS:
        return {"status": "unknown", "label": label, "reason": f"unsupported op: {op}"}

    # alpha.5.1: mapping依存fact + pattern_based_unverified → clearせず保留
    if mapping_unverified and is_mapping_dependent(node):
        return {"status": "blocked_by_unverified_mapping", "label": label,
                "reason": "service_code_mapping_status=pattern_based_unverified",
                "missing": []}

    fact_val, found = get_fact(facts, fact_path)

    if op == "exists":
        return {"status": "clear" if found else "blocked_by_missing_evidence",
                "label": label, "missing": [fact_path] if not found else []}
    if op == "not_exists":
        return {"status": "clear" if not found else "not_clear",
                "label": label, "missing": []}

    if not found:
        return {"status": "blocked_by_missing_evidence", "label": label, "missing": [fact_path]}

    # alpha.5.2: tenant_statusで "missing"/"unknown"/None は証跡不足として扱う
    if fact_val in ("missing", "unknown", "waiting", None):
        return {"status": "blocked_by_missing_evidence", "label": label, "missing": [fact_path],
                "actual": fact_val}

    try:
        if op == "==": ok = fact_val == value
        elif op == "!=": ok = fact_val != value
        elif op == ">": ok = fact_val > value
        elif op == ">=": ok = fact_val >= value
        elif op == "<": ok = fact_val < value
        elif op == "<=": ok = fact_val <= value
        elif op == "in": ok = fact_val in value
        elif op == "not_in": ok = fact_val not in value
        elif op == "bool_true": ok = bool(fact_val) is True
        elif op == "bool_false": ok = bool(fact_val) is False
        else: ok = False
    except (TypeError, ValueError) as e:
        return {"status": "unknown", "label": label, "reason": f"comparison error: {e}"}

    return {"status": "clear" if ok else "not_clear", "label": label,
            "actual": fact_val, "missing": []}


def _aggregate_node(child_results: list, operator: str) -> dict:
    """all / any の結果集約。"""
    statuses = [r["status"] for r in child_results]
    satisfied = [r for r in child_results if r["status"] == "clear"]
    not_clear = [r for r in child_results if r["status"] == "not_clear"]
    missing = [r for r in child_results if r["status"] == "blocked_by_missing_evidence"]
    held_mapping = [r for r in child_results if r["status"] == "blocked_by_unverified_mapping"]

    if operator == "all":
        if all(s == "clear" for s in statuses):
            overall = "clear"
        elif any(s == "not_clear" for s in statuses):
            overall = "not_clear"
        elif held_mapping and not not_clear:
            # mapping保留がある場合
            overall = "blocked_by_unverified_mapping" if not satisfied else "partially_clear"
        elif missing and not not_clear:
            overall = "blocked_by_missing_evidence" if not satisfied else "partially_clear"
        else:
            overall = "unknown"
    else:  # any
        if any(s == "clear" for s in statuses):
            overall = "clear"
        elif all(s == "blocked_by_missing_evidence" for s in statuses):
            overall = "blocked_by_missing_evidence"
        elif all(s == "blocked_by_unverified_mapping" for s in statuses):
            overall = "blocked_by_unverified_mapping"
        elif all(s == "not_clear" for s in statuses):
            overall = "not_clear"
        else:
            # 一部missing/mapping保留・一部not_clear等の混在
            if any(s in ("blocked_by_missing_evidence", "blocked_by_unverified_mapping")
                   for s in statuses):
                overall = "partially_clear"
            else:
                overall = "not_clear"

    return {
        "status": overall,
        "satisfied": satisfied,
        "not_clear": not_clear,
        "missing_evidence_nodes": missing,
        "mapping_held_nodes": held_mapping,
        "all_children": child_results,
    }


def evaluate_node(node: dict, facts: dict, mapping_unverified: bool = False) -> dict:
    """ノードを再帰評価。"""
    op = node.get("operator") or node.get("type")
    if op == "condition" or "fact" in node:
        return evaluate_condition(node, facts, mapping_unverified=mapping_unverified)
    if op in ("all", "any"):
        children = node.get("children") or []
        child_results = [evaluate_node(c, facts, mapping_unverified) for c in children]
        return {**_aggregate_node(child_results, op), "operator": op,
                "label": node.get("description") or node.get("label", op)}
    return {"status": "unknown", "label": node.get("label", "unknown_node"),
            "reason": f"unknown node operator: {op}"}


def evaluate_requirement_logic(logic: dict | None, facts: dict, item_meta: dict) -> dict:
    """加算1件の要件論理式を評価する公開API。

    item_meta: 加算自身のメタ情報（source_status, applicability等）を渡す
    """
    notes: list[str] = []
    pattern_unverified_warning = False
    mapping_unverified = False

    # facts側の警告（service-level）
    smap = (facts.get("receipt_pdf") or {}).get("service_code_mapping_status")
    service_level_unverified = (smap == "pattern_based_unverified")

    # alpha.5.5: per-kasan mapping_status は item_meta から優先
    kasan_mapping_status = item_meta.get("service_code_mapping_status")
    if kasan_mapping_status == "checked":
        # 公式コード表で照合済 → mapping依存factも信頼してよい
        mapping_unverified = False
        notes.append("この加算の service_code_mapping_status は checked（公式サービスコード表で照合済）。")
    elif kasan_mapping_status == "not_applicable":
        # mapping_status=not_applicable は applicability と独立に処理（applicability側で別途check）
        mapping_unverified = False
    elif service_level_unverified or kasan_mapping_status == "pattern_based_unverified":
        pattern_unverified_warning = True
        mapping_unverified = True
        notes.append(PATTERN_UNVERIFIED_NOTE)

    # 安全弁1: applicability=not_applicable
    if item_meta.get("applicability") == "not_applicable":
        return {
            "status": "not_applicable",
            "logic_status": "n/a",
            "source_status": item_meta.get("source_status"),
            "satisfied_route": [],
            "failed_conditions": [],
            "missing_evidence": [],
            "applicability_reason": item_meta.get("applicability_reason"),
            "notes": ["このサービスでは算定対象外（公式根拠で確認済）"],
        }

    # 安全弁2: source_status != checked
    src = item_meta.get("source_status")
    if src and src != "checked":
        return {
            "status": "not_evaluated_source_required",
            "logic_status": "n/a",
            "source_status": src,
            "satisfied_route": [],
            "failed_conditions": [],
            "missing_evidence": [],
            "notes": [f"source_status={src} のため要件論理式を評価しません"],
        }

    # logicが無い
    if not logic:
        return {
            "status": "unknown",
            "logic_status": "absent",
            "source_status": src,
            "satisfied_route": [],
            "failed_conditions": [],
            "missing_evidence": [],
            "notes": ["要件論理式が未登録（logic未構造化）"],
        }

    # 安全弁3: logic_status != checked
    logic_status = logic.get("logic_status", "draft")
    if logic_status != "checked":
        return {
            "status": "not_evaluated_logic_unchecked",
            "logic_status": logic_status,
            "source_status": src,
            "satisfied_route": [],
            "failed_conditions": [],
            "missing_evidence": [],
            "notes": [f"logic_status={logic_status} のため要件論理式を評価しません"],
        }

    # 評価実行
    result = evaluate_node(logic, facts, mapping_unverified=mapping_unverified)

    satisfied_route = []
    failed = []
    missing = set()
    mapping_held = []

    def collect(r: dict, suppress_blocked: bool = False):
        """alpha.5.3: any配下の未達ルートはanyが満たされている場合は不足扱いしない。
        suppress_blocked=True の文脈では blocked_by_missing_evidence / blocked_by_unverified_mapping を
        収集しない（代替ルートで満たされた場合に未達ルートを「不足証跡」として表示しない）。"""
        if "all_children" in r:
            op = r.get("operator")
            # any が clear のときは、子の blocked ルートを「不足証跡」として残さない（代替で達成済）
            child_suppress = suppress_blocked or (op == "any" and r.get("status") == "clear")
            for child in r["all_children"]:
                collect(child, suppress_blocked=child_suppress)
        else:
            if r["status"] == "clear":
                satisfied_route.append(r.get("label"))
            elif r["status"] == "not_clear":
                failed.append(r.get("label"))
            elif r["status"] == "blocked_by_missing_evidence":
                if not suppress_blocked:
                    for m in r.get("missing", []):
                        missing.add(m)
            elif r["status"] == "blocked_by_unverified_mapping":
                if not suppress_blocked:
                    mapping_held.append(r.get("label"))

    collect(result)

    final_status = result["status"]
    final_notes = list(notes) + [DEFAULT_DISCLAIMER]
    if mapping_held:
        final_notes.append(MAPPING_DEPENDENT_HOLD_NOTE)

    return {
        "status": final_status,
        "logic_status": logic_status,
        "source_status": src,
        "satisfied_route": satisfied_route,
        "failed_conditions": failed,
        "missing_evidence": sorted(missing),
        "mapping_held_conditions": mapping_held,
        "notes": final_notes,
    }


def build_facts_from_evidence(evidence: dict | None, tenant_status: dict | None = None) -> dict:
    """evidence JSONとtenant_statusから DSL 用 facts を組み立てる（既存tenant_status形式）"""
    facts: dict = {"receipt_pdf": {}, "tenant_status": {}}
    if evidence:
        e = evidence.get("evidence", [evidence])[0] if isinstance(evidence.get("evidence"), list) else evidence
        for k in ("total_users_estimated", "yokaigo_3plus_ratio", "raw_yokaigo_3plus_ratio",
                  "extraction_confidence", "service_code_mapping_status",
                  "current_kasan_counts", "detected_service_codes",
                  "service_category_counts", "time_band_counts"):
            if k in e:
                facts["receipt_pdf"][k] = e[k]
    if tenant_status:
        facts["tenant_status"] = tenant_status.get("requirement_status", {})
    return facts


def load_demo_tenant_status(path: str) -> dict | None:
    """alpha.5.2: DEMO tenant_status JSONを読み込む。
    facts: {dotted_key: value} 形式を期待。"""
    import json
    from pathlib import Path
    p = Path(path)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def merge_demo_tenant_facts(base_facts: dict, demo_tenant_status: dict | None) -> dict:
    """DEMO tenant_status の facts を、ドット記法のままbase_factsへマージ。
    receipt_pdf.* は上書きしない（evidence優先）。
    既存tenant_status (requirement_status形式) を壊さない。"""
    if not demo_tenant_status:
        return base_facts
    out = dict(base_facts)
    out.setdefault("tenant_status", {})

    demo_facts = demo_tenant_status.get("facts", {}) or {}
    for dotted_key, value in demo_facts.items():
        # receipt_pdf.* は上書き禁止
        if dotted_key.startswith("receipt_pdf."):
            continue
        # tenant_status.X.Y → out["tenant_status"]["X"]["Y"] = value
        if dotted_key.startswith("tenant_status."):
            parts = dotted_key.split(".")[1:]  # tenant_status を除く
            cur = out["tenant_status"]
            for p in parts[:-1]:
                if not isinstance(cur.get(p), dict):
                    cur[p] = {}
                cur = cur[p]
            cur[parts[-1]] = value
        else:
            # その他のfact path（任意拡張）
            parts = dotted_key.split(".")
            cur = out
            for p in parts[:-1]:
                if not isinstance(cur.get(p), dict):
                    cur[p] = {}
                cur = cur[p]
            cur[parts[-1]] = value
    return out


def load_evidence_labels(path: str | None = None) -> dict:
    """evidence_labels.jsonをロード。"""
    import json
    from pathlib import Path
    if path is None:
        path = str(Path(__file__).resolve().parent.parent / "config" / "evidence_labels.json")
    p = Path(path)
    if not p.exists():
        return {"labels": {}, "default_priority": "中"}
    return json.loads(p.read_text(encoding="utf-8"))


# ============================================================
# alpha.5.3: DEMO staff.json bridge
# ============================================================

# 介護福祉士+実務者+基礎研修+介護職員基礎研修 を「介護福祉士等」とみなす分類
FUKUSHISHI_TOU_KEYWORDS = (
    "介護福祉士", "実務者", "基礎研修", "介護職員基礎研修",
)
KAIGO_FUKUSHISHI_KEYWORDS = ("介護福祉士",)
KANGO_KEYWORDS = ("看護師", "准看護師")
KAIGO_QUALIFICATION_KEYWORDS = (
    "介護福祉士", "実務者", "基礎研修", "初任者", "ホームヘルパー",
)
RIHA_KEYWORDS = ("理学療法士", "作業療法士", "言語聴覚士")
KINOU_KUNREN_QUALIFICATION_KEYWORDS = (
    # 機能訓練指導員: PT/OT/ST/看護師/柔整師/あん摩マッサージ指圧師/鍼灸師/介護福祉士(実務経験要件あり)
    "理学療法士", "作業療法士", "言語聴覚士", "看護師", "准看護師",
    "柔道整復師", "あん摩マッサージ指圧師", "あマ指師", "鍼灸師",
    "はり師", "きゅう師", "介護福祉士",
)
SHUNIN_CM_KEYWORDS = ("主任介護支援専門員", "主任ケアマネ")
CM_KEYWORDS = ("介護支援専門員", "ケアマネ")


def load_staff_data(path: str) -> dict | None:
    """alpha.5.3: DEMO staff.json をロード。"""
    import json
    from pathlib import Path
    p = Path(path)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def _has_keyword(quals: list, keywords: tuple) -> bool:
    if not isinstance(quals, list):
        return False
    return any(any(k in q for k in keywords) for q in quals if isinstance(q, str))


def _ratio(num: float, den: float) -> float | None:
    """ゼロ除算回避。den<=0 なら None を返す（factとして"missing"扱いになる）"""
    if den is None or den <= 0:
        return None
    return round(num / den, 4)


def build_facts_from_staff_data(staff_data: dict | None,
                                 service_key: str | None = None) -> dict:
    """staff.json から staff_summary.* facts を組み立てる。

    sample_policy != "public_demo_synthetic" の場合は安全側で empty を返す
    （現alphaは公開デモ専用の機械的推定）。

    返り値は staff_summary 名前空間にぶら下がる dotted-keys の辞書。
    """
    out: dict = {}
    if not staff_data:
        return out
    if staff_data.get("sample_policy") != "public_demo_synthetic":
        return out
    staff_list = staff_data.get("staff") or []
    if not isinstance(staff_list, list):
        return out
    active = [s for s in staff_list if isinstance(s, dict) and s.get("active") is True]

    # --- 役割別カウント ---
    saseki = [s for s in active if s.get("role") in ("saseki", "saseki_uwanose")]
    saseki_uwanose = [s for s in active if s.get("role") == "saseki_uwanose"]
    helpers = [s for s in active if s.get("role") == "helper"]
    kango = [s for s in active if s.get("role") == "kango"]
    kaigo = [s for s in active if s.get("role") == "kaigo"]
    riha = [s for s in active if s.get("role") in ("rihabilitation", "kinou_kunren")]
    kinou_kunren = [s for s in active if s.get("role") == "kinou_kunren"]
    cm = [s for s in active if s.get("role") == "cm"]
    shunin_cm = [s for s in active if s.get("role") == "shunin_cm"]

    def _fte_sum(arr: list) -> float:
        return round(sum((s.get("fte") or 0) for s in arr), 4)

    # --- 訪問介護 staff_summary (8 facts) ---
    if service_key == "houmon_kaigo" or service_key is None:
        helper_total = len(helpers)
        helper_kaigo_fukushi = sum(
            1 for s in helpers if _has_keyword(s.get("qualifications") or [], KAIGO_FUKUSHISHI_KEYWORDS)
        )
        helper_fukushi_tou = sum(
            1 for s in helpers if _has_keyword(s.get("qualifications") or [], FUKUSHISHI_TOU_KEYWORDS)
        )
        helper_qualified_any = sum(
            1 for s in helpers if _has_keyword(s.get("qualifications") or [], KAIGO_QUALIFICATION_KEYWORDS)
        )
        out["staff_summary.saseki_qualified_count"] = sum(
            1 for s in saseki if (s.get("qualifications") or [])
        )
        out["staff_summary.saseki_uwanose_fte"] = _fte_sum(saseki_uwanose)
        out["staff_summary.helper_total_count"] = helper_total
        out["staff_summary.helper_total_fte"] = _fte_sum(helpers)
        out["staff_summary.helper_kaigo_fukushishi_count"] = helper_kaigo_fukushi
        out["staff_summary.helper_kaigo_fukushishi_ratio"] = _ratio(helper_kaigo_fukushi, helper_total)
        out["staff_summary.helper_fukushishi_jitsumusha_kiso_ratio"] = _ratio(helper_fukushi_tou, helper_total)
        out["staff_summary.helper_qualified_any_count"] = helper_qualified_any

    # --- 通所介護 staff_summary (6 facts) ---
    if service_key == "tsusho_kaigo" or service_key is None:
        kinou_kunren_qualified = any(
            _has_keyword(s.get("qualifications") or [], KINOU_KUNREN_QUALIFICATION_KEYWORDS)
            for s in active if s.get("role") in ("kinou_kunren", "kango", "rihabilitation", "kaigo")
        )
        out["staff_summary.kango_count"] = len(kango)
        out["staff_summary.kango_fte"] = _fte_sum(kango)
        out["staff_summary.kaigo_count"] = len(kaigo)
        out["staff_summary.kaigo_fte"] = _fte_sum(kaigo)
        out["staff_summary.kango_kaigo_total_fte"] = round(_fte_sum(kango) + _fte_sum(kaigo), 4)
        out["staff_summary.kinou_kunren_qualified"] = bool(kinou_kunren_qualified)

    # --- 訪問看護(介護保険) staff_summary (4 facts) ---
    if service_key == "houmon_kango_kaigo" or service_key is None:
        kango_joukin = [s for s in kango if s.get("is_joukin") is True]
        out["staff_summary.kango_count"] = len(kango)
        out["staff_summary.kango_fte"] = _fte_sum(kango)
        out["staff_summary.kango_joukin_count"] = len(kango_joukin)
        out["staff_summary.rihabilitation_count"] = len(riha)

    # --- 居宅介護支援 staff_summary (3 facts) ---
    if service_key == "kyotaku_shien" or service_key is None:
        all_cm = cm + shunin_cm
        out["staff_summary.cm_count"] = len(all_cm)
        out["staff_summary.shunin_cm_count"] = len(shunin_cm)
        out["staff_summary.cm_total_fte"] = _fte_sum(all_cm)

    return out


def merge_requirement_facts(base_facts: dict,
                             staff_summary_facts: dict | None,
                             user_summary_facts: dict | None = None) -> dict:
    """staff_summary / user_summary facts を base_facts にマージする。

    マージ優先: receipt_pdf > tenant_status > staff_summary > user_summary
    （user_summary は他の名前空間を上書きしない・他から上書きされる）

    各facts は dotted-keys（"staff_summary.X" / "user_summary.X"）の辞書を期待。
    """
    out = dict(base_facts)
    out.setdefault("staff_summary", {})
    out.setdefault("user_summary", {})

    def _merge_namespace(facts: dict | None, expected_prefix: str, target_dict: dict):
        if not facts:
            return
        for dotted_key, value in facts.items():
            if not isinstance(dotted_key, str):
                continue
            # クロス名前空間上書き禁止
            if dotted_key.startswith("receipt_pdf.") or dotted_key.startswith("tenant_status."):
                continue
            if not dotted_key.startswith(expected_prefix + "."):
                continue
            parts = dotted_key.split(".")[1:]  # 名前空間prefix を除く
            cur = target_dict
            for p in parts[:-1]:
                if not isinstance(cur.get(p), dict):
                    cur[p] = {}
                cur = cur[p]
            cur[parts[-1]] = value

    _merge_namespace(staff_summary_facts, "staff_summary", out["staff_summary"])
    _merge_namespace(user_summary_facts, "user_summary", out["user_summary"])
    return out


def build_staff_summary_display(staff_summary_facts: dict | None,
                                  service_key: str | None = None) -> dict:
    """レポート表示用の集計サマリ。
    個別 staff の display_label・staff_id・資格詳細は含めない。
    集計値（件数・常勤換算合計・比率）のみ。"""
    if not staff_summary_facts:
        return {}
    return {k.replace("staff_summary.", ""): v
            for k, v in staff_summary_facts.items() if isinstance(k, str)}


# ============================================================
# alpha.5.4: DEMO user_summary bridge
# ============================================================

# raw個票項目の許可リスト（user_summary jsonに含まれてはいけない項目）
USER_SUMMARY_FORBIDDEN_FIELDS = (
    # PII raw fields - これらが入っていたら即座に空dict返す
    "users", "user_list", "user_records",
    "name", "kana", "kanji_name", "user_name",
    "birth", "birthday", "birth_date", "date_of_birth",
    "address", "phone", "phone_number", "tel", "email",
    "hihokensha_number", "insured_number",
    "shinsei_number",
    "family_member", "family", "kazoku",
    "iryo_kikan_name", "hospital_name", "doctor_name",
    "shoubyou_name", "byoumei", "diagnosis_text",
)


def load_user_summary(path: str) -> dict | None:
    """alpha.5.4: DEMO user_summary.json をロード。"""
    import json
    from pathlib import Path
    p = Path(path)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def _user_summary_is_safe(user_summary: dict) -> bool:
    """user_summary に raw個票・PIIフィールドが含まれていないか検査。
    1個でも禁止フィールドがあれば False（その場合factsを生成しない）。"""
    if not isinstance(user_summary, dict):
        return False

    def _walk(node):
        if isinstance(node, dict):
            for k in node:
                if k in USER_SUMMARY_FORBIDDEN_FIELDS:
                    return True  # forbidden detected
                if _walk(node[k]):
                    return True
        elif isinstance(node, list):
            for item in node:
                if _walk(item):
                    return True
        return False
    return not _walk(user_summary)


def build_facts_from_user_summary(user_summary: dict | None,
                                    service_key: str | None = None) -> dict:
    """user_summary.json から user_summary.* facts を組み立てる。

    sample_policy != "public_demo_synthetic" の場合は安全側で empty を返す。
    raw個票・PIIフィールドが含まれている場合も empty を返す。

    返り値は user_summary 名前空間の dotted-keys 辞書。
    facts の値は集計値のみ（件数・比率・期間）であり、個別利用者を特定できる値は含まれない。
    """
    out: dict = {}
    if not user_summary:
        return out
    if user_summary.get("sample_policy") != "public_demo_synthetic":
        return out
    if not _user_summary_is_safe(user_summary):
        return out

    # source / 期間
    out["user_summary.data_source_type"] = user_summary.get("data_source_type", "demo_aggregate")
    out["user_summary.source_status"] = user_summary.get("source_status", "demo_aggregate_unverified")
    period = user_summary.get("target_period") or {}
    if "start" in period:
        out["user_summary.target_period_start"] = period["start"]
    if "end" in period:
        out["user_summary.target_period_end"] = period["end"]

    # 集計値（件数・比率）
    direct_keys = (
        "users_total",
        "care_level_3_or_higher_count",
        "care_level_3_or_higher_ratio",
        "care_level_4_or_higher_count",
        "care_level_4_or_higher_ratio",
        "severe_user_count",
        "severe_user_ratio",
        "dementia_related_count",
        "medical_dependency_count",
        "terminal_care_related_count",
        "discharge_support_related_count",
        "emergency_response_related_count",
    )
    for k in direct_keys:
        if k in user_summary:
            out[f"user_summary.{k}"] = user_summary[k]

    # 分布（dictとして保持・個別の利用者は含まれない集計）
    cl_dist = user_summary.get("care_level_distribution")
    if isinstance(cl_dist, dict):
        out["user_summary.care_level_distribution"] = cl_dist
    dem_dist = user_summary.get("dementia_care_level_distribution")
    if isinstance(dem_dist, dict):
        out["user_summary.dementia_care_level_distribution"] = dem_dist

    return out


def build_user_summary_display(user_summary_facts: dict | None,
                                  service_key: str | None = None) -> dict:
    """レポート表示用の集計サマリ。
    個別利用者の氏名・被保険者番号・住所・生年月日・電話・家族・医療機関名・病名は含めない。
    集計値（件数・比率・期間）のみ。"""
    if not user_summary_facts:
        return {}
    return {k.replace("user_summary.", ""): v
            for k, v in user_summary_facts.items() if isinstance(k, str)}


def build_evidence_checklist(dsl_results: dict, judgements: dict, label_config: dict) -> list[dict]:
    """不足証跡チェックリストを生成。alpha.5.3で次アクション列を追加。"""
    labels = label_config.get("labels", {})
    default_priority = label_config.get("default_priority", "中")
    default_next_action = label_config.get("default_next_action",
                                            "事業所内で資料の有無を確認する")
    checklist = []
    for kasan_key, dsl in dsl_results.items():
        if dsl.get("status") not in ("blocked_by_missing_evidence", "partially_clear",
                                      "blocked_by_unverified_mapping"):
            continue
        kasan_name = (judgements.get(kasan_key) or {}).get("name", kasan_key)
        # 不足証跡（missing_evidence）
        for fact_path in dsl.get("missing_evidence", []):
            label_info = labels.get(fact_path, {})
            checklist.append({
                "kasan_key": kasan_key,
                "kasan_name": kasan_name,
                "fact_path": fact_path,
                "label": label_info.get("label", fact_path),
                "recommended_documents": label_info.get("recommended_documents", []),
                "priority": label_info.get("priority", default_priority),
                "next_action": label_info.get("next_action", default_next_action),
                "category": "missing_evidence",
            })
        # mapping保留
        for held_label in dsl.get("mapping_held_conditions", []):
            checklist.append({
                "kasan_key": kasan_key,
                "kasan_name": kasan_name,
                "fact_path": "(service_code_mapping)",
                "label": f"{held_label}（サービスコード照合未完了のため保留）",
                "recommended_documents": ["公式サービスコード表照合"],
                "priority": "中",
                "next_action": "サービスコード表との照合を実施する",
                "category": "mapping_unverified",
            })
    # 優先度順ソート
    priority_order = {"高": 0, "中": 1, "低": 2, "High": 0, "Medium": 1, "Low": 2}
    checklist.sort(key=lambda x: priority_order.get(x.get("priority", default_priority), 99))
    return checklist

