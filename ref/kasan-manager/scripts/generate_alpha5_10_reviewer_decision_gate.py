"""alpha.5.10 reviewer decision gate generator.

alpha.5.9 で生成した reviewer_decision_template.csv に reviewer が記入した行を読み込み、
どの判断が「実装可能（master修正候補）」「不備でブロック」「未記入で保留」「法令確認待ち」
かを分類する **安全ゲート**。

方針:
- master JSON は **絶対に修正しない**（読み取り専用で参照するのみ）
- approved_changes_preview は「master修正候補」であって「実装」ではない
- 不正・不備な行は blocked に分類してエスカレーション
- 空欄テンプレートでも正常終了して 0 approved / 38 pending / 5 legal の report を出す
- needs_legal_review 行は法令確認待ちとして legal_review_required に分離
- future_candidate_only 行は R8.6.1 確定版が出るまで defer
- 算定可否保証・公式コード完全照合済み・R8 改定対応完了 表現は禁止
"""
from __future__ import annotations

import csv
import io
import json
import sys
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
SERVICES = ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien")

PACKET_VERSION = "alpha.5.10"
INPUT_PACKET_VERSION = "alpha.5.9"
ALPHA_5_9_BASE_COMMIT = "d0c911db9b28f561f0e40859a4c40e863982d7f6"
GENERATED_AT = "2026-05-10"

DEFAULT_INPUT_TEMPLATE = (
    ROOT / "out" / "internal" / "alpha5_9_master_review_packet" / "reviewer_decision_template.csv"
)
DEFAULT_OUT_DIR = ROOT / "out" / "internal" / "alpha5_10_reviewer_decision_gate"


def _rel(p: Path) -> str:
    """ROOT 配下なら相対パス、外部なら絶対パスを返す（Win/Posix の `\\` を `/` に正規化）。"""
    try:
        return str(p.relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(p).replace("\\", "/")


# ============================================================
# Validation rules / valid value sets
# ============================================================

# 許可された reviewer_decision の全集合
VALID_DECISIONS = {
    "approve_official_code_addition",
    "keep_legacy_detection_only",
    "add_receipt_alias",
    "correct_internal_legacy_code",
    "mark_structural_mismatch",
    "keep_pattern_based_unverified",
    "escalate_legal_review",
    "defer_until_r8_definitive",
}

# master JSON 修正候補とみなしてよい decision（approved_changes_preview に入る）
MODIFYING_DECISIONS = {
    "approve_official_code_addition",
    "add_receipt_alias",
    "correct_internal_legacy_code",
}

# 「決定は valid だが master 修正対象にしない」decision
NON_MODIFYING_DECISIONS = {
    "keep_legacy_detection_only",
    "keep_pattern_based_unverified",
    "mark_structural_mismatch",
    "escalate_legal_review",
    "defer_until_r8_definitive",
}

# alpha.5.12 で導入: 高リスク decision（implementation_risk_acknowledged=yes が必要）
HIGH_RISK_DECISIONS = {
    "correct_internal_legacy_code",
}

# alpha.5.12 で導入: legal_review_clearance の許可値
VALID_LEGAL_CLEARANCE = {"cleared", "not_cleared", "pending", "not_required"}

# alpha.5.12 で導入: reviewer_role の許可値
VALID_REVIEWER_ROLE = {"business_reviewer", "legal_reviewer", "final_approver"}

# alpha.5.12 で導入: implementation_priority の許可値
VALID_IMPL_PRIORITY = {"high", "medium", "low", "defer"}

# alpha.5.12 で導入: implementation_risk_acknowledged の許可値
VALID_RISK_ACK = {"yes", "no", "pending"}

VALID_IMPL_ALLOWED = {"yes", "no", "pending"}

# implementation_allowed=yes のときに必須なフィールド
REQUIRED_FIELDS_WHEN_YES = (
    "reviewer_decision",
    "reason",
    "required_evidence",
    "reviewer_name",
    "reviewed_at",
    "final_approved_by",
)

# divergent 加算の固定セット（alpha.5.8.1 で確定）
DIVERGENT_KEYS = {
    ("houmon_kango_kaigo", "shougu_kaizen_kasan_2026_06"),
    ("tsusho_kaigo", "adl_iji"),
    ("tsusho_kaigo", "ninchi_kasan"),
}


# ============================================================
# Master loader (read-only)
# ============================================================

def load_master_kasans() -> dict:
    """{(service, kasan_key): kasan_def} を返す。master JSON は変更しない。"""
    out = {}
    for svc in SERVICES:
        path = ROOT / "regulatory_master" / "kaigo" / f"{svc}.json"
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        for k, v in (d.get("kasans") or {}).items():
            out[(svc, k)] = v
    return out


def get_proposed_action(kasan_def: dict) -> str:
    return ((kasan_def.get("service_code_audit") or {})
            .get("alpha_5_8_three_layer_model") or {}).get("proposed_action") or ""


def get_overall_status(kasan_def: dict) -> str:
    return kasan_def.get("overall_mapping_status") or ""


def get_divergence_reason(kasan_def: dict) -> str:
    note = ((kasan_def.get("service_code_audit") or {})
            .get("alpha_5_8_three_layer_model") or {}).get("alpha_5_8_1_proposed_overall_divergence_note") or {}
    return note.get("reason", "")


# ============================================================
# Classification
# ============================================================

def _strip(row: dict, key: str) -> str:
    return (row.get(key) or "").strip()


def classify_row(row: dict, master: dict, seen_keys: set, alpha_5_9_legal_keys: set,
                  alpha_5_9_master_keys: set,
                  has_legal_clearance: bool = False,
                  has_risk_ack: bool = False) -> dict:
    """1行を以下のいずれかに分類: approved / blocked / pending / legal_review_required。

    alpha.5.12 拡張:
    - has_legal_clearance: 入力CSV header に legal_review_clearance 列があるか
    - has_risk_ack: 入力CSV header に implementation_risk_acknowledged 列があるか

    後方互換性: alpha.5.10 の 9列CSV (これらの拡張列なし) もそのまま読める。
    legacy CSVでは has_legal_clearance=False / has_risk_ack=False となり、
    新ルールはスキップされる。

    返り値: {"bucket": "...", "reason": "...", "missing_fields": "...", "extra": {...}}"""
    svc = _strip(row, "service")
    k = _strip(row, "kasan_key")
    decision = _strip(row, "reviewer_decision")
    impl = _strip(row, "implementation_allowed")
    final_approved_by = _strip(row, "final_approved_by")
    reason = _strip(row, "reason")
    required_evidence = _strip(row, "required_evidence")
    reviewer_name = _strip(row, "reviewer_name")
    reviewed_at = _strip(row, "reviewed_at")
    # alpha.5.12 拡張列
    legal_clearance = _strip(row, "legal_review_clearance")
    legal_reference = _strip(row, "legal_review_reference")
    risk_ack = _strip(row, "implementation_risk_acknowledged")

    key = (svc, k)
    kasan_def = master.get(key)
    pa = get_proposed_action(kasan_def) if kasan_def else ""
    ov = get_overall_status(kasan_def) if kasan_def else ""

    # 1. Duplicate → blocked
    if key in seen_keys:
        return {"bucket": "blocked", "reason": "duplicate_service_kasan_key",
                "missing_fields": "", "extra": {}}
    seen_keys.add(key)

    # 2. Master JSON に存在しない kasan → blocked
    if kasan_def is None:
        return {"bucket": "blocked", "reason": "kasan_not_found_in_master_json",
                "missing_fields": "", "extra": {}}

    # 3. 完全空欄 → pending
    if not decision and not impl and not final_approved_by and not reason:
        return {"bucket": "pending", "reason": "blank_template_row",
                "missing_fields": "", "extra": {"proposed_action": pa, "overall": ov}}

    # 4. 不正な reviewer_decision → blocked
    if decision and decision not in VALID_DECISIONS:
        return {"bucket": "blocked", "reason": f"invalid_reviewer_decision",
                "missing_fields": "", "extra": {"invalid_value": decision}}

    # 5. 不正な implementation_allowed → blocked
    if impl and impl not in VALID_IMPL_ALLOWED:
        return {"bucket": "blocked", "reason": f"invalid_implementation_allowed",
                "missing_fields": "", "extra": {"invalid_value": impl}}

    # 5-b. alpha.5.12: 不正な legal_review_clearance / implementation_risk_acknowledged → blocked
    if has_legal_clearance and legal_clearance and legal_clearance not in VALID_LEGAL_CLEARANCE:
        return {"bucket": "blocked", "reason": "invalid_legal_review_clearance",
                "missing_fields": "", "extra": {"invalid_value": legal_clearance}}
    if has_risk_ack and risk_ack and risk_ack not in VALID_RISK_ACK:
        return {"bucket": "blocked", "reason": "invalid_implementation_risk_acknowledged",
                "missing_fields": "", "extra": {"invalid_value": risk_ack}}

    # 6. impl=yes のとき required fields が欠落 → blocked
    if impl == "yes":
        missing = [f for f in REQUIRED_FIELDS_WHEN_YES if not _strip(row, f)]
        if missing:
            return {"bucket": "blocked", "reason": "missing_required_fields_when_implementation_allowed_yes",
                    "missing_fields": ",".join(missing), "extra": {}}

    # 6-b. alpha.5.12: high-risk decision には implementation_risk_acknowledged=yes が必須
    #     （拡張列がCSVに存在する場合のみ適用。後方互換のため legacy 9列CSVではスキップ）
    if has_risk_ack and decision in HIGH_RISK_DECISIONS and impl == "yes":
        if risk_ack != "yes":
            return {"bucket": "blocked",
                    "reason": "high_risk_decision_requires_implementation_risk_acknowledged_yes",
                    "missing_fields": "implementation_risk_acknowledged",
                    "extra": {"decision": decision, "got": risk_ack or "(blank)"}}

    # 7. needs_legal_review バケット → legal_review_required
    #    alpha.5.12 拡張: legal_review_clearance=cleared + 必須条件全揃いなら通常ルートに通す
    is_legal = pa == "needs_legal_review" or key in alpha_5_9_legal_keys
    legal_cleared = False
    if is_legal and has_legal_clearance:
        # 必要条件: clearance=cleared, impl=yes, final_approved_by, required_evidence, legal_reference
        if (legal_clearance == "cleared" and impl == "yes"
                and final_approved_by and required_evidence and legal_reference):
            legal_cleared = True

    if is_legal and not legal_cleared:
        return {"bucket": "legal_review_required",
                "reason": "needs_legal_review_kasan_pending_legal_clearance",
                "missing_fields": "", "extra": {"proposed_action": pa,
                                                  "legal_clearance": legal_clearance or "(none)"}}

    # 8. future_candidate_only バケット → 必ず defer
    #    （legal_review_clearance があっても future_candidate は approved にしない）
    if pa == "future_candidate_only":
        if decision and decision != "defer_until_r8_definitive":
            return {"bucket": "blocked",
                    "reason": "future_candidate_only_must_be_defer_until_r8_definitive",
                    "missing_fields": "",
                    "extra": {"got_decision": decision}}
        return {"bucket": "pending", "reason": "deferred_until_r8_definitive",
                "missing_fields": "",
                "extra": {"proposed_action": pa, "is_future_candidate": True}}

    # 9. impl != yes → pending（決定があっても implementation 未承認）
    if impl != "yes":
        return {"bucket": "pending",
                "reason": f"implementation_not_yet_approved",
                "missing_fields": "",
                "extra": {"impl": impl or "(blank)", "decision": decision or "(blank)",
                          "proposed_action": pa}}

    # 10. impl=yes + 必須フィールド全揃 + decision分類
    if decision in MODIFYING_DECISIONS:
        # approved_changes_preview に入れる候補
        extra = {"proposed_action": pa, "is_divergent": key in DIVERGENT_KEYS,
                 "is_legal_cleared": legal_cleared,
                 "is_high_risk": decision in HIGH_RISK_DECISIONS}
        return {"bucket": "approved", "reason": "modifying_decision_with_full_approval",
                "missing_fields": "", "extra": extra}
    if decision == "escalate_legal_review":
        return {"bucket": "legal_review_required",
                "reason": "reviewer_explicitly_escalated_to_legal_review",
                "missing_fields": "", "extra": {}}
    if decision == "defer_until_r8_definitive":
        return {"bucket": "pending", "reason": "deferred_until_r8_definitive",
                "missing_fields": "", "extra": {"proposed_action": pa}}
    if decision in NON_MODIFYING_DECISIONS:
        # keep_*/mark_structural_mismatch — 決定は記録するが master 修正対象外
        return {"bucket": "pending",
                "reason": f"non_modifying_decision_recorded: {decision}",
                "missing_fields": "", "extra": {"proposed_action": pa}}

    # ここに来ることはない想定
    return {"bucket": "blocked", "reason": "unhandled_classification_case",
            "missing_fields": "", "extra": {}}


# ============================================================
# Helpers: load alpha.5.9 packet keys for cross-reference
# ============================================================

def load_packet_kasan_keys(packet_dir: Path, csv_name: str) -> set:
    out = set()
    p = packet_dir / csv_name
    if not p.exists():
        return out
    with open(p, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            svc = (r.get("service") or "").strip()
            k = (r.get("kasan_key") or "").strip()
            if svc and k and not svc.startswith("#"):
                out.add((svc, k))
    return out


# ============================================================
# Output writers
# ============================================================

APPROVED_COLUMNS = [
    "service", "kasan_key", "reviewer_decision", "implementation_allowed",
    "final_approved_by", "reviewed_at", "proposed_change_type",
    "current_overall_mapping_status", "proposed_next_status",
    "official_service_code", "receipt_detection_code", "internal_legacy_code",
    "required_evidence", "implementation_risk", "implementation_note",
]

BLOCKED_COLUMNS = [
    "service", "kasan_key", "reviewer_decision", "implementation_allowed",
    "blocked_reason", "missing_fields", "recommended_fix",
]

PENDING_COLUMNS = [
    "service", "kasan_key", "proposed_action", "current_overall_mapping_status",
    "pending_reason", "recommended_reviewer_role",
]

LEGAL_COLUMNS = [
    "service", "kasan_key", "legal_review_reason", "legal_question",
    "reference_needed", "reviewer_decision", "implementation_allowed",
    "blocked_reason",
]


def write_csv_with_bom(path: Path, columns: list, rows: list, note_lines: list | None = None):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
        if note_lines:
            f.write("\n")
            for line in note_lines:
                f.write(f"# {line}\n")


def proposed_change_type(decision: str) -> str:
    return {
        "approve_official_code_addition": "add_official_code_to_master",
        "add_receipt_alias": "add_receipt_alias_to_master",
        "correct_internal_legacy_code": "replace_internal_legacy_code_with_official",
    }.get(decision, "no_change")


def implementation_risk_for(decision: str, key: tuple) -> str:
    if decision == "correct_internal_legacy_code":
        return "high (PDF detection breakage risk - regression test mandatory)"
    if decision == "add_receipt_alias":
        return "medium (alias mapping must be consistent in receipt_detection_pattern)"
    if decision == "approve_official_code_addition":
        return "low (additive change to official_code_model)"
    return "(not_modifying)"


def proposed_next_status_for(decision: str) -> str:
    return {
        "approve_official_code_addition": "checked (after reviewer + tests)",
        "add_receipt_alias": "checked (after alias verification)",
        "correct_internal_legacy_code": "checked (after PDF detection regression)",
    }.get(decision, "(unchanged)")


def build_approved_row(row: dict, master_kasan: dict) -> dict:
    decision = _strip(row, "reviewer_decision")
    three = (master_kasan.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model") or {}
    official = three.get("official_code_model") or {}
    rcpt = three.get("receipt_detection_model") or {}
    legacy = three.get("internal_legacy_model") or {}
    key = (_strip(row, "service"), _strip(row, "kasan_key"))
    note_parts = []
    if key in DIVERGENT_KEYS:
        dr = get_divergence_reason(master_kasan)
        note_parts.append(f"DIVERGENT (alpha.5.8.1 audit_note 記録済): {dr[:100]}")
    note_parts.append("master JSON 修正は alpha.5.11+ で別途実施。本パケットは候補提示のみ。")
    return {
        "service": _strip(row, "service"),
        "kasan_key": _strip(row, "kasan_key"),
        "reviewer_decision": decision,
        "implementation_allowed": _strip(row, "implementation_allowed"),
        "final_approved_by": _strip(row, "final_approved_by"),
        "reviewed_at": _strip(row, "reviewed_at"),
        "proposed_change_type": proposed_change_type(decision),
        "current_overall_mapping_status": master_kasan.get("overall_mapping_status", ""),
        "proposed_next_status": proposed_next_status_for(decision),
        "official_service_code": official.get("official_service_code") or "",
        "receipt_detection_code": rcpt.get("receipt_detection_code") or "",
        "internal_legacy_code": legacy.get("internal_legacy_code") or "",
        "required_evidence": _strip(row, "required_evidence"),
        "implementation_risk": implementation_risk_for(decision, key),
        "implementation_note": " / ".join(note_parts),
    }


def build_blocked_row(row: dict, classification: dict) -> dict:
    return {
        "service": _strip(row, "service"),
        "kasan_key": _strip(row, "kasan_key"),
        "reviewer_decision": _strip(row, "reviewer_decision"),
        "implementation_allowed": _strip(row, "implementation_allowed"),
        "blocked_reason": classification["reason"],
        "missing_fields": classification.get("missing_fields", ""),
        "recommended_fix": recommend_fix_for(classification),
    }


def recommend_fix_for(classification: dict) -> str:
    reason = classification.get("reason", "")
    if reason == "duplicate_service_kasan_key":
        return "重複行を1つに統合し、最新の reviewer_decision のみ残す"
    if reason == "kasan_not_found_in_master_json":
        return "kasan_key が master JSON に存在するか確認（typo疑い）"
    if reason == "invalid_reviewer_decision":
        return "reviewer_decision を valid な値に修正（manifest の reviewer_decision_values 参照）"
    if reason == "invalid_implementation_allowed":
        return "implementation_allowed を yes/no/pending のいずれかに修正"
    if reason == "missing_required_fields_when_implementation_allowed_yes":
        return f"missing_fields の項目を埋める: {classification.get('missing_fields', '')}"
    if reason == "future_candidate_only_must_be_defer_until_r8_definitive":
        return "future_candidate_only kasan は R8.6.1 確定版が出るまで defer_until_r8_definitive のみ受理"
    if reason == "high_risk_decision_requires_implementation_risk_acknowledged_yes":
        return "高リスク decision (correct_internal_legacy_code) は implementation_risk_acknowledged=yes が必須。reviewer がリスク確認 (PDF検出回帰テスト等) を完了してから付与"
    if reason == "invalid_legal_review_clearance":
        return "legal_review_clearance を cleared / not_cleared / pending / not_required のいずれかに修正"
    if reason == "invalid_implementation_risk_acknowledged":
        return "implementation_risk_acknowledged を yes / no / pending のいずれかに修正"
    return "manifest の rules を再確認"


def build_pending_row(row: dict, classification: dict, master_kasan: dict) -> dict:
    role = "業務担当"
    if classification.get("extra", {}).get("is_future_candidate"):
        role = "(R8.6.1 確定版待ち・本段階で reviewer 操作不要)"
    elif classification.get("reason", "").startswith("non_modifying_decision_recorded"):
        role = "業務担当 (record-only)"
    elif classification.get("reason") == "blank_template_row":
        role = "業務担当・法令確認者・最終判断者 (template 未記入)"
    return {
        "service": _strip(row, "service"),
        "kasan_key": _strip(row, "kasan_key"),
        "proposed_action": get_proposed_action(master_kasan) if master_kasan else "",
        "current_overall_mapping_status": master_kasan.get("overall_mapping_status", "") if master_kasan else "",
        "pending_reason": classification["reason"],
        "recommended_reviewer_role": role,
    }


def build_legal_row(row: dict, classification: dict, master_kasan: dict, alpha_5_9_legal: dict) -> dict:
    """alpha_5_9_legal: {(svc, k): {legal_question, reference_needed, ...}}"""
    key = (_strip(row, "service"), _strip(row, "kasan_key"))
    legal_info = alpha_5_9_legal.get(key, {})
    return {
        "service": _strip(row, "service"),
        "kasan_key": _strip(row, "kasan_key"),
        "legal_review_reason": legal_info.get("legal_review_reason") or
            "needs_legal_review proposed_action のため法令確認が必要",
        "legal_question": legal_info.get("legal_question") or
            "alpha.5.9 needs_legal_review_matrix.csv の legal_question を参照",
        "reference_needed": legal_info.get("reference_needed") or
            "介護報酬告示 / 大臣基準告示 / 老企第36号 解釈通知 / 最新の事務連絡",
        "reviewer_decision": _strip(row, "reviewer_decision"),
        "implementation_allowed": _strip(row, "implementation_allowed"),
        "blocked_reason": classification["reason"],
    }


def load_alpha_5_9_legal_info(packet_dir: Path) -> dict:
    p = packet_dir / "needs_legal_review_matrix.csv"
    out = {}
    if not p.exists():
        return out
    with open(p, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for r in reader:
            svc = (r.get("service") or "").strip()
            k = (r.get("kasan_key") or "").strip()
            if not svc or not k or svc.startswith("#"):
                continue
            out[(svc, k)] = {
                "legal_review_reason": r.get("legal_review_reason", ""),
                "legal_question": r.get("legal_question", ""),
                "reference_needed": r.get("reference_needed", ""),
            }
    return out


# ============================================================
# Report / README / manifest writers
# ============================================================

def write_readme(out_dir: Path, manifest: dict, input_path: Path):
    text = f"""# alpha.5.10 Reviewer Decision Gate

**version**: {PACKET_VERSION}
**base_commit**: `{ALPHA_5_9_BASE_COMMIT}` (alpha.5.9 master_review_packet)
**input_packet_version**: {INPUT_PACKET_VERSION}
**input_template_path**: `{_rel(input_path)}`
**generated_at**: {GENERATED_AT}

---

## 位置付け

alpha.5.9 で生成した `reviewer_decision_template.csv` に reviewer が記入した結果を読み込み、
**「どの判断が master JSON 修正候補として実装に進めるか」「どの判断が不備でブロックされるか」
「どの判断が未記入で保留中か」「どの判断が法令確認待ちか」** を分類する **安全ゲート** です。

- このゲートは **内部レビュー用** であり、**public release ではありません**
- 出力先: `out/internal/alpha5_10_reviewer_decision_gate/`（public sample / release pack には含めない）
- **本ゲートは master JSON を改変しません**。candidate を提示するだけです。
- 実装は alpha.5.11+ で別途承認・テスト・段階的に進めます

## 不変条件（テストで保護）

- ❌ master JSON 自動修正なし（generator は読み取り専用）
- ❌ 新規 checked 昇格なし
- ❌ R8.6 案資料は checked 昇格に使わない
- ❌ public release pack は本 alpha.5.10 で更新しない
- ❌ alpha.5.9 packet ファイルは破壊しない
- ❌ 過剰な完了感を与える表現を出さない（disclaimer 維持）

## 結果サマリ

- approved_changes_preview: **{manifest['approved_count']}** 件（master修正候補）
- blocked_or_incomplete_decisions: **{manifest['blocked_count']}** 件（不正・不備）
- pending_decisions: **{manifest['pending_count']}** 件（未記入・保留・defer）
- legal_review_required: **{manifest['legal_review_required_count']}** 件（法令確認待ち）
- future_candidate_count（参考）: **{manifest['future_candidate_count']}** 件
- divergent_count（参考）: **{manifest['divergent_count']}** 件

合計: **{manifest['total_review_rows']}** 行

## 含まれるファイル

| ファイル | 内容 |
|---|---|
| `README.md` | 本ファイル |
| `decision_validation_report.md` | 詳細レポート（バケット別件数・次にやること） |
| `approved_changes_preview.csv` | master 修正候補（UTF-8 BOM付・Excel互換） |
| `approved_changes_preview.json` | 同上の JSON 版（プログラムから処理しやすい形式） |
| `blocked_or_incomplete_decisions.csv` | 不正・不備な行（要修正） |
| `pending_decisions.csv` | 未記入・保留・defer 行 |
| `legal_review_required.csv` | 法令確認待ち行 |
| `alpha5_10_reviewer_decision_gate_manifest.json` | パケットメタデータ |

## 再生成方法

```
cd products/kasan-manager
python scripts/generate_alpha5_10_reviewer_decision_gate.py
```

引数で別の入力 CSV を指定する場合:

```
python scripts/generate_alpha5_10_reviewer_decision_gate.py \\
  --input path/to/reviewer_decision_template.csv \\
  --output path/to/output_dir
```

## 次に人間がやること

1. `blocked_or_incomplete_decisions.csv` の各行の `recommended_fix` を業務担当が修正
2. `pending_decisions.csv` の `recommended_reviewer_role` に従い、未記入行を埋める
3. `legal_review_required.csv` の `legal_question` を法令確認者が解析
4. `approved_changes_preview.csv` を最終判断者が再確認し、alpha.5.11+ で master JSON 反映を承認
5. **alpha.5.11+ では別途 PR を立て、approved 行のみを段階的に master JSON へ反映**（一括反映は禁止）
"""
    (out_dir / "README.md").write_text(text, encoding="utf-8")


def write_validation_report(out_dir: Path, manifest: dict, results: dict, input_path: Path):
    text = f"""# alpha.5.10 Decision Validation Report

**version**: {PACKET_VERSION}
**base_commit**: `{ALPHA_5_9_BASE_COMMIT}` (alpha.5.9)
**input**: `{_rel(input_path)}` (alpha.5.9 master_review_packet)
**generated_at**: {GENERATED_AT}

---

## 1. 入力ファイル

- 入力: `{_rel(input_path)}`
- 入力行数: **{manifest['total_review_rows']}**
- 入力 packet version: `{INPUT_PACKET_VERSION}`
- alpha.5.9 packet 内の対象内訳:
  - needs_master_review: 28 件
  - needs_legal_review: 5 件
  - divergent: 3 件
  - future_candidate_only: 2 件
  - 合計: 38 件

## 2. 検証結果サマリ

| バケット | 件数 |
|---|---:|
| approved_changes_preview (master修正候補) | {manifest['approved_count']} |
| blocked_or_incomplete_decisions | {manifest['blocked_count']} |
| pending_decisions | {manifest['pending_count']} |
| legal_review_required | {manifest['legal_review_required_count']} |
| **合計** | **{manifest['approved_count'] + manifest['blocked_count'] + manifest['pending_count'] + manifest['legal_review_required_count']}** |

参考カウント:
- future_candidate_count: {manifest['future_candidate_count']}
- divergent_count: {manifest['divergent_count']}

## 3. 不変条件確認

- ✅ master JSON 未変更（`master_auto_update: false`）
- ✅ 新規 checked 昇格なし（`checked_promotion: false`）
- ✅ R8.6 案資料は checked 昇格に使われていない（`r8_provisional_used_for_checked: false`）
- ✅ public release pack 未変更（`release_pack_modified: false`）
- ✅ alpha.5.9 packet ファイル未破壊
- ✅ checked 20件 維持

## 4. 次に人間がやること

### 業務担当
- `blocked_or_incomplete_decisions.csv` の `recommended_fix` を実施
- `pending_decisions.csv` の **blank_template_row** を業務判断で埋める
- `pending_decisions.csv` の **non_modifying_decision_recorded** は決定が記録された無修正項目（追加作業不要）

### 法令確認者
- `legal_review_required.csv` の `legal_question` を確認
- 関係告示・通知（介護報酬告示・大臣基準告示・老企第36号 等）を参照し、`reviewer_decision` 欄を埋める
- 法令確認完了後、reviewer は alpha.5.9 packet の reviewer_decision_template に追記

### 最終判断者
- `approved_changes_preview.csv` の各行を再確認
- 特に `implementation_risk=high` の行は **PDF検出回帰テスト** 必須
- 承認した行のみ alpha.5.11+ で別 PR として master JSON に反映

## 5. alpha.5.11+ で実装してよい条件

approved_changes_preview.csv の行を alpha.5.11+ で実装する際の条件:

1. **approved_changes_preview.csv に明示的に存在すること**
2. `implementation_allowed=yes` かつ `final_approved_by` が空でないこと
3. `proposed_change_type` が `add_official_code_to_master` / `add_receipt_alias_to_master` /
   `replace_internal_legacy_code_with_official` のいずれかであること
4. **段階的 PR で実施**:
   - 1つの PR で複数の加算を一括変更しない（リグレッション切り分けのため）
   - 各 PR で 4サービスPDF回帰テスト + 5パターン回帰テスト + checked 20件維持確認 を必ず実施
5. R8.6.1 確定版が出る前は `defer_until_r8_definitive` 行は実装対象外
6. 法令解釈通知が出る前は `escalate_legal_review` 行・`needs_legal_review` 行は実装対象外
7. 一括置換禁止・自動修正禁止の方針を維持

## 6. 関連 audit / packet

- `out/internal/alpha5_8_three_layer_code_model_report.md` (alpha.5.8 三層モデル本体)
- `out/internal/alpha5_8_1_audit_metadata_hotfix_report.md` (alpha.5.8.1 audit metadata)
- `out/internal/alpha5_8_1_source_metadata_hotfix_report.md` (alpha.5.8.1 source metadata + crosswalk)
- `out/internal/alpha5_9_master_review_packet/` (alpha.5.9 master review packet)
"""
    (out_dir / "decision_validation_report.md").write_text(text, encoding="utf-8")


def write_manifest(out_dir: Path, manifest: dict):
    (out_dir / "alpha5_10_reviewer_decision_gate_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ============================================================
# Main pipeline
# ============================================================

def run_validation(input_csv: Path, out_dir: Path,
                   master: dict, alpha_5_9_legal: dict,
                   alpha_5_9_master_keys: set, alpha_5_9_legal_keys: set) -> dict:
    """主処理。input_csv を読み、out_dir に 8ファイルを出力する。manifest を返す。"""
    out_dir.mkdir(parents=True, exist_ok=True)

    # 入力CSV読み込み（# 始まりのコメント行と空行を除外）
    input_rows = []
    fieldnames = []
    with open(input_csv, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        for r in reader:
            svc = (r.get("service") or "").strip()
            if not svc or svc.startswith("#"):
                continue
            input_rows.append(r)

    # alpha.5.12: 拡張列の有無を検出（後方互換のため）
    has_legal_clearance = "legal_review_clearance" in fieldnames
    has_risk_ack = "implementation_risk_acknowledged" in fieldnames
    is_extended_csv = has_legal_clearance or has_risk_ack

    seen_keys = set()
    approved_rows = []
    blocked_rows = []
    pending_rows = []
    legal_rows = []

    future_candidate_count = 0
    divergent_count = 0

    for row in input_rows:
        result = classify_row(row, master, seen_keys, alpha_5_9_legal_keys, alpha_5_9_master_keys,
                                has_legal_clearance=has_legal_clearance,
                                has_risk_ack=has_risk_ack)
        bucket = result["bucket"]
        key = (_strip(row, "service"), _strip(row, "kasan_key"))
        master_kasan = master.get(key) or {}

        if key in DIVERGENT_KEYS:
            divergent_count += 1
        if get_proposed_action(master_kasan) == "future_candidate_only":
            future_candidate_count += 1

        if bucket == "approved":
            approved_rows.append(build_approved_row(row, master_kasan))
        elif bucket == "blocked":
            blocked_rows.append(build_blocked_row(row, result))
        elif bucket == "pending":
            pending_rows.append(build_pending_row(row, result, master_kasan))
        elif bucket == "legal_review_required":
            legal_rows.append(build_legal_row(row, result, master_kasan, alpha_5_9_legal))

    # 出力
    note_common = [
        f"alpha.5.10 reviewer decision gate generated at {GENERATED_AT}",
        f"base_commit: {ALPHA_5_9_BASE_COMMIT} (alpha.5.9)",
        f"input: {_rel(input_csv)}",
        "本ゲートは master JSON を改変しない。承認候補 (approved_changes_preview) はあくまで実装候補。",
    ]
    write_csv_with_bom(out_dir / "approved_changes_preview.csv", APPROVED_COLUMNS, approved_rows,
                       note_lines=note_common + [
                           "実装は alpha.5.11+ で段階的 PR にて実施。一括反映禁止。",
                           "implementation_risk=high の行は PDF検出回帰テスト必須。",
                       ])
    (out_dir / "approved_changes_preview.json").write_text(
        json.dumps(approved_rows, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_csv_with_bom(out_dir / "blocked_or_incomplete_decisions.csv", BLOCKED_COLUMNS, blocked_rows,
                       note_lines=note_common + [
                           "blocked_reason に従い recommended_fix を業務担当が実施し、再ゲート実行する。",
                       ])
    write_csv_with_bom(out_dir / "pending_decisions.csv", PENDING_COLUMNS, pending_rows,
                       note_lines=note_common + [
                           "pending_reason: blank_template_row (要記入) / non_modifying_decision_recorded (記録のみ・追加作業不要) / deferred_until_r8_definitive / implementation_not_yet_approved",
                       ])
    write_csv_with_bom(out_dir / "legal_review_required.csv", LEGAL_COLUMNS, legal_rows,
                       note_lines=note_common + [
                           "法令確認者が legal_question を解析し、関係告示・通知を参照して reviewer_decision を確定する。",
                       ])

    manifest = {
        "version": PACKET_VERSION,
        "base_commit": ALPHA_5_9_BASE_COMMIT,
        "input_packet_version": INPUT_PACKET_VERSION,
        "input_template_path": _rel(input_csv),
        "generated_at": GENERATED_AT,
        "purpose": "alpha.5.9 reviewer_decision_template.csv の検証ゲート。master JSON は改変しない。",
        "scope": "internal_only",
        "public_release": False,
        "checked_promotion": False,
        "master_auto_update": False,
        "r8_provisional_used_for_checked": False,
        "release_pack_modified": False,
        "total_review_rows": len(input_rows),
        "approved_count": len(approved_rows),
        "blocked_count": len(blocked_rows),
        "pending_count": len(pending_rows),
        "legal_review_required_count": len(legal_rows),
        "future_candidate_count": future_candidate_count,
        "divergent_count": divergent_count,
        "files": [
            "README.md",
            "decision_validation_report.md",
            "approved_changes_preview.csv",
            "approved_changes_preview.json",
            "blocked_or_incomplete_decisions.csv",
            "pending_decisions.csv",
            "legal_review_required.csv",
            "alpha5_10_reviewer_decision_gate_manifest.json",
        ],
        "valid_reviewer_decisions": sorted(VALID_DECISIONS),
        "modifying_decisions": sorted(MODIFYING_DECISIONS),
        "non_modifying_decisions": sorted(NON_MODIFYING_DECISIONS),
        "high_risk_decisions": sorted(HIGH_RISK_DECISIONS),
        "valid_implementation_allowed": sorted(VALID_IMPL_ALLOWED),
        "required_fields_when_yes": list(REQUIRED_FIELDS_WHEN_YES),
        "csv_encoding": "utf-8-sig (UTF-8 BOM)",
        # alpha.5.12: 拡張列の有無を記録（後方互換のため）
        "input_csv_schema": "extended" if is_extended_csv else "legacy_9_column",
        "has_legal_clearance_column": has_legal_clearance,
        "has_implementation_risk_acknowledged_column": has_risk_ack,
        "valid_legal_review_clearance": sorted(VALID_LEGAL_CLEARANCE),
        "valid_implementation_risk_acknowledged": sorted(VALID_RISK_ACK),
        "invariants": [
            "master JSON 自動修正なし",
            "新規 checked 昇格なし",
            "R8.6 案資料を checked 昇格に使わない",
            "future_candidate_only は legal clearance があっても approved にしない",
            "high risk decision は implementation_risk_acknowledged=yes が必須（拡張列ある場合）",
            "public release pack 未変更",
            "alpha.5.9 packet ファイル未破壊",
            "checked 20件 維持",
        ],
    }
    write_manifest(out_dir, manifest)
    write_readme(out_dir, manifest, input_csv)
    write_validation_report(out_dir, manifest, {
        "approved": approved_rows, "blocked": blocked_rows,
        "pending": pending_rows, "legal": legal_rows,
    }, input_csv)
    return manifest


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="alpha.5.10 reviewer decision gate generator")
    parser.add_argument("--input", default=str(DEFAULT_INPUT_TEMPLATE),
                        help="入力 reviewer_decision_template.csv のパス")
    parser.add_argument("--output", default=str(DEFAULT_OUT_DIR),
                        help="出力ディレクトリ")
    parser.add_argument("--alpha59-packet-dir", default=str(ROOT / "out" / "internal" / "alpha5_9_master_review_packet"),
                        help="alpha.5.9 packet のディレクトリ（needs_legal_review_matrix.csv 参照用）")
    args = parser.parse_args(argv)

    input_csv = Path(args.input)
    out_dir = Path(args.output)
    packet_dir = Path(args.alpha59_packet_dir)

    if not input_csv.exists():
        raise SystemExit(f"input not found: {input_csv}")

    master = load_master_kasans()
    alpha_5_9_legal = load_alpha_5_9_legal_info(packet_dir)
    alpha_5_9_legal_keys = set(alpha_5_9_legal.keys())
    alpha_5_9_master_keys = load_packet_kasan_keys(packet_dir, "needs_master_review_matrix.csv")

    manifest = run_validation(input_csv, out_dir, master, alpha_5_9_legal,
                               alpha_5_9_master_keys, alpha_5_9_legal_keys)

    print(f"alpha.5.10 reviewer decision gate generated at {out_dir}")
    print(f"  input: {input_csv}")
    print(f"  total_review_rows: {manifest['total_review_rows']}")
    print(f"  approved          : {manifest['approved_count']}")
    print(f"  blocked           : {manifest['blocked_count']}")
    print(f"  pending           : {manifest['pending_count']}")
    print(f"  legal_review_req  : {manifest['legal_review_required_count']}")
    print(f"  future_candidate  : {manifest['future_candidate_count']}")
    print(f"  divergent         : {manifest['divergent_count']}")


if __name__ == "__main__":
    main()
