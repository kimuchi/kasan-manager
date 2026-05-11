# alpha.5.11 Reviewer Handoff Guide

**version**: alpha.5.11
**base_commit**: `c9cf05cf5bba29f91231837c34aa42c91153cb27` (alpha.5.10)
**generated_at**: 2026-05-10

---

## このガイドの目的

alpha.5.11 reviewer ワークブック (`alpha5_11_reviewer_decision_workbook.xlsx`) を使って、
業務担当・法令確認者・最終承認者がそれぞれの役割で **正しく** 判断入力するための手順書です。

## 役割別フロー

### 1. 業務担当向け

#### 担当範囲
- needs_master_review 28件（社内コードと公式コードの不一致）
- divergent 3件（pa と overall の分岐）

#### 手順
1. ワークブックを開いて **Needs_Master_Review** シートで内訳を確認
2. **Decision_Input_All** シートで対象行（bucket = needs_master_review / divergent）を編集
3. reviewer_decision プルダウンから選択:
   - `approve_official_code_addition`（公式コードを master に追加）
   - `add_receipt_alias`（公式コードを社内コードの alias 登録）
   - `correct_internal_legacy_code`（社内コード置換 — **高リスク**）
   - `keep_legacy_detection_only`（現状維持）
   - `mark_structural_mismatch`（構造解釈不要・記録のみ）
4. reason / required_evidence / reviewer_name / reviewed_at を記入
5. final_approved_by は最終承認者の入力枠（自分が最終承認者でない限り空欄でOK）
6. implementation_allowed をプルダウンから選択（yes / no / pending）

#### 入力例（OK）
```
service: tsusho_kaigo
kasan_key: chujudosha_care_taisei
reviewer_decision: add_receipt_alias
reason: 公式コード 155306 と社内コード 156271 の単位は一致するためエイリアス登録で対応
required_evidence: WAM_R7_8_DEFINITIVE_2025_03_28 PDF p131 で確認済
reviewer_name: 業務担当A
reviewed_at: 2026-05-15
final_approved_by: （最終承認者記入）
implementation_allowed: pending
```

#### 入力例（NG）
- `reviewer_decision: approve_official_code_addition` だが reason / required_evidence が空欄
  → `implementation_allowed=yes` にすると blocked
- `reviewer_decision: definitely_invalid_choice` → blocked（プルダウン外の値）
- needs_legal_review 行に `add_receipt_alias` → legal_review_required に分離（approved にならない）

### 2. 法令確認者向け

#### 担当範囲
- needs_legal_review 5件（複数名訪問看護加算 4件 + 長時間訪問看護加算 1件）
- escalate_legal_review が選ばれた他バケットの加算

#### 手順
1. **Needs_Legal_Review** シートで `legal_question` / `reference_needed` / `why_not_checked` を読む
2. 関係告示・通知（介護報酬告示・大臣基準告示・老企第36号 解釈通知 等）を参照
3. 確認結果を **Needs_Legal_Review** シート右端の `legal_review_clearance_note (optional)` 列に書く（備考のみ）
4. **Decision_Input_All** シートで該当行を編集:
   - 法令通知が出ていない場合 → `escalate_legal_review`（approved にならない）
   - 構造的に独立コードがないと判断 → `mark_structural_mismatch`
   - R8.6.1 確定版待ち → `defer_until_r8_definitive`

#### 重要
- alpha.5.11 では `legal_review_clearance` フラグは未実装です
- どんな decision でも、needs_legal_review バケットの行は alpha.5.10 gate で **legal_review_required** に分離されます
- approved にしたい場合は alpha.5.12+ で `legal_review_clearance` フラグを実装してから再評価

### 3. 最終承認者向け

#### 担当範囲
- 業務担当・法令確認者の入力後、`final_approved_by` 列にハンコを入れる
- `implementation_allowed=yes` の最終判断（特に `correct_internal_legacy_code` のような **高リスク** 行）

#### 手順
1. **Decision_Input_All** シートで全38行を確認
2. reviewer_decision / reason / required_evidence / reviewer_name / reviewed_at が揃っているか確認
3. 問題なければ `final_approved_by` に氏名・役職を記入し、`implementation_allowed=yes` に変更
4. `correct_internal_legacy_code` の行は **PDF検出回帰テスト必須** であることを開発担当に伝達
5. 保存後、ターミナルで `python scripts/export_alpha5_11_workbook_decisions.py` を実行
6. CSV 出力を確認後、`scripts/generate_alpha5_10_reviewer_decision_gate.py --input ...` で再ゲート

## R8.6 案資料の扱い（重要）

- WAM_R8_6_8_PROVISIONAL_2026_04_30 は **案資料** で、checked 昇格には使えません
- future_candidate_only 2 件（訪介 shougu_kaizen_kasan / 居宅 shougu_kaizen_kasan_2026_06）は
  必ず `defer_until_r8_definitive` のみ受理します
- 他の decision を入れると alpha.5.10 gate で **blocked** になります
- R8.6.1 確定版が出たら alpha.5.12+ で再評価

## NG decision 例（approved にならない）

| 状況 | 結果 |
|---|---|
| needs_legal_review 行で何でも入力 | legal_review_required へ |
| future_candidate_only 行で `approve_official_code_addition` | blocked（必ず defer） |
| 重複行（service+kasan_key 同じ） | 後発が blocked |
| `implementation_allowed=yes` で必須フィールド欠落 | blocked |
| プルダウン外の値 | blocked |

## サマリ

| カテゴリ | 件数 | 担当 |
|---|---:|---|
| Decision_Input_All 合計 | 38 | 各役割 |
| needs_master_review | 28 | 業務担当 |
| needs_legal_review | 5 | 法令確認者 |
| divergent | 3 | 業務担当 |
| future_candidate_only | 2 | reviewer 操作不要・defer のみ |
