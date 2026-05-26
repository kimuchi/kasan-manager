"""alpha.5.9 master review packet generator.

alpha.5.8.1 までに整理した三層コードモデルから、人間レビュー用パケットを生成する。

方針:
- master JSON が source-of-truth。本scriptはmaster JSONを**改変しない**
- idempotent: 同じ入力なら同じ packet を生成する（タイムスタンプは固定値）
- public release pack には出さない: 出力先は out/internal/alpha5_9_master_review_packet/
- 算定可否保証・公式コード完全照合済み・R8対応済み 表現は禁止
- 新規 checked 昇格・公式コードへの一括置換は本script では一切行わない
"""
from __future__ import annotations

import csv
import json
import sys
import io
from datetime import date
from pathlib import Path

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
SERVICES = ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien")
SERVICE_JP = {
    "houmon_kango_kaigo": "訪問看護(介護)",
    "tsusho_kaigo": "通所介護",
    "houmon_kaigo": "訪問介護",
    "kyotaku_shien": "居宅介護支援",
}

# packet metadata（idempotent のため固定）
PACKET_VERSION = "alpha.5.9"
PACKET_BASE_COMMIT = "2f5245e9b2cba759e1aec7d0c47e6041ae512e81"
PACKET_GENERATED_AT = "2026-05-10"
OUT_DIR = ROOT / "out" / "internal" / "alpha5_9_master_review_packet"


# ============================================================
# Loader
# ============================================================

def load_master(service: str) -> dict:
    path = ROOT / "regulatory_master" / "kaigo" / f"{service}.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def iter_kasans():
    """全サービスの全 kasan を (service, kasan_key, kasan_def) で yield"""
    for svc in SERVICES:
        d = load_master(svc)
        for k, v in d.get("kasans", {}).items():
            yield svc, k, v


def get_three_layer(kasan_def: dict) -> dict:
    return (kasan_def.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model") or {}


# ============================================================
# Question / Recommended-next-step generators (decision-aid)
# ============================================================

def build_review_question_for_master(svc: str, kasan_def: dict, three: dict) -> str:
    """needs_master_review 加算ごとに reviewer 向けの質問文を組み立てる。"""
    official = three.get("official_code_model") or {}
    legacy = three.get("internal_legacy_model") or {}
    off_code = official.get("official_service_code")
    int_code = legacy.get("internal_legacy_code")
    name = kasan_def.get("name", "")
    match = official.get("official_match_type") or "(unknown)"

    if off_code and int_code and match in ("code_mismatch", "code_and_unit_mismatch", "unit_mismatch"):
        return (
            f"加算「{name}」: 公式コード {off_code} に対し社内コード {int_code} が稼働中（match_type={match}）。"
            f" 社内マスタを公式コードに訂正するか、社内コードを公式コードのaliasとして登録するか、"
            f" それとも legacy_detection_only のまま運用継続か、業務担当・開発担当で確認してください。"
        )
    if int_code and not off_code:
        return (
            f"加算「{name}」: 社内コード {int_code} は稼働中だが、確定版PDFに対応する公式コードが見つかりません（match_type={match}）。"
            f" 公式コードが本当に未登録か、別表に移動した可能性、R8.6.1で新規公式コード追加見込みかを業務担当・開発担当で確認してください。"
        )
    if off_code and not int_code:
        return (
            f"加算「{name}」: 公式コード {off_code} は存在するが社内 service_codes が未登録（match_type={match}）。"
            f" 社内マスタへ公式コードを追加するか、現行の検出パターンのままにするか、業務担当・開発担当で確認してください。"
        )
    return (
        f"加算「{name}」: match_type={match}。公式コード={off_code or '(未取得)'} / 社内コード={int_code or '(未登録)'}。"
        f" 上記情報をもとに業務担当・法令確認者・開発担当で対応方針を判断してください。"
    )


def build_recommended_next_step_for_master(three: dict) -> str:
    """needs_master_review の next_step 候補（reviewer の最終判断は別途・本値はあくまで提案）"""
    official = three.get("official_code_model") or {}
    legacy = three.get("internal_legacy_model") or {}
    match = official.get("official_match_type")
    off_code = official.get("official_service_code")
    int_code = legacy.get("internal_legacy_code")
    if off_code and int_code and match in ("code_mismatch",):
        return "candidate: correct_internal_legacy_code OR add_receipt_alias (reviewer判断)"
    if int_code and not off_code:
        return "candidate: keep_legacy_detection_only OR defer_until_r8_definitive (reviewer判断)"
    if off_code and not int_code:
        return "candidate: add_official_code_model OR keep_pattern_based_unverified (reviewer判断)"
    return "candidate: keep_legacy_detection (reviewer判断)"


def build_mismatch_summary(three: dict) -> str:
    official = three.get("official_code_model") or {}
    legacy = three.get("internal_legacy_model") or {}
    off = official.get("official_service_code") or "(none)"
    intc = legacy.get("internal_legacy_code") or "(none)"
    off_unit = official.get("official_unit")
    int_unit = legacy.get("internal_legacy_unit")
    match = official.get("official_match_type") or "(unknown)"
    parts = [f"match_type={match}", f"official_code={off}", f"internal_code={intc}"]
    if off_unit is not None:
        parts.append(f"official_unit={off_unit}")
    if int_unit is not None:
        parts.append(f"internal_unit={int_unit}")
    return " / ".join(parts)


def build_current_risk(svc: str, three: dict) -> str:
    """現状のまま運用するリスク（控えめに記述）。"""
    legacy = three.get("internal_legacy_model") or {}
    rcpt = three.get("receipt_detection_model") or {}
    risks = []
    if legacy.get("internal_legacy_code"):
        risks.append("社内legacyコードでPDF検出は機能しているが、公式コードとの対応関係が未確定")
    if rcpt.get("receipt_detection_status") == "legacy_detection_only":
        risks.append("帳票検出は legacy_code 経路のみ")
    if not risks:
        return "公式コード照合が未完のため、外部レポートでは pattern_based_unverified / needs_review として表示中"
    return " / ".join(risks)


def build_legal_question(kasan_def: dict, three: dict) -> str:
    name = kasan_def.get("name", "")
    return (
        f"加算「{name}」: 確定版サービスコード表では独立した加算行が見当たらず、基本サービスコードに付加される構造の可能性。"
        f" 算定基準告示・大臣基準告示・解釈通知（老企第36号 等）でどのように扱われているか、"
        f" 法令確認者の確認が必要です。"
    )


def build_legal_reference_needed(svc: str) -> str:
    return (
        "介護報酬告示（厚労告）/ 大臣基準告示 / 老企第36号「指定居宅サービスに要する費用の額の算定に関する基準」"
        "の解釈通知 / 最新の事務連絡（その2・その3 等）"
    )


def build_structural_issue_type(three: dict) -> str:
    official = three.get("official_code_model") or {}
    if official.get("official_match_type") == "structural_mismatch":
        return "基本サービスコードへの付加加算（独立コードなし・PDF検出のみ）"
    return "structural_mismatch"


def build_why_not_checked(three: dict) -> str:
    return (
        "確定版サービスコード表に独立コードが見当たらず、構造解釈が必要なため checked 昇格しない。"
        " 法令解釈の確認後に再評価する。"
    )


# ============================================================
# CSV writers (UTF-8 BOM for Excel compatibility)
# ============================================================

NEEDS_MASTER_COLUMNS = [
    "service", "kasan_key", "kasan_display_name",
    "current_overall_mapping_status", "proposed_action",
    "official_service_code", "official_name", "official_unit", "official_calc_unit",
    "official_source_id", "official_page_or_section",
    "receipt_detection_code", "receipt_detection_name",
    "receipt_detection_pattern", "receipt_detection_status",
    "internal_legacy_code", "internal_legacy_name", "internal_legacy_unit",
    "mismatch_type", "mismatch_summary", "current_risk",
    "proposed_review_question", "recommended_next_step",
    "reviewer_decision", "reviewer_name", "reviewed_at", "review_note",
]

NEEDS_LEGAL_COLUMNS = [
    "service", "kasan_key", "kasan_display_name",
    "legal_review_reason", "structural_issue_type",
    "official_source_id", "official_page_or_section",
    "internal_legacy_code", "receipt_detection_pattern",
    "current_overall_mapping_status",
    "why_not_checked", "legal_question", "reference_needed",
    "recommended_next_step",
    "reviewer_decision", "reviewer_name", "reviewed_at", "review_note",
]

REVIEWER_DECISION_COLUMNS = [
    "service", "kasan_key", "reviewer_decision",
    "reason", "required_evidence",
    "reviewer_name", "reviewed_at", "final_approved_by",
    "implementation_allowed",
]

REVIEWER_DECISION_VALUES_NOTE = (
    "reviewer_decision の選択肢: approve_official_code_addition | keep_legacy_detection_only |"
    " add_receipt_alias | correct_internal_legacy_code | mark_structural_mismatch |"
    " keep_pattern_based_unverified | escalate_legal_review | defer_until_r8_definitive"
)
IMPLEMENTATION_ALLOWED_NOTE = "implementation_allowed の選択肢: yes | no | pending"


def get_source_page_or_section(three: dict) -> str:
    """alpha.5.6 audit が記録している page_or_section を引く。なければ空文字。
    （source_id ベースで registry を引いて取得することも可能だが、簡易に "(未記録)" を返す）"""
    official = three.get("official_code_model") or {}
    sid = official.get("source_id") or ""
    # 既知の source_id → page_or_section を簡易テーブル化（registryを再読込しない）
    table = {
        "WAM_R7_4_DEFINITIVE_2025_03_28": "訪問介護 p1-107 / 訪問看護 p109-129 / 通所介護 p130-144 / 居宅介護支援 p318-332",
        "WAM_R7_8_DEFINITIVE_2025_03_28": "訪問介護 p1-107 / 訪問看護 p109-129 / 通所介護 p130-144 / 居宅介護支援 p318-332 (R7.4と同一構造)",
        "WAM_R6_6_8_DEFINITIVE_2024_05_07": "訪問介護 p1-61 / 訪問看護 p65-74 / 通所介護 p75-87 / 居宅介護支援 p242+",
    }
    return table.get(sid, "(未記録)")


def write_csv_with_bom(path: Path, columns: list[str], rows: list[dict], note_lines: list[str] | None = None):
    """UTF-8 BOM付きCSVを書き出す。Excel互換。"""
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
        if note_lines:
            f.write("\n")
            for line in note_lines:
                f.write(f"# {line}\n")


# ============================================================
# Row builders
# ============================================================

def build_needs_master_row(svc: str, kasan_key: str, kasan_def: dict) -> dict:
    three = get_three_layer(kasan_def)
    official = three.get("official_code_model") or {}
    rcpt = three.get("receipt_detection_model") or {}
    legacy = three.get("internal_legacy_model") or {}
    return {
        "service": svc,
        "kasan_key": kasan_key,
        "kasan_display_name": kasan_def.get("name", ""),
        "current_overall_mapping_status": kasan_def.get("overall_mapping_status", ""),
        "proposed_action": three.get("proposed_action", ""),
        "official_service_code": official.get("official_service_code") or "",
        "official_name": official.get("official_name") or "",
        "official_unit": official.get("official_unit") if official.get("official_unit") is not None else "",
        "official_calc_unit": official.get("official_calc_unit") or "",
        "official_source_id": official.get("source_id") or "",
        "official_page_or_section": get_source_page_or_section(three),
        "receipt_detection_code": rcpt.get("receipt_detection_code") or "",
        "receipt_detection_name": rcpt.get("receipt_detection_name") or "",
        "receipt_detection_pattern": rcpt.get("receipt_detection_pattern") or "",
        "receipt_detection_status": rcpt.get("receipt_detection_status") or "",
        "internal_legacy_code": legacy.get("internal_legacy_code") or "",
        "internal_legacy_name": legacy.get("internal_legacy_name") or "",
        "internal_legacy_unit": legacy.get("internal_legacy_unit") if legacy.get("internal_legacy_unit") is not None else "",
        "mismatch_type": official.get("official_match_type") or "",
        "mismatch_summary": build_mismatch_summary(three),
        "current_risk": build_current_risk(svc, three),
        "proposed_review_question": build_review_question_for_master(svc, kasan_def, three),
        "recommended_next_step": build_recommended_next_step_for_master(three),
        "reviewer_decision": "",
        "reviewer_name": "",
        "reviewed_at": "",
        "review_note": "",
    }


def build_needs_legal_row(svc: str, kasan_key: str, kasan_def: dict) -> dict:
    three = get_three_layer(kasan_def)
    official = three.get("official_code_model") or {}
    rcpt = three.get("receipt_detection_model") or {}
    legacy = three.get("internal_legacy_model") or {}
    return {
        "service": svc,
        "kasan_key": kasan_key,
        "kasan_display_name": kasan_def.get("name", ""),
        "legal_review_reason": three.get("audit_note") or "確定版に独立コードが見当たらず構造解釈が必要",
        "structural_issue_type": build_structural_issue_type(three),
        "official_source_id": official.get("source_id") or "",
        "official_page_or_section": get_source_page_or_section(three),
        "internal_legacy_code": legacy.get("internal_legacy_code") or "",
        "receipt_detection_pattern": rcpt.get("receipt_detection_pattern") or "",
        "current_overall_mapping_status": kasan_def.get("overall_mapping_status", ""),
        "why_not_checked": build_why_not_checked(three),
        "legal_question": build_legal_question(kasan_def, three),
        "reference_needed": build_legal_reference_needed(svc),
        "recommended_next_step": "candidate: escalate_legal_review (reviewer判断)",
        "reviewer_decision": "",
        "reviewer_name": "",
        "reviewed_at": "",
        "review_note": "",
    }


def build_reviewer_decision_template_row(svc: str, kasan_key: str) -> dict:
    return {
        "service": svc,
        "kasan_key": kasan_key,
        "reviewer_decision": "",
        "reason": "",
        "required_evidence": "",
        "reviewer_name": "",
        "reviewed_at": "",
        "final_approved_by": "",
        "implementation_allowed": "",
    }


# ============================================================
# Categorize
# ============================================================

def categorize() -> dict:
    """全 kasan を proposed_action と divergent 状況で分類する。"""
    out = {
        "keep_checked": [],
        "needs_master_review": [],
        "needs_legal_review": [],
        "keep_pattern_based_unverified": [],
        "future_candidate_only": [],
        "not_applicable_confirmed": [],
        "divergent": [],   # keep_pattern_based_unverified ∧ overall=needs_review
    }
    for svc, k, v in iter_kasans():
        three = get_three_layer(v)
        pa = three.get("proposed_action")
        ov = v.get("overall_mapping_status")
        if pa in out:
            out[pa].append((svc, k, v))
        if pa == "keep_pattern_based_unverified" and ov == "needs_review":
            out["divergent"].append((svc, k, v))
    return out


# ============================================================
# README / summary / divergent / future_candidate writers
# ============================================================

def write_readme(out_dir: Path, cat: dict):
    text = f"""# alpha.5.9 Master Review Packet

**version**: {PACKET_VERSION}
**base_commit**: `{PACKET_BASE_COMMIT}` (alpha.5.8.1 source_metadata_hotfix)
**generated_at**: {PACKET_GENERATED_AT}

---

## 位置付け

alpha.5.8 / alpha.5.8.1 で整理した三層コードモデル（official / receipt_detection / internal_legacy）から、
alpha.5.9 で **人間がレビュー・判断するための資料** を生成したパケットです。

- このパケットは **内部レビュー用** であり、**public release ではありません**
- 出力先: `out/internal/alpha5_9_master_review_packet/`（public sample / release pack には含めない）

## 方針（不変）

- ❌ **新規 checked 昇格はしない**（reviewer が承認・実装ステップを別途実施するまで）
- ❌ **公式コードへの一括置換はしない**
- ❌ **master JSON の自動修正はしない**（本packet生成scriptは master JSON を**読み取り専用**で扱う）
- ❌ **PDF検出コードを壊さない**
- ❌ **R8.6 案資料は checked 昇格に使わない**
- ❌ **法令解釈を推測で埋めない**（reviewer に法令調査を委ねる）
- ❌ 過剰な完了感を与える表現を出さない（具体的には: 算定可否の保証表現、公式コードと社内コードの照合が全件終わったかのような表現、令和8年6月改定の対応が完了したかのような表現は使わない。disclaimer を維持する）

## レビュー対象内訳

| カテゴリ | 件数 | 概要 |
|---|---:|---|
| needs_master_review | {len(cat['needs_master_review'])} | 社内コードと公式コードの不一致・マスタ訂正レビュー対象 |
| needs_legal_review | {len(cat['needs_legal_review'])} | 基本コードへの追加加算構造・法令解釈確認対象 |
| divergent (keep_pattern_based_unverified ∧ overall=needs_review) | {len(cat['divergent'])} | proposed_action と overall_mapping_status の divergent 3件 |
| future_candidate_only | {len(cat['future_candidate_only'])} | R8.6 確定版が出るまで保留 |
| keep_checked (参考) | {len(cat['keep_checked'])} | 既に checked 化済（本packet では再レビュー不要）|

合計 reviewer タッチ対象: needs_master_review + needs_legal_review + divergent + future_candidate_only
= {len(cat['needs_master_review']) + len(cat['needs_legal_review']) + len(cat['divergent']) + len(cat['future_candidate_only'])} 件

## レビュー担当者の役割

| 担当 | 役割 |
|---|---|
| **業務担当** | 社内マスタの service_codes と公式コードの整合性確認・マスタ訂正可否判断・現場運用への影響評価 |
| **法令確認者** | needs_legal_review 加算（複数名・長時間訪問看護加算 等）の法令解釈確認・関係告示/通知の確認 |
| **開発担当** | reviewer 判断後の実装変更（master JSON 編集・テスト追加・PDF検出ロジック調整）|
| **最終判断者** | reviewer_decision の最終承認・implementation_allowed の許可（社長・CIO 等） |

## 含まれるファイル

| ファイル | 内容 |
|---|---|
| `README.md` | 本ファイル |
| `master_review_summary.md` | alpha.5.8.1 集計と次フェーズで判断すべきこと |
| `needs_master_review_matrix.csv` | needs_master_review 28件の詳細マトリクス（UTF-8 BOM付・Excel互換） |
| `needs_legal_review_matrix.csv` | needs_legal_review 5件の詳細マトリクス（同上） |
| `divergent_mapping_review.md` | proposed_action / overall_mapping_status divergent 3件の説明 |
| `future_candidate_review.md` | R8.6 案資料に関する future_candidate_only 2件の説明 |
| `reviewer_decision_template.csv` | reviewer の決定記録用テンプレート（同上） |
| `alpha5_9_master_review_packet_manifest.json` | パケット自身のメタデータ |

## 使い方

1. `master_review_summary.md` を最初に読む
2. `needs_master_review_matrix.csv` を Excel で開く（UTF-8 BOM付なので文字化けしない）
3. 業務担当が各行の `proposed_review_question` に答え、`reviewer_decision` 列を埋める
4. 法令確認者が `needs_legal_review_matrix.csv` の `legal_question` を確認
5. 最終判断者が `reviewer_decision_template.csv` で承認
6. 開発担当が承認内容を別途 alpha.5.10+ で master JSON に反映
   （**本packet生成scriptは master JSON を改変しない**）

## 再生成方法

```
cd products/kasan-manager
python scripts/generate_alpha5_9_master_review_packet.py
```

idempotent なので、master JSON が変わらない限り同じ packet が出力される。
"""
    (out_dir / "README.md").write_text(text, encoding="utf-8")


def write_summary(out_dir: Path, cat: dict):
    needs_master_by_service = {svc: 0 for svc in SERVICES}
    for svc, k, v in cat["needs_master_review"]:
        needs_master_by_service[svc] += 1
    needs_legal_by_service = {svc: 0 for svc in SERVICES}
    for svc, k, v in cat["needs_legal_review"]:
        needs_legal_by_service[svc] += 1

    text = f"""# alpha.5.9 Master Review Summary

**version**: {PACKET_VERSION}
**base_commit**: `{PACKET_BASE_COMMIT}`
**generated_at**: {PACKET_GENERATED_AT}

---

## 1. alpha.5.8.1 時点の集計

### overall_mapping_status (66件)

| status | 件数 |
|---|---:|
| checked | 20 |
| needs_review | 36 |
| pattern_based_unverified | 9 |
| not_applicable | 1 |
| **合計** | **66** |

### proposed_action (66件)

| proposed_action | 件数 |
|---|---:|
| keep_checked | 20 |
| needs_master_review | 28 |
| needs_legal_review | 5 |
| keep_pattern_based_unverified | 10 |
| future_candidate_only | 2 |
| not_applicable_confirmed | 1 |
| **合計** | **66** |

## 2. サービス別レビュー対象件数

### needs_master_review (合計 {len(cat['needs_master_review'])} 件)

| サービス | 件数 |
|---|---:|
| 訪問看護(介護) | {needs_master_by_service['houmon_kango_kaigo']} |
| 通所介護 | {needs_master_by_service['tsusho_kaigo']} |
| 訪問介護 | {needs_master_by_service['houmon_kaigo']} |
| 居宅介護支援 | {needs_master_by_service['kyotaku_shien']} |

### needs_legal_review (合計 {len(cat['needs_legal_review'])} 件)

| サービス | 件数 |
|---|---:|
| 訪問看護(介護) | {needs_legal_by_service['houmon_kango_kaigo']} |
| 通所介護 | {needs_legal_by_service['tsusho_kaigo']} |
| 訪問介護 | {needs_legal_by_service['houmon_kaigo']} |
| 居宅介護支援 | {needs_legal_by_service['kyotaku_shien']} |

### divergent (proposed=keep_pattern_based_unverified ∧ overall=needs_review): {len(cat['divergent'])} 件
### future_candidate_only: {len(cat['future_candidate_only'])} 件

## 3. 次フェーズで判断すべきこと

1. **needs_master_review 28件**: 社内マスタの `service_codes` を公式コードに訂正するか、社内コードを公式コードの alias として登録するか
2. **needs_legal_review 5件**: 複数名訪問看護加算・長時間訪問看護加算の構造解釈（独立コード or 基本コードへの付加加算）
3. **divergent 3件**: proposed_action と overall_mapping_status が分岐している理由をレビュー（業務データ自体は不整合ではない）
4. **future_candidate_only 2件**: R8.6.1 確定版が出てから再評価

## 4. 判断後に想定される対応カテゴリ

reviewer が `reviewer_decision` 列で選択する候補値（**本scriptは候補のみ提示。最終判断は reviewer**）:

| 値 | 意味 | 想定実装 |
|---|---|---|
| `keep_legacy_detection` | 社内 legacy code の運用を継続 | master JSON 変更なし |
| `add_official_code_model` | 公式コードを `official_code_model.official_service_code` に追加 | master JSON 編集 |
| `add_receipt_alias` | 公式コードを社内コードの alias として登録 | receipt_detection_model に alias 追加 |
| `correct_internal_legacy_code` | 社内 service_codes を公式コードに置換 | **PDF検出への影響を必ず確認**してから実施 |
| `mark_structural_mismatch` | structural_mismatch として明示し以降は legal review 待ち | master JSON 編集 |
| `keep_pattern_based_unverified` | 現状維持（公式コード not_found 等）| 変更なし |
| `escalate_legal_review` | 法令解釈通知の確認に escalation | 法令確認者にハンドオフ |
| `defer_until_r8_definitive` | R8.6.1 確定版が出るまで保留 | 変更なし |

## 5. 不変条件（alpha.5.9 本packet 生成段階）

- ✅ checked 20件は維持（packet では再レビュー不要・参考扱い）
- ✅ master JSON は読み取り専用（packet 生成 script は master JSON を改変しない）
- ✅ R8.6 案資料は checked 昇格に使わない
- ✅ public release pack は本 alpha.5.9 で更新しない

## 6. 関連 audit report

- `out/internal/alpha5_8_three_layer_code_model_report.md` — alpha.5.8 三層モデル本体
- `out/internal/alpha5_8_1_audit_metadata_hotfix_report.md` — alpha.5.8.1 audit metadata
- `out/internal/alpha5_8_1_source_metadata_hotfix_report.md` — alpha.5.8.1 source metadata + crosswalk
"""
    (out_dir / "master_review_summary.md").write_text(text, encoding="utf-8")


def write_divergent_md(out_dir: Path, cat: dict):
    items_md = []
    for svc, k, v in cat["divergent"]:
        three = get_three_layer(v)
        note = three.get("alpha_5_8_1_proposed_overall_divergence_note") or {}
        items_md.append(f"""### {SERVICE_JP[svc]} `{k}`

- 表示名: {v.get('name', '')}
- proposed_action: `{three.get('proposed_action')}`
- overall_mapping_status: `{v.get('overall_mapping_status')}`
- divergence_reason: {note.get('reason', '(記録なし)')}
- overall_status_basis: {note.get('overall_status_basis', '(記録なし)')}
- proposed_action_basis: {note.get('proposed_action_basis', '(記録なし)')}

**人間が確認すべきこと**:
1. この divergence は machine-counted で正しい状態か（**alpha.5.8.1 で audit_note 化済 → YES**）
2. 社内マスタにコードを追加すべきか（`internal_codes` を埋めるかどうか）
3. 公式コード（official_service_code）が **本当に存在しないか**、別表に移動した可能性はないか
4. R8.6.1 確定版で対応公式コードが追加された場合、`needs_master_review` 経由で `checked` 昇格できるか

**この段階ではマスタ修正しない**: divergence 自体は正しく記録されており、本packet では reviewer 判断のための情報提示のみ行う。
""")

    text = f"""# alpha.5.9 Divergent Mapping Review

**version**: {PACKET_VERSION}
**base_commit**: `{PACKET_BASE_COMMIT}`
**generated_at**: {PACKET_GENERATED_AT}

---

## 1. divergent とは

`keep_pattern_based_unverified` proposed_action だが `overall_mapping_status=needs_review` になっている **3件** の加算。

`proposed_action` と `overall_mapping_status` は **異なる目的** で生成されているため、`internal_codes` が空かつ `official_code_status=needs_review` の場合に divergent が発生する:

- **overall_mapping_status**: 外部表示用ラベル。`official_code_status` の機械的反映
- **proposed_action**: 社内が「何をすべきか」の運用ラベル。`internal_codes` 非空時のみ `needs_master_review` に流れ、空なら `keep_pattern_based_unverified` に流れる

詳細は [`alpha5_8_1_source_metadata_hotfix_report.md`](../alpha5_8_1_source_metadata_hotfix_report.md) §5-6 参照。

## 2. divergent 3件の内訳

{''.join(items_md)}

## 3. レビュアーへのお願い

- **マスタ修正は本packet 段階では行わない**。reviewer 決定を `reviewer_decision_template.csv` に記録するに留める
- divergence の事実を「業務データの不整合」と誤読しないこと（alpha.5.8.1 で正しく documentation 済）
- R8.6.1 確定版が出た場合、訪看 `shougu_kaizen_kasan_2026_06` は再評価対象（`future_candidate_review.md` も参照）
"""
    (out_dir / "divergent_mapping_review.md").write_text(text, encoding="utf-8")


def write_future_candidate_md(out_dir: Path, cat: dict):
    items_md = []
    for svc, k, v in cat["future_candidate_only"]:
        three = get_three_layer(v)
        items_md.append(f"""### {SERVICE_JP[svc]} `{k}`

- 表示名: {v.get('name', '')}
- proposed_action: `{three.get('proposed_action')}`
- overall_mapping_status: `{v.get('overall_mapping_status')}`
- audit_note: {three.get('audit_note', '')}
- 対象施行: 2026-06-01〜（R8.6.1 / R8.8.1 案）
""")

    text = f"""# alpha.5.9 Future Candidate Review

**version**: {PACKET_VERSION}
**base_commit**: `{PACKET_BASE_COMMIT}`
**generated_at**: {PACKET_GENERATED_AT}

---

## 1. R8.6 案資料の扱い

- `WAM_R8_6_8_PROVISIONAL_2026_04_30` は **「その3」（令和8年4月30日事務連絡）** の案資料です（`provisional_future`）
- PDF実体は WAM_R8_6_8_PROVISIONAL_2026_04_20 と同一（20260416_004.pdf）
- PDF表紙に「（案）」表記あり（alpha.5.8.1 で `pdfplumber` 実体確認済）
- **R8.6 案資料は checked 昇格に絶対使わない** (`checked_promotion_allowed: false`)
- 二重防御:
  1. registry の `source_kind=provisional` で `resolve_current_source_for_date` から除外
  2. `checked_promotion_allowed=false` で重ねて除外（alpha.5.8.1 追加）

## 2. future_candidate_only 2件

{''.join(items_md)}

## 3. R8.6 確定版が出た場合の確認手順案

確定版（おそらく令和8年5月下旬〜6月初頭）が出たら、以下の流れで処理する想定:

1. WAM NET の最新「確定版（令和8年X月X日事務連絡）」ページを開き、新規 source_id を採番
2. PDF実体を `pdfplumber` で取得し、表紙に「（案）」が **無い** ことを確認
3. `regulatory_master/sources/kaigo_service_code_sources.json` に新 source を追加
   - source_kind: `definitive` / revision_status: `current_definitive`
   - effective_from: 2026-06-01 / effective_to: null
4. `WAM_R8_6_8_PROVISIONAL_2026_04_30` と `_2026_04_20` を `historical_definitive` または削除候補に降格
5. `target_period_resolution_rules` の 2026-06-01〜 を新 source_id に変更
6. future_candidate_only 2件を再 audit して `needs_master_review` または `checked` 候補に再分類
7. 訪看 divergent の `shougu_kaizen_kasan_2026_06` も再評価
8. 4 master JSON を再生成 + 全テスト + 4サービスPDF回帰

## 4. 2026-06-01以降の運用リスク

R8.6.1 確定版が出るまでの期間:

- `resolve_current_source_for_date(svc, "2026-06-01")` は **None を返す**
- `target_period_resolution_rules` でも `current_source_id: null` 明示
- 報告レポート上では当該期間の加算は `pattern_based_unverified` または `needs_review` のまま表示
- 「令和8年6月改定への対応が完了した」と読める過剰表現は禁止（disclaimer 維持）

## 5. レビュアーへのお願い

- **R8.6 案を checked 昇格に使う判断は絶対に承認しない**
- 確定版が出るまで future_candidate_only 2件の `reviewer_decision` は `defer_until_r8_definitive` のままで良い
- WAM NET の新規ページ（gno=22524 以降）を定期的に確認
"""
    (out_dir / "future_candidate_review.md").write_text(text, encoding="utf-8")


def write_manifest(out_dir: Path, cat: dict):
    manifest = {
        "version": PACKET_VERSION,
        "base_commit": PACKET_BASE_COMMIT,
        "generated_at": PACKET_GENERATED_AT,
        "generator_script": "scripts/generate_alpha5_9_master_review_packet.py",
        "purpose": "alpha.5.8/alpha.5.8.1 で整理した三層コードモデルから、人間レビュー用パケットを生成",
        "scope": "internal_only",
        "public_release": False,
        "checked_promotion": False,
        "master_auto_update": False,
        "r8_provisional_used_for_checked": False,
        "release_pack_modified": False,
        "total_kasan_count": 66,
        "checked_count": len(cat["keep_checked"]),
        "needs_master_review_count": len(cat["needs_master_review"]),
        "needs_legal_review_count": len(cat["needs_legal_review"]),
        "future_candidate_only_count": len(cat["future_candidate_only"]),
        "divergent_count": len(cat["divergent"]),
        "files": [
            "README.md",
            "master_review_summary.md",
            "needs_master_review_matrix.csv",
            "needs_legal_review_matrix.csv",
            "divergent_mapping_review.md",
            "future_candidate_review.md",
            "reviewer_decision_template.csv",
            "alpha5_9_master_review_packet_manifest.json",
        ],
        "reviewer_decision_values": [
            "approve_official_code_addition",
            "keep_legacy_detection_only",
            "add_receipt_alias",
            "correct_internal_legacy_code",
            "mark_structural_mismatch",
            "keep_pattern_based_unverified",
            "escalate_legal_review",
            "defer_until_r8_definitive",
        ],
        "implementation_allowed_values": ["yes", "no", "pending"],
        "csv_encoding": "utf-8-sig (UTF-8 BOM)",
        "checked_breakdown": {
            "houmon_kango_kaigo": 14,
            "tsusho_kaigo": 6,
            "houmon_kaigo": 0,
            "kyotaku_shien": 0,
        },
        "invariants": [
            "checked 20件 (訪看14 + 通所6) を維持",
            "新規checked昇格なし",
            "公式コードへの一括置換なし",
            "master JSON 自動修正なし",
            "R8.6案を checked 昇格に使わない",
            "alpha.5.3 / alpha.5.4 release pack 未変更",
        ],
    }
    (out_dir / "alpha5_9_master_review_packet_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ============================================================
# Main
# ============================================================

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cat = categorize()

    # 1. README
    write_readme(OUT_DIR, cat)

    # 2. master_review_summary
    write_summary(OUT_DIR, cat)

    # 3. needs_master_review_matrix.csv
    rows = [build_needs_master_row(svc, k, v) for svc, k, v in cat["needs_master_review"]]
    write_csv_with_bom(
        OUT_DIR / "needs_master_review_matrix.csv",
        NEEDS_MASTER_COLUMNS,
        rows,
        note_lines=[
            f"alpha.5.9 master review packet generated at {PACKET_GENERATED_AT}",
            f"base_commit: {PACKET_BASE_COMMIT}",
            "reviewer_decision values: approve_official_code_addition | keep_legacy_detection_only | add_receipt_alias | correct_internal_legacy_code | mark_structural_mismatch | keep_pattern_based_unverified | escalate_legal_review | defer_until_r8_definitive",
            "本packet では master JSON を改変しない。reviewer 判断後の実装変更は alpha.5.10+ で別途実施。",
        ],
    )

    # 4. needs_legal_review_matrix.csv
    rows_legal = [build_needs_legal_row(svc, k, v) for svc, k, v in cat["needs_legal_review"]]
    write_csv_with_bom(
        OUT_DIR / "needs_legal_review_matrix.csv",
        NEEDS_LEGAL_COLUMNS,
        rows_legal,
        note_lines=[
            f"alpha.5.9 master review packet generated at {PACKET_GENERATED_AT}",
            f"base_commit: {PACKET_BASE_COMMIT}",
            "reviewer_decision values: escalate_legal_review | mark_structural_mismatch | keep_pattern_based_unverified | defer_until_r8_definitive",
            "法令解釈は本packet では推測で埋めない。法令確認者の確認結果のみを reviewer_decision に記録する。",
        ],
    )

    # 5. divergent_mapping_review.md
    write_divergent_md(OUT_DIR, cat)

    # 6. future_candidate_review.md
    write_future_candidate_md(OUT_DIR, cat)

    # 7. reviewer_decision_template.csv
    template_rows = []
    # needs_master_review + needs_legal_review + divergent + future_candidate_only すべて template に入れる
    for bucket in ("needs_master_review", "needs_legal_review", "divergent", "future_candidate_only"):
        for svc, k, _v in cat[bucket]:
            # divergent は keep_pattern_based_unverified に重複するので key 重複防止
            row = build_reviewer_decision_template_row(svc, k)
            if row not in template_rows:
                template_rows.append(row)
    write_csv_with_bom(
        OUT_DIR / "reviewer_decision_template.csv",
        REVIEWER_DECISION_COLUMNS,
        template_rows,
        note_lines=[
            f"alpha.5.9 master review packet generated at {PACKET_GENERATED_AT}",
            f"base_commit: {PACKET_BASE_COMMIT}",
            REVIEWER_DECISION_VALUES_NOTE,
            IMPLEMENTATION_ALLOWED_NOTE,
            "本テンプレートは未記入。reviewer が手で記入してから業務担当・最終判断者に回付する。",
        ],
    )

    # 8. manifest
    write_manifest(OUT_DIR, cat)

    print(f"alpha.5.9 master review packet generated at {OUT_DIR}")
    print(f"  needs_master_review: {len(cat['needs_master_review'])}")
    print(f"  needs_legal_review : {len(cat['needs_legal_review'])}")
    print(f"  divergent          : {len(cat['divergent'])}")
    print(f"  future_candidate   : {len(cat['future_candidate_only'])}")
    print(f"  template rows      : {len(template_rows)}")


if __name__ == "__main__":
    main()
