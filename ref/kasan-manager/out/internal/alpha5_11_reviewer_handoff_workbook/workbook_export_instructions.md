# alpha.5.11 Workbook Export Instructions

## Excel 保存時の注意

- **必ず .xlsx 形式で保存**してください（.xls 旧形式 / .csv 単体での保存は禁止）
- 上書き保存で OK（ファイル名は `alpha5_11_reviewer_decision_workbook.xlsx` のまま）
- マクロは使っていないので「ブック有効化」のような選択肢が出た場合は標準のままで保存

## export script の実行方法

```
cd products/kasan-manager
python scripts/export_alpha5_11_workbook_decisions.py
```

オプション:
- `--workbook` : 別の Excel パスを指定（default: `out/internal/alpha5_11_reviewer_handoff_workbook/alpha5_11_reviewer_decision_workbook.xlsx`）
- `--output` : 出力 CSV のパス（default: `out/internal/alpha5_11_reviewer_handoff_workbook/reviewer_decision_export.csv`）

## export 結果の確認

```
out/internal/alpha5_11_reviewer_handoff_workbook/reviewer_decision_export.csv
```

このファイルは alpha.5.10 gate と互換の列構造（service / kasan_key / reviewer_decision / reason / required_evidence / reviewer_name / reviewed_at / final_approved_by / implementation_allowed）です。

## alpha.5.10 gate を再実行する方法（reviewer 入力後）

### default 挙動（alpha.5.9 テンプレート読み込み）
```
python scripts/generate_alpha5_10_reviewer_decision_gate.py
```
→ 入力: `out/internal/alpha5_9_master_review_packet/reviewer_decision_template.csv`
→ 出力: `out/internal/alpha5_10_reviewer_decision_gate/`

### workbook export を入力にする（alpha.5.11 ワークブック由来）
```
python scripts/generate_alpha5_10_reviewer_decision_gate.py \
  --input out/internal/alpha5_11_reviewer_handoff_workbook/reviewer_decision_export.csv \
  --output out/internal/alpha5_10_reviewer_decision_gate_from_workbook/
```
→ 出力: `out/internal/alpha5_10_reviewer_decision_gate_from_workbook/`

**default 挙動は変更されません**。reviewer ワークブック由来の検証結果は別ディレクトリに分離されます。

## blocked_or_incomplete_decisions.csv の直し方

| blocked_reason | 直し方 |
|---|---|
| invalid_reviewer_decision | プルダウン外の値が入った。Decision_Input_All の reviewer_decision を Valid_Values シートの値から選び直す |
| invalid_implementation_allowed | yes / no / pending 以外が入った。再選択 |
| missing_required_fields_when_implementation_allowed_yes | implementation_allowed=yes だが必須フィールド欠落。reason / required_evidence / reviewer_name / reviewed_at / final_approved_by を埋める |
| duplicate_service_kasan_key | 同じ kasan_key が複数行ある。1つに統合 |
| future_candidate_only_must_be_defer_until_r8_definitive | future_candidate 行は defer のみ可。reviewer_decision を `defer_until_r8_definitive` に変更 |

## pending_decisions.csv の見方

| pending_reason | 意味 | 次のアクション |
|---|---|---|
| blank_template_row | 未入力 | 業務担当・法令確認者・最終承認者が記入 |
| non_modifying_decision_recorded | 決定は記録されたが master 修正対象外 | 追加作業不要・記録のまま |
| deferred_until_r8_definitive | R8.6.1 確定版待ち | 確定版が出たら alpha.5.12+ で再評価 |
| implementation_not_yet_approved | implementation_allowed が yes 以外 | 最終承認者が yes に変更 |

## legal_review_required.csv の見方

- legal_question / reference_needed が記載されている
- 法令確認者が告示・通知を確認し、Decision_Input_All の該当行を再記入
- ただし alpha.5.11 では `legal_review_clearance` フラグは未実装
- alpha.5.12+ で実装予定（それまでは legal_review_required に滞留）
