# Review Workflow Guide

**version**: alpha.5.12-kimura-cio-handoff
**generated_at**: 2026-05-10
**target audience**: 業務担当 / 法令確認者 / 最終承認者

---

## 全体フロー

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 木村CIO が reviewer を任命                                    │
│ (REVIEWER_ASSIGNMENT_TEMPLATE.csv で割り当て)                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. 各 reviewer に Excel ワークブックを配布                       │
│ alpha5_12_reviewer_decision_workbook.xlsx (28KB)                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
       ┌────────────┬────────────┬────────────────┐
       ↓            ↓            ↓                ↓
┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────────┐
│ 業務担当 │ │ 法令確認 │ │ 最終承認者   │ │ (R8.6.1 待ち) │
│ 28+3件   │ │ 5件      │ │ 38件最終OK   │ │ 2件 defer    │
└──────────┘ └──────────┘ └──────────────┘ └──────────────┘
       ↓            ↓            ↓                ↓
       └────────────┴────────────┴────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. reviewer が Excel を保存 → CSV エクスポート                   │
│ python scripts/export_alpha5_11_workbook_decisions.py            │
│   --workbook .../alpha5_12_reviewer_decision_workbook.xlsx       │
│   --output .../reviewer_decision_export.csv                      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. alpha.5.10 gate 再実行                                        │
│ python scripts/generate_alpha5_10_reviewer_decision_gate.py      │
│   --input .../reviewer_decision_export.csv                       │
│   --output .../alpha5_10_reviewer_decision_gate_from_workbook/   │
└─────────────────────────────────────────────────────────────────┘
                            ↓
       ┌────────────┬────────────┬────────────────┬─────────────┐
       ↓            ↓            ↓                ↓             ↓
   approved      blocked     pending        legal_review     future
   (master      (修正必要)   (記入待ち)     _required        _candidate
   修正候補)                                (法令確認待ち)    (defer)
       ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. approved だけが alpha.5.13 dry run へ進む                     │
│ master JSON は **alpha.5.13 でも実反映しない**（シミュのみ）     │
└─────────────────────────────────────────────────────────────────┘
```

---

## reviewer ワークブックの開き方

### ファイルの場所
```
products/kasan-manager/out/internal/alpha5_12_reviewer_workflow_hardening/
  alpha5_12_reviewer_decision_workbook.xlsx
```

### Excel で開いたあと

1. **README** シートで全体像を確認
2. **Valid_Values** シートで選択肢の意味を理解
3. **Decision_Input_All** シートが入力本体（21 列・38 行）
4. 必要に応じて **Needs_Master_Review** / **Needs_Legal_Review** /
   **Divergent** / **Future_Candidate** シートで詳細を参照

---

## Decision_Input_All の入力方法

### 列構成（21 列）

| 列 | 内容 | 入力 |
|---|---|---|
| service / kasan_key | 加算識別子 | 編集禁止（既存値） |
| kasan_display_name | 加算名 | 編集禁止 |
| bucket | needs_master_review / needs_legal_review / future_candidate_only / divergent | 編集禁止 |
| current_overall_mapping_status / proposed_action | 現状ラベル | 編集禁止 |
| **reviewer_decision** | プルダウン 8 選択肢 | **必須入力** |
| **reason** | 判断理由 | impl=yes 時 **必須** |
| **required_evidence** | 根拠（PDF page 等） | impl=yes 時 **必須** |
| **reviewer_name** | 担当者氏名 | impl=yes 時 **必須** |
| **reviewed_at** | レビュー日（YYYY-MM-DD） | impl=yes 時 **必須** |
| **final_approved_by** | 最終承認者氏名 | impl=yes 時 **必須** |
| **implementation_allowed** | プルダウン yes/no/pending | **必須入力** |
| **reviewer_role** | プルダウン 3 選択肢 | 推奨入力 |
| review_note | 自由記述メモ | 任意 |
| **legal_review_clearance** | needs_legal_review 5 件で必須 | 法令確認者が記入 |
| legal_review_reference | 解釈通知の出典 | clearance=cleared 時必須 |
| legal_review_note | 法令確認者の所感 | 任意 |
| implementation_priority | high/medium/low/defer | 推奨入力 |
| **implementation_risk_acknowledged** | プルダウン yes/no/pending | **高リスク decision 時必須** |
| input_status_hint | 自動表示のヒント | 編集禁止 |

### 色分けの意味

| 色 | 意味 |
|---|---|
| 🟦 薄水色 | needs_legal_review 5 件（法令確認者が clearance を埋めるまで approved にならない）|
| 🟩 薄緑 | future_candidate_only 2 件（必ず `defer_until_r8_definitive` のみ可）|
| 🟧 サーモン | divergent 3 件（参照のみ・proposed_action と overall の差を理解した上で判断）|
| 🟨 薄黄 | impl=yes 時に必須なフィールドの目印 |
| 🔴 濃オレンジ | 高リスク decision (correct_internal_legacy_code) の警告 |

---

## 業務担当が見る箇所

### Needs_Master_Review シート（28 件）

各加算について以下を確認:
- `official_service_code` / `official_unit` / `official_calc_unit`（公式 PDF の値）
- `internal_legacy_code` / `internal_legacy_unit`（社内マスタの値）
- `mismatch_type` / `mismatch_summary`（不一致の種類）
- `proposed_review_question`（業務担当向けの質問）
- `recommended_next_step`（次の一歩の候補）

### 判断のパターン

| 不一致のタイプ | 候補 reviewer_decision |
|---|---|
| 公式コードはあるが社内未登録 | `approve_official_code_addition`（公式追加）|
| 社内コードあり、公式と単位一致だがコード違い | `add_receipt_alias`（alias 登録・低リスク）|
| 社内コードあり、コード体系を根本から変えたい | `correct_internal_legacy_code`（**高リスク・PDF検出回帰必須**）|
| 公式 PDF に該当なし、社内コードのみで運用継続 | `keep_legacy_detection_only` |
| 既に検出パターン稼働中、コード照合なしで OK | `keep_pattern_based_unverified` |
| 法令解釈不明 | `escalate_legal_review`（法令確認者へ送る）|

---

## 法令確認者が見る箇所

### Needs_Legal_Review シート（5 件・全て訪問看護）

- `fukusu_mei_houmon_kango_kasan_I_under30` / `_I_over30` / `_II_under30` / `_II_over30`
- `chouji_kan_houmon_kango_kasan`

### 確認内容

| 列 | 確認すべきこと |
|---|---|
| `legal_review_reason` | なぜ法令確認が必要か |
| `structural_issue_type` | 構造的問題のタイプ（基本コードへの付加加算等）|
| `why_not_checked` | checked 化していない理由 |
| `legal_question` | 法令確認者向けの問い |
| `reference_needed` | 参照すべき告示・通知 |

### 確認結果の入力

Decision_Input_All シートの該当行で:
- `reviewer_role` = `legal_reviewer`
- `legal_review_clearance` = `cleared` / `not_cleared` / `pending` / `not_required` から選ぶ
- `legal_review_reference` = 参照した告示・通知の番号（例: 「令和8年5月XX日 老企第XXX号」）
- `legal_review_note` = 自由記述メモ

### clearance 判定ルール

| clearance | gate での扱い |
|---|---|
| `cleared` | 他の必須フィールド全揃い + impl=yes なら approved 候補に進める |
| `not_cleared` | 法令確認の結果、clearance 不可 → legal_review_required（approved にならない）|
| `pending` | 確認中 → legal_review_required |
| `not_required` | needs_legal_review 以外の加算で reviewer が便宜的に記載（判定には使わない）|

---

## 最終承認者が見る箇所

### 全 38 行で確認

最終承認者（木村CIO + 渡辺執行役員 想定）は:
1. `reviewer_decision` が業務担当・法令確認者の判断と整合しているか
2. `reason` / `required_evidence` が十分か
3. `reviewer_name` / `reviewed_at` が記入済か
4. `final_approved_by` 列に自分の氏名・役職を記入
5. `implementation_allowed` を `yes` / `no` / `pending` のいずれかに設定
6. **高リスク decision (correct_internal_legacy_code)** の場合は
   `implementation_risk_acknowledged` = `yes` を確認した上で yes に設定

---

## export 方法

```
cd products/kasan-manager
python scripts/export_alpha5_11_workbook_decisions.py \
  --workbook out/internal/alpha5_12_reviewer_workflow_hardening/alpha5_12_reviewer_decision_workbook.xlsx \
  --output out/internal/alpha5_12_reviewer_workflow_hardening/reviewer_decision_export.csv
```

オプション:
- `--schema auto` (default) ワークブックから自動判定（alpha.5.12 ワークブックなら 16 列出力）
- `--schema legacy` 9 列のみ出力
- `--schema extended` 16 列固定（拡張列が空なら空欄で埋める）

---

## alpha.5.10 gate 再実行方法

```
python scripts/generate_alpha5_10_reviewer_decision_gate.py \
  --input out/internal/alpha5_12_reviewer_workflow_hardening/reviewer_decision_export.csv \
  --output out/internal/alpha5_10_reviewer_decision_gate_from_alpha5_12_workbook/
```

出力ディレクトリ内の **8 ファイル** を確認:
- `decision_validation_report.md`（人間向けサマリ）
- `approved_changes_preview.csv`（master 修正候補）
- `approved_changes_preview.json`（同 JSON 版）
- `blocked_or_incomplete_decisions.csv`（要修正）
- `pending_decisions.csv`（記入待ち / non-modifying / defer）
- `legal_review_required.csv`（法令確認待ち）
- `README.md` / `alpha5_10_reviewer_decision_gate_manifest.json`

---

## approved / blocked / pending / legal_review_required の見方

### approved_changes_preview.csv（master 修正候補）

| 列 | 内容 |
|---|---|
| `proposed_change_type` | `add_official_code_to_master` / `add_receipt_alias_to_master` / `replace_internal_legacy_code_with_official` |
| `current_overall_mapping_status` / `proposed_next_status` | 変更前後の状態 |
| `implementation_risk` | low / medium / **high** (= correct_internal_legacy_code) |
| `implementation_note` | 注意事項（divergent 由来 / 法令 cleared 由来 等）|

**重要**: 本ファイルは **master 修正候補** であり、**alpha.5.12 段階では実反映しません**。
alpha.5.13 dry run → alpha.5.14+ で個別 PR にて段階反映。

### blocked_or_incomplete_decisions.csv（要修正）

| `blocked_reason` | 直し方 |
|---|---|
| `invalid_reviewer_decision` | プルダウン選択肢から選び直す |
| `missing_required_fields_when_implementation_allowed_yes` | 不足フィールドを埋める（`missing_fields` 列に詳細）|
| `duplicate_service_kasan_key` | 重複行を 1 つに統合 |
| `future_candidate_only_must_be_defer_until_r8_definitive` | future_candidate 行は `defer_until_r8_definitive` のみ可 |
| `high_risk_decision_requires_implementation_risk_acknowledged_yes` | risk_ack=yes に設定（PDF検出回帰の確認後）|

### pending_decisions.csv（保留）

| `pending_reason` | 意味 |
|---|---|
| `blank_template_row` | 完全空欄 → 業務担当が記入 |
| `non_modifying_decision_recorded` | 決定は記録されたが master 修正対象外（追加作業不要）|
| `deferred_until_r8_definitive` | R8.6.1 確定版が出るまで保留 |
| `implementation_not_yet_approved` | impl が yes 以外（最終承認者の決定待ち）|

### legal_review_required.csv（法令確認待ち）

needs_legal_review 5 件のうち、`legal_review_clearance` が cleared 以外の行が
ここに分類される。法令確認者が確認後、Decision_Input_All シートに反映して再 export。

---

## 反復ループ

```
入力ミスや不足があれば:
  1. blocked_or_incomplete_decisions.csv を見る
  2. recommended_fix に従って Decision_Input_All で修正
  3. ワークブックを保存
  4. export → gate 再実行
  5. blocked / pending / legal が解消されるまで繰り返す
```

---

## 完了の定義

reviewer 作業が完了したと言えるのは:
- approved_changes_preview.csv に **必要な行が揃っている**
- blocked が **0 件**
- pending は **記入待ち以外**（non_modifying / deferred は OK）
- legal_review_required は **clearance=cleared/not_cleared/not_required** のいずれかに確定
  （pending は残らない）
- 最終承認者の `final_approved_by` がすべての approved 行に記入されている

完了を確認したら木村CIO に報告し、**alpha.5.13 dry run** の GO を仰ぐ。
