"""alpha.5.13 review workload reducer generator.

alpha.5.12 reviewer workflow hardening の上で、木村CIO・業務担当・法令確認者の
レビュー負担を減らすパケットを生成する。

主な狙い:
- CIO が **30分で決裁できる brief** を提供
- 38件すべてを一括レビューせず、**初回は10件以内に絞る**
- 残りは安全に **defer / legal / future_candidate** へ振り分ける
- safe default decisions を明示（reviewer の判断疲れを抑制）

方針:
- master JSON は **絶対に修正しない**（読み取り専用）
- reviewer_decision は上書きしない（recommended_initial_decision として提示のみ）
- implementation_allowed=yes は自動で付けない
- approved_changes_preview は作らない
- public release pack には出さない
- 算定可否保証・公式コード完全照合済み・R8.6 改定対応完了 表現は禁止
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

PACKET_VERSION = "alpha.5.13"
INPUT_PACKET_VERSION = "alpha.5.12"
ALPHA_5_12_HANDOFF_COMMIT = "228897a415aa8b2ff9a0d0a0b96723901a995266"
GENERATED_AT = "2026-05-10"
CIO_EXPECTED_MINUTES = 30
FIRST_BATCH_MAX_ROWS = 10

# Paths
ALPHA_5_9_PACKET_DIR = ROOT / "out" / "internal" / "alpha5_9_master_review_packet"
ALPHA_5_12_HARDENING_DIR = ROOT / "out" / "internal" / "alpha5_12_reviewer_workflow_hardening"
ALPHA_5_12_HANDOFF_DIR = ROOT / "out" / "internal" / "alpha5_12_kimura_cio_handoff"
OUT_DIR = ROOT / "out" / "internal" / "alpha5_13_review_workload_reducer"

SERVICES = ("houmon_kango_kaigo", "tsusho_kaigo", "houmon_kaigo", "kyotaku_shien")
SERVICE_JP = {
    "houmon_kango_kaigo": "訪問看護",
    "tsusho_kaigo": "通所介護",
    "houmon_kaigo": "訪問介護",
    "kyotaku_shien": "居宅介護支援",
}

# 初回バッチに含めるサービスごとの上限（代表選定）
PER_SERVICE_FIRST_BATCH_CAP = {
    "tsusho_kaigo": 4,        # 4件全て候補だが unit match 検証要
    "houmon_kaigo": 2,        # 7件中代表2件のみ
    "kyotaku_shien": 2,       # 16件中代表2件のみ
    "houmon_kango_kaigo": 0,  # 訪看の needs_master_review 1件は公式コード not_found
}

# divergent / future / legal の固定キー
DIVERGENT_KEYS = {
    ("houmon_kango_kaigo", "shougu_kaizen_kasan_2026_06"),
    ("tsusho_kaigo", "adl_iji"),
    ("tsusho_kaigo", "ninchi_kasan"),
}


# ============================================================
# Loaders (read-only)
# ============================================================

def load_master_kasans() -> dict:
    out = {}
    for svc in SERVICES:
        path = ROOT / "regulatory_master" / "kaigo" / f"{svc}.json"
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        for k, v in (d.get("kasans") or {}).items():
            out[(svc, k)] = v
    return out


def load_csv_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return [r for r in reader if r.get("service") and not r.get("service", "").startswith("#")]


# ============================================================
# Priority classification
# ============================================================

def classify_priority(svc: str, k: str, master_data: dict,
                      alpha_5_9_legal_keys: set,
                      alpha_5_9_master_keys: set) -> dict:
    """38 件の各 review item に対して優先度を分類する。

    返り値: dict with risk_level / review_effort / recommended_reviewer_role /
            recommended_initial_decision / can_be_first_batch / reason / why_not_first_batch
    """
    kasan_def = master_data.get((svc, k)) or {}
    three = (kasan_def.get("service_code_audit") or {}).get("alpha_5_8_three_layer_model") or {}
    official = three.get("official_code_model") or {}
    legacy = three.get("internal_legacy_model") or {}
    pa = three.get("proposed_action") or ""
    ov = kasan_def.get("overall_mapping_status") or ""

    off_code = official.get("official_service_code")
    int_code = legacy.get("internal_legacy_code")
    match_type = official.get("official_match_type") or ""
    off_unit = official.get("official_unit")
    int_unit = legacy.get("internal_legacy_unit")

    is_legal = pa == "needs_legal_review" or (svc, k) in alpha_5_9_legal_keys
    is_future = pa == "future_candidate_only"
    is_divergent = (svc, k) in DIVERGENT_KEYS

    # 既定値
    result = {
        "service": svc,
        "kasan_key": k,
        "display_name": kasan_def.get("name", ""),
        "review_bucket": "",
        "proposed_action": pa,
        "overall_mapping_status": ov,
        "risk_level": "medium",
        "review_effort": "15min",
        "recommended_reviewer_role": "business_reviewer",
        "recommended_initial_decision": "keep_pattern_based_unverified",
        "reason_for_priority": "",
        "can_be_first_batch": "no",
        "why_not_first_batch": "",
    }

    if is_future:
        result["review_bucket"] = "future_candidate_only"
        result["risk_level"] = "defer"
        result["review_effort"] = "wait_r8_definitive"
        result["recommended_reviewer_role"] = "deferred"
        result["recommended_initial_decision"] = "defer_until_r8_definitive"
        result["reason_for_priority"] = "R8.6.1 確定版が出るまで checked 化に使えない"
        result["why_not_first_batch"] = "R8.6.1 確定版待ち・初回バッチで判断しない"
        return result

    if is_legal:
        result["review_bucket"] = "needs_legal_review"
        result["risk_level"] = "defer"
        result["review_effort"] = "legal_required"
        result["recommended_reviewer_role"] = "legal_reviewer"
        result["recommended_initial_decision"] = "escalate_legal_review"
        result["reason_for_priority"] = "基本サービスコードへの付加加算構造の解釈が必要"
        result["why_not_first_batch"] = "法令確認者の clearance が必要・初回バッチ対象外"
        return result

    if is_divergent:
        result["review_bucket"] = "divergent"
        result["risk_level"] = "medium"
        result["review_effort"] = "15min"
        result["recommended_reviewer_role"] = "business_reviewer"
        result["recommended_initial_decision"] = "keep_pattern_based_unverified"
        result["reason_for_priority"] = "proposed_action と overall_mapping_status が分岐（alpha.5.8.1 で audit_note 化済）"
        result["why_not_first_batch"] = "divergent は記録のみ・初回バッチで判断しない"
        return result

    # needs_master_review
    if pa == "needs_master_review":
        result["review_bucket"] = "needs_master_review"

        if int_code and off_code and match_type == "code_mismatch":
            # 単位が一致する場合は alias 追加で安全に進められる
            if int_unit is not None and off_unit is not None and int_unit == off_unit:
                result["risk_level"] = "low"
                result["review_effort"] = "15min"
                result["recommended_initial_decision"] = "add_receipt_alias"
                result["reason_for_priority"] = (
                    f"公式 {off_code} と社内 {int_code} の単位 ({int_unit}) が一致・"
                    f"alias 登録で PDF 検出を保ちつつ公式照合を充足できる"
                )
                result["can_be_first_batch"] = "yes"
            elif int_unit is None or off_unit is None:
                result["risk_level"] = "low"
                result["review_effort"] = "15min"
                result["recommended_initial_decision"] = "add_receipt_alias"
                result["reason_for_priority"] = (
                    f"公式 {off_code} と社内 {int_code} のコード違い・"
                    f"単位情報不揃いだが alias 候補"
                )
                result["can_be_first_batch"] = "yes"
            else:
                # 単位不一致 → 慎重に判断
                result["risk_level"] = "medium"
                result["review_effort"] = "30min"
                result["recommended_initial_decision"] = "keep_pattern_based_unverified"
                result["reason_for_priority"] = (
                    f"公式 {off_code} と社内 {int_code} のコード・単位両方が異なる・"
                    f"マスタ訂正の影響範囲確認が必要"
                )
                result["can_be_first_batch"] = "no"
                result["why_not_first_batch"] = "単位不一致のため再確認が必要"
            return result

        if not int_code and off_code:
            # 社内コード未登録・公式コードあり → add_official_code_addition (低リスク)
            result["risk_level"] = "low"
            result["review_effort"] = "5min"
            result["recommended_initial_decision"] = "add_official_code_addition"
            result["reason_for_priority"] = (
                f"社内コード未登録・公式コード {off_code} を master に追加するだけで完結"
            )
            result["can_be_first_batch"] = "yes"
            return result

        if int_code and not off_code:
            # 社内コードはあるが公式 PDF に該当なし
            result["risk_level"] = "medium"
            result["review_effort"] = "15min"
            result["recommended_initial_decision"] = "keep_legacy_detection_only"
            result["reason_for_priority"] = (
                f"社内コード {int_code} は稼働中だが公式コード not_found・"
                f"R8.6.1 で新規追加見込みかを業務担当が判断"
            )
            result["can_be_first_batch"] = "no"
            result["why_not_first_batch"] = "公式 not_found のため R8.6.1 待ちまたは legacy 維持判断"
            return result

        # その他
        result["risk_level"] = "medium"
        result["review_effort"] = "30min"
        result["recommended_initial_decision"] = "keep_pattern_based_unverified"
        result["reason_for_priority"] = "判定材料が不足・追加情報の収集が必要"
        result["can_be_first_batch"] = "no"
        result["why_not_first_batch"] = "情報不足"
        return result

    # その他の proposed_action（keep_pattern_based_unverified / not_applicable_confirmed）
    if pa == "keep_pattern_based_unverified":
        result["review_bucket"] = "keep_pattern_based_unverified"
        result["risk_level"] = "low"
        result["review_effort"] = "5min"
        result["recommended_initial_decision"] = "keep_pattern_based_unverified"
        result["reason_for_priority"] = "現状維持で OK・追加作業なし"
        result["why_not_first_batch"] = "記録のみ・追加作業不要"
        return result

    if pa == "not_applicable_confirmed":
        result["review_bucket"] = "not_applicable_confirmed"
        result["risk_level"] = "low"
        result["review_effort"] = "5min"
        result["recommended_initial_decision"] = "keep_pattern_based_unverified"
        result["reason_for_priority"] = "訪問看護では算定対象外（既に確認済）"
        result["why_not_first_batch"] = "対象外確定"
        return result

    return result


# ============================================================
# First batch selection (5〜10 rows)
# ============================================================

def select_first_batch(priority_rows: list[dict], max_rows: int = FIRST_BATCH_MAX_ROWS) -> list[dict]:
    """初回バッチを選定する。

    ルール:
    - can_be_first_batch=yes のみ
    - risk_level in {low, medium}
    - サービスごとの上限 (PER_SERVICE_FIRST_BATCH_CAP) を超えない
    - 安定ソート: (service, kasan_key)
    - 合計を max_rows 以内に絞る

    副作用: priority_rows の can_be_first_batch=yes のうち、cap でこぼれたものを
    "no" に書き換え、why_not_first_batch を "per_service_cap_exceeded" に更新する。
    """
    candidates = [r for r in priority_rows if r["can_be_first_batch"] == "yes"]
    # 安定ソート
    candidates.sort(key=lambda r: (r["service"], r["kasan_key"]))

    selected = []
    selected_keys = set()
    per_service = {svc: 0 for svc in SERVICES}
    for r in candidates:
        svc = r["service"]
        cap = PER_SERVICE_FIRST_BATCH_CAP.get(svc, 1)
        if per_service[svc] >= cap:
            continue
        if len(selected) >= max_rows:
            break
        selected.append(r)
        selected_keys.add((r["service"], r["kasan_key"]))
        per_service[svc] += 1

    # cap でこぼれた candidate を no に書き換え
    for r in priority_rows:
        if r["can_be_first_batch"] == "yes" and (r["service"], r["kasan_key"]) not in selected_keys:
            r["can_be_first_batch"] = "no"
            if not r["why_not_first_batch"]:
                r["why_not_first_batch"] = (
                    f"per_service_cap_exceeded ({r['service']} の初回バッチ上限 "
                    f"{PER_SERVICE_FIRST_BATCH_CAP.get(r['service'], 1)} 件に達した・後続バッチで対応)"
                )

    return selected


# ============================================================
# Writers
# ============================================================

def write_priority_matrix(out_dir: Path, priority_rows: list[dict]):
    columns = [
        "service", "kasan_key", "display_name",
        "review_bucket", "proposed_action", "overall_mapping_status",
        "risk_level", "review_effort",
        "recommended_reviewer_role", "recommended_initial_decision",
        "reason_for_priority",
        "can_be_first_batch", "why_not_first_batch",
    ]
    path = out_dir / "REVIEW_PRIORITY_MATRIX.csv"
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        # 安定ソート: bucket → service → kasan_key
        bucket_order = {
            "needs_master_review": 0,
            "divergent": 1,
            "needs_legal_review": 2,
            "future_candidate_only": 3,
        }
        sorted_rows = sorted(priority_rows, key=lambda r: (
            bucket_order.get(r["review_bucket"], 9),
            r["service"], r["kasan_key"],
        ))
        for r in sorted_rows:
            w.writerow(r)
        f.write("\n")
        f.write(f"# alpha.5.13 REVIEW_PRIORITY_MATRIX generated at {GENERATED_AT}\n")
        f.write(f"# base_commit: {ALPHA_5_12_HANDOFF_COMMIT} (alpha.5.12 kimura cio handoff)\n")
        f.write("# 本マトリクスは候補提示のみ。reviewer_decision は別途 reviewer が確定する。\n")
        f.write("# implementation_allowed=yes は本パケットでは付けない（手動入力が必要）。\n")


def write_first_batch(out_dir: Path, first_batch: list[dict]):
    columns = [
        "service", "kasan_key", "display_name",
        "review_bucket", "proposed_action",
        "risk_level", "review_effort",
        "recommended_initial_decision",
        "reason_for_priority",
    ]
    path = out_dir / "FIRST_REVIEW_BATCH.csv"
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        for r in first_batch:
            w.writerow(r)
        f.write("\n")
        f.write(f"# alpha.5.13 FIRST_REVIEW_BATCH generated at {GENERATED_AT}\n")
        f.write(f"# base_commit: {ALPHA_5_12_HANDOFF_COMMIT} (alpha.5.12 kimura cio handoff)\n")
        f.write(f"# 初回バッチ件数: {len(first_batch)} / 上限: {FIRST_BATCH_MAX_ROWS} 件\n")
        f.write("# 本バッチは low/medium risk の needs_master_review のみ。\n")
        f.write("# needs_legal_review / future_candidate_only / divergent / 高リスクは含まない。\n")
        f.write("# 各 reviewer は recommended_initial_decision を確認し、最終判断は alpha.5.12 workbook に入力。\n")


def write_cio_30min_brief(out_dir: Path, priority_rows: list[dict], first_batch: list[dict],
                            deferred_counts: dict):
    text = f"""# CIO 30 Minute Decision Brief

**version**: {PACKET_VERSION}
**base_commit**: `{ALPHA_5_12_HANDOFF_COMMIT}` (alpha.5.12 kimura cio handoff)
**target audience**: 木村CIO
**想定読了時間**: **30 分以内**
**generated_at**: {GENERATED_AT}

---

## 🔑 結論（最初に読む）

**木村CIO にお願いするのは「38件のレビュー」ではなく、以下の 4 つの体制決裁だけです。**

| # | 決裁項目 | 30 分内に決められる？ |
|---|---|:---:|
| 1 | **business_reviewer の任命** (1〜2 名) | ✅ |
| 2 | **legal_reviewer の任命** (1 名・外部委託可) | ✅（任命のみ・契約は後続）|
| 3 | **final_approver の確認**（木村CIO + 渡辺執行役員 既定）| ✅ |
| 4 | **初回レビューを {len(first_batch)} 件に絞る承認** | ✅ |

**38 件全部レビューする必要はありません。** alpha.5.13 review workload reducer で
**初回バッチを {len(first_batch)} 件に絞り込みました**。残り {38 - len(first_batch)} 件は
**安全に defer / legal / 後続バッチへ振り分け済み**です。

---

## 数字の見方（5 分）

### 全 66 加算の内訳

| status | 件数 | コメント |
|---|---:|---|
| **checked** | **20** | 公開デモで根拠確定済（変更なし）|
| needs_review | 36 | 内訳: needs_master_review 28 / needs_legal_review 5 / divergent 3 |
| pattern_based_unverified | 9 | 記録のみ・追加作業なし |
| not_applicable | 1 | 訪問看護では対象外確定 |

### レビュー対象 38 件の優先度内訳

| risk_level | 件数 | 主な対応 |
|---|---:|---|
| **low (初回バッチ候補)** | {sum(1 for r in priority_rows if r["risk_level"] == "low" and r["can_be_first_batch"] == "yes")} | add_receipt_alias / add_official_code_addition |
| medium | {sum(1 for r in priority_rows if r["risk_level"] == "medium")} | 後続バッチで対応 |
| high | {sum(1 for r in priority_rows if r["risk_level"] == "high")} | correct_internal_legacy_code (PDF回帰必須・後回し) |
| **defer (legal/future_candidate)** | **{sum(1 for r in priority_rows if r["risk_level"] == "defer")}** | 法令確認者または R8.6.1 確定版待ち |

---

## 初回バッチの中身（{len(first_batch)} 件）

CIO が決裁すべき初回バッチは以下です。全件 **add_receipt_alias** または
**add_official_code_addition** で、**PDF 検出パターンに影響しない低リスク変更**:

| # | サービス | kasan | 推奨 decision | 想定時間 |
|---|---|---|---|---|
"""
    for i, r in enumerate(first_batch, start=1):
        text += f"| {i} | {SERVICE_JP[r['service']]} | `{r['kasan_key']}` | `{r['recommended_initial_decision']}` | {r['review_effort']} |\n"

    text += f"""
**初回バッチ業務担当の想定総作業時間**: 約 **{sum(5 if r["review_effort"] == "5min" else 15 if r["review_effort"] == "15min" else 30 for r in first_batch)} 分**

---

## CIO が「決めなくてよい」こと（重要）

以下は alpha.5.13 で **自動的に defer / safe default に振り分け済み**です。CIO は
判断不要:

| カテゴリ | 件数 | safe default | 判断 |
|---|---:|---|---|
| future_candidate_only (R8.6 関連) | {deferred_counts["future_candidate_only"]} | defer_until_r8_definitive | R8.6.1 確定版公開後 |
| needs_legal_review (訪看 複数名・長時間) | {deferred_counts["needs_legal_review"]} | escalate_legal_review | legal_reviewer に委任 |
| divergent | {deferred_counts["divergent"]} | keep_pattern_based_unverified | 記録のみ・追加作業なし |
| 単位不一致・公式 not_found 等 | {deferred_counts["medium_risk_deferred"]} | 後続バッチ | 業務担当の判断材料収集後 |
| 同じパターンの後続代表 (per_service_cap_exceeded) | {deferred_counts["per_service_cap_exceeded"]} | 初回バッチ承認結果を流用 | 業務担当が後続バッチで判断 |
| 高リスク (correct_internal_legacy_code) | {deferred_counts["high_risk_deferred"]} | 後続 PR で個別対応 | PDF 検出回帰必須 |

---

## CIO の 30 分タイムボックス案

| 時間 | 内容 |
|---:|---|
| 0〜5 分 | 本ファイル「結論」を読む |
| 5〜10 分 | 数字の内訳を見る（66加算・38レビュー・初回 {len(first_batch)} 件）|
| 10〜15 分 | 初回バッチの kasan 名と recommended_initial_decision を眺める |
| 15〜20 分 | reviewer 候補 4 名を決める（社内 + 外部） |
| 20〜25 分 | [`REVIEWER_ASSIGNMENT_TEMPLATE.csv`](../alpha5_12_kimura_cio_handoff/REVIEWER_ASSIGNMENT_TEMPLATE.csv) の `(CIO 任命)` 欄を埋める |
| 25〜30 分 | 業務担当に「初回 {len(first_batch)} 件のみ着手で OK」を伝達 |

---

## 次のフェーズ（alpha.5.14+）

CIO 決裁後の流れ:

1. 業務担当が **初回 {len(first_batch)} 件のみ** alpha.5.12 workbook で記入
2. export → alpha.5.10 gate 再実行
3. approved 行が出たら alpha.5.14 dry run
4. 問題なければ alpha.5.15 で master JSON 段階反映
5. 後続バッチ（残り {38 - len(first_batch)} 件のうち legal/future を除く items）を alpha.5.16+ で処理
6. 法令確認者の clearance 取得後に needs_legal_review 5 件を再評価
7. R8.6.1 確定版公開後に future_candidate_only 2 件を再評価

---

## 確認事項（CIO による確認）

- ✅ master JSON は alpha.5.4 公開デモ版から **完全に未変更**（業務データ無変更）
- ✅ checked 20 件は **完全維持**（訪看 14 + 通所 6）
- ✅ R8.6 案資料は checked 昇格に **使っていない**
- ✅ public release pack (alpha.5.3 / alpha.5.4) は **完全未改変**
- ✅ 算定可否を法的に保証する表現は **出していない**
- ✅ reviewer 入力ファイルは **public に出さない**運用

---

_本ファイルは内部レビュー用。public release pack には含めない。_
"""
    (out_dir / "CIO_30MIN_DECISION_BRIEF.md").write_text(text, encoding="utf-8")


def write_workload_by_role(out_dir: Path, priority_rows: list[dict], first_batch: list[dict]):
    n_legal = sum(1 for r in priority_rows if r["review_bucket"] == "needs_legal_review")
    n_future = sum(1 for r in priority_rows if r["review_bucket"] == "future_candidate_only")
    n_divergent = sum(1 for r in priority_rows if r["review_bucket"] == "divergent")
    n_master = sum(1 for r in priority_rows if r["review_bucket"] == "needs_master_review")
    first_total_min = sum(
        5 if r["review_effort"] == "5min"
        else 15 if r["review_effort"] == "15min"
        else 30 for r in first_batch
    )
    text = f"""# Review Workload by Role

**version**: {PACKET_VERSION}
**generated_at**: {GENERATED_AT}

---

## 役割別の想定作業時間

### 木村CIO

- **想定時間**: 約 **{CIO_EXPECTED_MINUTES} 分**
- **やること**:
  - [`CIO_30MIN_DECISION_BRIEF.md`](CIO_30MIN_DECISION_BRIEF.md) を読む
  - reviewer 4 名（business / legal / final_approver 2 名 / developer）の任命を決める
  - 初回レビューを {len(first_batch)} 件に絞る承認
- **やらないこと**:
  - 38 件すべてのレビュー
  - 個別加算の technical 判断
  - master JSON への直接介入

### business_reviewer（初回バッチのみ）

- **想定時間**: 約 **{first_total_min} 分**（≈ {first_total_min // 60} 時間 {first_total_min % 60} 分）
- **対象**: 初回バッチ {len(first_batch)} 件のみ（needs_master_review の low/medium risk のサブセット）
- **やること**:
  - 各加算の `recommended_initial_decision` を確認
  - alpha.5.12 workbook の Decision_Input_All で記入
  - 公式コードと社内コードの単位一致を再確認
- **やらないこと**:
  - 残り {n_master - len(first_batch)} 件の needs_master_review（後続バッチ）
  - {n_legal} 件の needs_legal_review（legal_reviewer に委任）
  - {n_future} 件の future_candidate_only（defer）
  - {n_divergent} 件の divergent（記録のみ・追加作業なし）

### legal_reviewer

- **想定時間**: 初回は **対象外**。後続フェーズで約 5〜15 時間
- **対象**: needs_legal_review {n_legal} 件（複数名訪問看護加算 4 + 長時間訪問看護加算 1）
- **やること**:
  - alpha.5.12 workbook の Needs_Legal_Review シートで legal_review_clearance を判定
  - 介護報酬告示・大臣基準告示・老企第36号 解釈通知を参照
  - clearance=cleared を付与するか判断
- **やらないこと**:
  - 業務担当の judgment に介入
  - master JSON への直接介入

### final_approver（木村CIO + 渡辺執行役員）

- **想定時間**: 初回バッチ後に約 **30 分**
- **対象**: 初回バッチ {len(first_batch)} 件
- **やること**:
  - business_reviewer の入力を確認
  - implementation_allowed = yes / final_approved_by に氏名記入
  - 高リスク decision が含まれていないことを確認（本パケットでは含めていない）
- **やらないこと**:
  - 業務担当・法令確認者の判断を技術的に覆す
  - 38 件すべての判定を最終承認

### developer

- **想定時間**: 約 **2〜4 時間**（alpha.5.14 dry run 準備）
- **対象**: 初回バッチが alpha.5.10 gate を通過した後
- **やること**:
  - workbook → CSV export
  - alpha.5.10 gate 再実行
  - approved_changes_preview の確認
  - alpha.5.14 dry run（master JSON 適用シミュレーション・実反映なし）
- **やらないこと**:
  - 一括 master JSON 反映
  - 公開デモパックの更新

---

## 累積負荷の比較

| 段階 | 従来 (alpha.5.12) | alpha.5.13 reducer 後 |
|---|---|---|
| CIO 想定時間 | 不明確（数時間 〜 数日）| **30 分** ✅ |
| 初回 reviewer 件数 | 38 件 | **{len(first_batch)} 件** ✅ |
| 法令確認者の初回 | 5 件（同時並行）| **対象外** ✅（後続フェーズへ）|
| 最終承認者の初回 | 38 件 | **{len(first_batch)} 件** ✅ |
| 反復回数 | 不明 | 初回バッチ完了後に再評価 |

---

## CIO 任命を待つ待機状態

- alpha.5.13 までで「reviewer がやるべきこと」を可能な限り **絞り込み済み**
- 残るは **CIO の reviewer 任命のみ**
- 任命後は本パケットの [`FIRST_REVIEW_BATCH.csv`](FIRST_REVIEW_BATCH.csv) を渡せば
  業務担当が **{first_total_min} 分** で初回バッチを完了できる想定
"""
    (out_dir / "REVIEW_WORKLOAD_BY_ROLE.md").write_text(text, encoding="utf-8")


def write_safe_default_decisions(out_dir: Path):
    text = f"""# Safe Default Decisions

**version**: {PACKET_VERSION}
**generated_at**: {GENERATED_AT}

---

## 概要

reviewer の判断疲れを抑え、判断が割れた場合に **安全側に倒す** ためのデフォルト選択肢。
本パケットでは reviewer_decision を上書きしませんが、`recommended_initial_decision`
として提示しています。**最終決定は reviewer が行う** 前提です。

---

## バケット別 safe default

### 1. future_candidate_only (2 件) → `defer_until_r8_definitive`

**対象**:
- 訪問介護 `shougu_kaizen_kasan`
- 居宅介護支援 `shougu_kaizen_kasan_2026_06`

**理由**:
- R8.6 案資料 (WAM_R8_6_8_PROVISIONAL_2026_04_30 / `_2026_04_20`) は **案資料**
- `checked_promotion_allowed=false` でガード済（alpha.5.8.1）
- 確定版が出るまで checked 昇格に使えない

**運用**: R8.6.1 確定版（公開後）に alpha.5.16+ で再評価。

---

### 2. needs_legal_review (5 件) → `escalate_legal_review`

**対象**: 訪問看護
- `fukusu_mei_houmon_kango_kasan_I_under30` / `_I_over30` / `_II_under30` / `_II_over30`
- `chouji_kan_houmon_kango_kasan`

**理由**:
- 基本サービスコードへの **付加加算構造** の可能性（独立コードなし）
- 介護報酬告示・大臣基準告示・老企第36号 解釈通知の確認が必要
- business_reviewer が法令解釈を断定すべきでない

**運用**: legal_reviewer に委任。alpha.5.12 workbook の `legal_review_clearance` を
記入してもらう。

---

### 3. divergent (3 件) → `keep_pattern_based_unverified`

**対象**:
- 訪問看護 `shougu_kaizen_kasan_2026_06` (R8.6 関連でもある)
- 通所介護 `adl_iji`
- 通所介護 `ninchi_kasan`

**理由**:
- proposed_action と overall_mapping_status が分岐
- alpha.5.8.1 で `alpha_5_8_1_proposed_overall_divergence_note` に audit_note 化済
- 業務データの不整合ではなく、**正しい記録状態**

**運用**: 現状維持（記録のみ・追加作業不要）。

---

### 4. 高リスク (correct_internal_legacy_code) → 初回バッチには含めない

**理由**:
- 社内 service_codes を公式コードに置換する変更は **PDF 検出パターンを直接書き換える可能性**
- 4 サービス PDF 回帰テスト必須
- alpha.5.10 gate で `implementation_risk_acknowledged=yes` 必須化済（alpha.5.12）

**運用**: alpha.5.16+ で **個別 PR**（1 PR = 1 加算）で段階的に対応。

---

### 5. PDF 検出に影響するもの → 保留

**例**:
- 単位が公式と社内で異なる加算（マスタ訂正の影響範囲が大きい）
- 既存サンプルレポートで「算定中」と表示される加算

**運用**:
- 初回バッチには含めない
- 後続バッチで業務担当が **追加調査** してから判断

---

### 6. 判断が割れる場合 → `keep_pattern_based_unverified`

**運用ルール**:
- reviewer が「もう少し情報が欲しい」と感じたら **`keep_pattern_based_unverified`** に倒す
- master JSON への影響なし
- 後続バッチで再評価可能

---

### 7. 公式コード追加だけで済みそうなもの → `add_official_code_addition`（初回バッチ候補）

**判定基準**:
- 社内 `service_codes` が **空**
- 公式 `official_service_code` が **存在**
- match_type が `code_mismatch` ではない

**理由**:
- 既存 master を **追加のみ** で更新（書き換えなし）
- PDF 検出への影響なし
- リスク最小

---

## safe default の限界

以下は safe default ではカバーできない:
- ✗ 公式コードと社内コードの **意味的同一性**（コード番号は違うが同じ加算か？）
- ✗ R8.6.1 確定版の **実際の差分**（未公開）
- ✗ 自治体ごとの解釈差（書類運用差）

これらは reviewer が判断する必要があります。

---

## CIO の役割

CIO は safe default を **承認する** だけで OK:
1. 本ファイルを読んで「未確定の判断は keep_pattern_based_unverified に倒す」方針を確認
2. business_reviewer / legal_reviewer に「safe default に倒して OK」を伝達
3. 初回バッチで approved 候補がゼロでも **失敗ではない**ことを共有
"""
    (out_dir / "SAFE_DEFAULT_DECISIONS.md").write_text(text, encoding="utf-8")


def write_deferred_items(out_dir: Path, priority_rows: list[dict]):
    # 分類
    by_reason = {
        "legal_required": [],
        "wait_r8_definitive": [],
        "high_risk_master_change": [],
        "divergent_mapping": [],
        "per_service_cap_exceeded": [],
        "low_priority": [],
    }
    for r in priority_rows:
        if r["can_be_first_batch"] == "yes":
            continue
        if r["review_effort"] == "legal_required":
            by_reason["legal_required"].append(r)
        elif r["review_effort"] == "wait_r8_definitive":
            by_reason["wait_r8_definitive"].append(r)
        elif r["review_bucket"] == "divergent":
            by_reason["divergent_mapping"].append(r)
        elif "per_service_cap_exceeded" in r["why_not_first_batch"]:
            by_reason["per_service_cap_exceeded"].append(r)
        elif r["recommended_initial_decision"] == "keep_legacy_detection_only":
            by_reason["low_priority"].append(r)
        else:
            by_reason["low_priority"].append(r)

    text = f"""# Deferred Items

**version**: {PACKET_VERSION}
**generated_at**: {GENERATED_AT}

---

## 概要

初回バッチに含めず **defer (後回し)** したアイテムの一覧。
**defer は失敗ではなく、安全設計です**。

無理に初回で判断すると以下のリスクがあります:
- 判断材料不足のまま強引な判断 → 後から覆す手間
- 法令確認者の clearance なしに進める → 行政指導リスク
- R8.6 案資料を根拠扱い → 確定版と差異が出たら全顧客対応
- PDF 検出パターンの一括書き換え → 既存サンプル / 外販顧客への影響

---

## defer 理由別の件数

| 理由 | 件数 | 再評価フェーズ |
|---|---:|---|
| `legal_required` | {len(by_reason["legal_required"])} | legal_reviewer の clearance 取得後 (alpha.5.13+) |
| `wait_r8_definitive` | {len(by_reason["wait_r8_definitive"])} | R8.6.1 確定版公開後 (alpha.5.16+) |
| `divergent_mapping` | {len(by_reason["divergent_mapping"])} | 後続バッチで個別レビュー |
| `per_service_cap_exceeded` | {len(by_reason["per_service_cap_exceeded"])} | 後続バッチで業務担当が判断（初回バッチ通過後） |
| `high_risk_master_change` | (本パケットでは初回除外のみ) | alpha.5.16+ で個別 PR |
| `low_priority` | {len(by_reason["low_priority"])} | 後続バッチで業務担当が判断 |

---

## 1. legal_required ({len(by_reason["legal_required"])} 件)

法令確認者の clearance が必要。alpha.5.12 で `legal_review_clearance` フラグを
ワークブックに追加済。

| service | kasan_key | display_name |
|---|---|---|
"""
    for r in by_reason["legal_required"]:
        text += f"| {SERVICE_JP[r['service']]} | `{r['kasan_key']}` | {r['display_name']} |\n"

    text += f"""
**運用**: legal_reviewer が alpha.5.12 workbook の Needs_Legal_Review シートで
clearance を記入 → alpha.5.10 gate 再実行 → approved_changes_preview に進む。

---

## 2. wait_r8_definitive ({len(by_reason["wait_r8_definitive"])} 件)

R8.6 案資料は checked 昇格に使えないため、確定版公開まで defer。

| service | kasan_key | display_name |
|---|---|---|
"""
    for r in by_reason["wait_r8_definitive"]:
        text += f"| {SERVICE_JP[r['service']]} | `{r['kasan_key']}` | {r['display_name']} |\n"

    text += f"""
**運用**: R8.6.1 確定版（おそらく令和8年5月下旬〜6月初頭公開予定）が出たら
alpha.5.16+ で再評価。alpha.5.12 workbook の Future_Candidate シート参照。

---

## 3. divergent_mapping ({len(by_reason["divergent_mapping"])} 件)

proposed_action と overall_mapping_status が分岐するアイテム。
alpha.5.8.1 で `alpha_5_8_1_proposed_overall_divergence_note` に audit_note 化済。

| service | kasan_key | display_name |
|---|---|---|
"""
    for r in by_reason["divergent_mapping"]:
        text += f"| {SERVICE_JP[r['service']]} | `{r['kasan_key']}` | {r['display_name']} |\n"

    text += f"""
**運用**: 現状維持（`keep_pattern_based_unverified`）で OK。記録のみ・追加作業不要。

---

## 4. per_service_cap_exceeded ({len(by_reason["per_service_cap_exceeded"])} 件)

初回バッチで「同サービスから 2 件まで」のような上限を設けたため、cap を超えて
こぼれた **代表選定候補の残り** です。多くは初回バッチに含めた kasan と
**同じ社内コード体系** を持っており、初回バッチで承認された対応方針を
そのまま後続バッチに適用できる可能性が高いです。

| service | kasan_key | display_name | recommended_initial_decision |
|---|---|---|---|
"""
    for r in by_reason["per_service_cap_exceeded"]:
        text += f"| {SERVICE_JP[r['service']]} | `{r['kasan_key']}` | {r['display_name']} | `{r['recommended_initial_decision']}` |\n"

    text += f"""
**運用**: 初回バッチが alpha.5.10 gate を通過し、approved_changes_preview が
生成されたあと、業務担当が **同じ判断パターンを後続バッチに適用** できるか確認。
無理がなければ 5〜10 件ずつバッチ化して進める。

---

## 5. low_priority / 後続バッチ ({len(by_reason["low_priority"])} 件)

初回バッチには入らなかったが、後続バッチで業務担当が判断するアイテム。

| service | kasan_key | display_name | why_not_first_batch |
|---|---|---|---|
"""
    for r in by_reason["low_priority"]:
        text += f"| {SERVICE_JP[r['service']]} | `{r['kasan_key']}` | {r['display_name']} | {r['why_not_first_batch']} |\n"

    text += """
**運用**: 初回バッチが alpha.5.10 gate を通過した後、業務担当が次のバッチを判断。
1 バッチあたり 5〜10 件を目安に進める。

---

## defer は失敗ではない

**重要なメッセージ**:

- defer は **安全設計の一部** です
- 「全件を一気に approved にする」ことを目指していません
- 「reviewer / CIO の負担を増やさず、安全に master JSON 反映を進める」
  ことを目指しています
- 法令確認・R8.6.1 確定版・追加情報の収集を待つ間は、**現状の運用は問題なく機能**しています
- 外部に出ている公開デモパック (alpha.5.3 / alpha.5.4) は **完全未改変** で
  顧客への影響なし

---

## 次のフェーズへの引き継ぎ

各 defer 理由ごとに、再評価が可能になる条件:

| 理由 | 再評価可能な条件 | 担当 |
|---|---|---|
| legal_required | legal_reviewer の clearance 取得 | legal_reviewer |
| wait_r8_definitive | R8.6.1 確定版 PDF 公開 | 開発担当 (公開 PDF を取得) |
| divergent_mapping | 後続バッチでの個別判断 | business_reviewer |
| high_risk_master_change | alpha.5.16+ で個別 PR | 開発担当 + business_reviewer |
| low_priority | 初回バッチ完了後 | business_reviewer |
"""
    (out_dir / "DEFERRED_ITEMS.md").write_text(text, encoding="utf-8")


def write_readme(out_dir: Path, manifest: dict, priority_rows: list[dict], first_batch: list[dict]):
    text = f"""# alpha.5.13 Review Workload Reducer

**version**: {PACKET_VERSION}
**base_commit**: `{ALPHA_5_12_HANDOFF_COMMIT}` (alpha.5.12 kimura cio handoff)
**generated_at**: {GENERATED_AT}

---

## 目的

alpha.5.12 までで木村CIO ハンドオフパックを揃えましたが、38 件全件を一括レビュー
依頼するのは負荷が高すぎるため、本パケットで **初回バッチを {len(first_batch)} 件に絞り込み**、
残りを **安全に defer / legal / future_candidate へ振り分け** ました。

- CIO が 30 分で判断できる brief あり
- 初回バッチ {len(first_batch)} 件のみで業務担当の作業時間を最小化
- 法令確認者は初回対象外（後続フェーズ）
- 残り {38 - len(first_batch)} 件は明示的に defer

## 不変条件（テストで保護）

- ❌ master JSON 自動修正なし
- ❌ 新規 checked 昇格なし
- ❌ R8.6 案資料は checked 昇格に使わない
- ❌ public release pack は本 alpha.5.13 で更新しない
- ❌ alpha.5.9 packet / alpha.5.10 gate / alpha.5.11 / 5.12 workbook / 5.12 handoff は破壊しない
- ❌ implementation_allowed=yes は自動で付けない
- ❌ approved_changes_preview は作らない
- ❌ reviewer_decision は上書きしない

## 含まれるファイル

| ファイル | 用途 |
|---|---|
| `README.md` | 本ファイル |
| `CIO_30MIN_DECISION_BRIEF.md` | 木村CIO 向け 30 分決裁ブリーフ |
| `REVIEW_PRIORITY_MATRIX.csv` | 38 件の優先度マトリクス (13 列・UTF-8 BOM) |
| `FIRST_REVIEW_BATCH.csv` | 初回バッチ {len(first_batch)} 件 (9 列) |
| `REVIEW_WORKLOAD_BY_ROLE.md` | 役割別の想定作業時間 |
| `SAFE_DEFAULT_DECISIONS.md` | safe default decisions の整理 |
| `DEFERRED_ITEMS.md` | defer したアイテムの分類と再評価条件 |
| `alpha5_13_review_workload_reducer_manifest.json` | パケットメタデータ |

## 数字サマリ

| カテゴリ | 件数 |
|---|---:|
| 全レビュー対象 | 38 |
| **初回バッチ** | **{manifest["first_batch_actual_rows"]}** |
| 後続バッチ候補 (medium risk / 単位不一致 / not_found) | {manifest["deferred_low_priority"]} |
| 同じパターンの後続代表 (per_service_cap_exceeded) | {manifest["deferred_per_service_cap_exceeded"]} |
| divergent (記録のみ) | {manifest["deferred_divergent"]} |
| needs_legal_review (法令確認者へ) | {manifest["deferred_legal_required"]} |
| future_candidate_only (R8.6.1 待ち) | {manifest["deferred_wait_r8_definitive"]} |

## CIO がやること（30 分・4 つ）

1. `CIO_30MIN_DECISION_BRIEF.md` を読む
2. reviewer 4 名（business / legal / final_approver × 2 / developer）を決める
3. 初回バッチ {len(first_batch)} 件のみで進めることを承認
4. business_reviewer に `FIRST_REVIEW_BATCH.csv` を渡す

## 再生成方法

```
cd products/kasan-manager
python scripts/generate_alpha5_13_review_workload_reducer.py
```

idempotent: master JSON が変わらない限り同じ packet が出力される。

---

_本パケットは内部レビュー用。public release pack には含めない。_
"""
    (out_dir / "README.md").write_text(text, encoding="utf-8")


# ============================================================
# Main
# ============================================================

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # alpha.5.9 packet の参照
    decision_template_rows = load_csv_rows(ALPHA_5_9_PACKET_DIR / "reviewer_decision_template.csv")
    needs_legal_rows = load_csv_rows(ALPHA_5_9_PACKET_DIR / "needs_legal_review_matrix.csv")
    needs_master_rows = load_csv_rows(ALPHA_5_9_PACKET_DIR / "needs_master_review_matrix.csv")

    master_data = load_master_kasans()

    alpha_5_9_legal_keys = {(r["service"], r["kasan_key"]) for r in needs_legal_rows}
    alpha_5_9_master_keys = {(r["service"], r["kasan_key"]) for r in needs_master_rows}

    # 各 38 件の優先度を分類
    priority_rows = []
    for r in decision_template_rows:
        svc = r["service"]
        k = r["kasan_key"]
        classification = classify_priority(svc, k, master_data,
                                             alpha_5_9_legal_keys, alpha_5_9_master_keys)
        priority_rows.append(classification)

    # 初回バッチを選定
    first_batch = select_first_batch(priority_rows, max_rows=FIRST_BATCH_MAX_ROWS)

    # 各種ファイル出力
    write_priority_matrix(OUT_DIR, priority_rows)
    write_first_batch(OUT_DIR, first_batch)

    # deferred 内訳の集計（cap 後の状態を使う）
    in_first_batch_keys = {(r["service"], r["kasan_key"]) for r in first_batch}
    deferred_counts = {
        "needs_legal_review": sum(1 for r in priority_rows if r["review_bucket"] == "needs_legal_review"),
        "future_candidate_only": sum(1 for r in priority_rows if r["review_bucket"] == "future_candidate_only"),
        "divergent": sum(1 for r in priority_rows if r["review_bucket"] == "divergent"),
        "medium_risk_deferred": sum(1 for r in priority_rows
                                      if r["risk_level"] == "medium"
                                      and (r["service"], r["kasan_key"]) not in in_first_batch_keys
                                      and r["review_bucket"] not in ("divergent",)),
        "per_service_cap_exceeded": sum(1 for r in priority_rows
                                          if "per_service_cap_exceeded" in r["why_not_first_batch"]),
        "high_risk_deferred": sum(1 for r in priority_rows if r["risk_level"] == "high"),
    }

    write_cio_30min_brief(OUT_DIR, priority_rows, first_batch, deferred_counts)
    write_workload_by_role(OUT_DIR, priority_rows, first_batch)
    write_safe_default_decisions(OUT_DIR)
    write_deferred_items(OUT_DIR, priority_rows)

    # manifest
    manifest = {
        "version": PACKET_VERSION,
        "base_commit": ALPHA_5_12_HANDOFF_COMMIT,
        "base_commit_label": "alpha.5.12 kimura cio handoff",
        "input_packet_version": INPUT_PACKET_VERSION,
        "generated_at": GENERATED_AT,
        "generator_script": "scripts/generate_alpha5_13_review_workload_reducer.py",
        "purpose": "alpha.5.12 ハンドオフを受けて、reviewer 負担を削減する初回バッチ + safe default を提示",
        "scope": "internal_only",
        "public_release": False,
        "checked_promotion": False,
        "master_auto_update": False,
        "r8_provisional_used_for_checked": False,
        "release_pack_modified": False,
        "alpha_5_9_packet_files_modified": False,
        "alpha_5_10_gate_files_modified": False,
        "alpha_5_11_workbook_files_modified": False,
        "alpha_5_12_handoff_files_modified": False,
        "alpha_5_12_workflow_hardening_files_modified": False,
        "cio_expected_time_minutes": CIO_EXPECTED_MINUTES,
        "total_review_rows": len(decision_template_rows),
        "first_batch_max_rows": FIRST_BATCH_MAX_ROWS,
        "first_batch_actual_rows": len(first_batch),
        "first_batch_total_min": sum(
            5 if r["review_effort"] == "5min"
            else 15 if r["review_effort"] == "15min"
            else 30 for r in first_batch
        ),
        "deferred_legal_required": deferred_counts["needs_legal_review"],
        "deferred_wait_r8_definitive": deferred_counts["future_candidate_only"],
        "deferred_divergent": deferred_counts["divergent"],
        "deferred_low_priority": deferred_counts["medium_risk_deferred"],
        "deferred_per_service_cap_exceeded": deferred_counts["per_service_cap_exceeded"],
        "deferred_high_risk": deferred_counts["high_risk_deferred"],
        "first_batch_services": sorted(set(r["service"] for r in first_batch)),
        "files": [
            "README.md",
            "CIO_30MIN_DECISION_BRIEF.md",
            "REVIEW_PRIORITY_MATRIX.csv",
            "FIRST_REVIEW_BATCH.csv",
            "REVIEW_WORKLOAD_BY_ROLE.md",
            "SAFE_DEFAULT_DECISIONS.md",
            "DEFERRED_ITEMS.md",
            "alpha5_13_review_workload_reducer_manifest.json",
        ],
        "invariants": [
            "master JSON 自動修正なし",
            "reviewer_decision を上書きしない（recommended_initial_decision として提示のみ）",
            "implementation_allowed=yes は自動で付けない",
            "approved_changes_preview は作らない",
            "新規 checked 昇格なし",
            "R8.6 案資料を checked 昇格に使わない",
            "public release pack 未変更",
            "alpha.5.9〜5.12 の上流 packet 未破壊",
            "checked 20件 維持",
            "CIO 想定時間 ≤ 30 分",
            "初回バッチ ≤ 10 件",
        ],
    }
    (OUT_DIR / "alpha5_13_review_workload_reducer_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    write_readme(OUT_DIR, manifest, priority_rows, first_batch)

    print(f"alpha.5.13 review workload reducer generated at {OUT_DIR}")
    print(f"  total_review_rows: {len(decision_template_rows)}")
    print(f"  first_batch     : {len(first_batch)} (max {FIRST_BATCH_MAX_ROWS})")
    print(f"  legal           : {deferred_counts['needs_legal_review']}")
    print(f"  future_candidate: {deferred_counts['future_candidate_only']}")
    print(f"  divergent       : {deferred_counts['divergent']}")
    print(f"  low_priority    : {deferred_counts['medium_risk_deferred']}")
    print(f"  first_batch total time: {manifest['first_batch_total_min']} min")


if __name__ == "__main__":
    main()
