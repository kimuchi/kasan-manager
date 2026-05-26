# alpha.5.10 Decision Validation Report

**version**: alpha.5.10
**base_commit**: `d0c911db9b28f561f0e40859a4c40e863982d7f6` (alpha.5.9)
**input**: `out/internal/alpha5_9_master_review_packet/reviewer_decision_template.csv` (alpha.5.9 master_review_packet)
**generated_at**: 2026-05-10

---

## 1. 入力ファイル

- 入力: `out/internal/alpha5_9_master_review_packet/reviewer_decision_template.csv`
- 入力行数: **38**
- 入力 packet version: `alpha.5.9`
- alpha.5.9 packet 内の対象内訳:
  - needs_master_review: 28 件
  - needs_legal_review: 5 件
  - divergent: 3 件
  - future_candidate_only: 2 件
  - 合計: 38 件

## 2. 検証結果サマリ

| バケット | 件数 |
|---|---:|
| approved_changes_preview (master修正候補) | 0 |
| blocked_or_incomplete_decisions | 0 |
| pending_decisions | 38 |
| legal_review_required | 0 |
| **合計** | **38** |

参考カウント:
- future_candidate_count: 2
- divergent_count: 3

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
