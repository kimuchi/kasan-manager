# alpha.5.12 Reviewer Workflow Hardening

**version**: alpha.5.12
**base_commit**: `a3af77843f01653f1e7e10c99ece00b98faa2aba` (alpha.5.11)
**input_packet_version**: alpha.5.11
**input_gate_version**: alpha.5.10
**generated_at**: 2026-05-10

---

## 位置付け

alpha.5.11 で作成した reviewer handoff workbook を、人間レビュー投入前に運用面で強化したパケット。
特に、`legal_review_clearance` フラグと Excel 備考欄 export 拡張、サンプルレビュー fixture による
gate 受け入れテストを追加し、実レビュー後に alpha.5.10 gate が詰まらない状態にする。

- 出力先: `out/internal/alpha5_12_reviewer_workflow_hardening/`（**out/internal 配下のみ**・public release pack には含めない）
- alpha.5.11 workbook は **破壊しない**（別ファイル `alpha5_12_reviewer_decision_workbook.xlsx` として出力）
- alpha.5.10 gate / alpha.5.9 packet も破壊しない

## alpha.5.11 → alpha.5.12 拡張点

| 項目 | alpha.5.11 | alpha.5.12 |
|---|---|---|
| Decision_Input_All の列数 | 14列 | **21列** (拡張7列追加) |
| Needs_Legal_Review の列数 | 14列 | **16列** (legal_review_clearance / reference / note 追加) |
| Valid_Values のカテゴリ数 | 3 (decision/impl/role) | **6** (上記 + legal_clearance/priority/risk_ack) |
| export CSV のスキーマ | legacy 9列 | extended 16列 (auto detect) |
| alpha.5.10 gate | 9列専用 | **拡張16列も読める** (後方互換) |
| legal cleared 判定 | なし (滞留) | **あり** (clearance=cleared で approved 候補へ) |
| 高リスク decision | implementation_risk フラグなし | **risk_ack=yes 必須** (なければ blocked) |

## 不変条件 (テストで保護)

- ❌ master JSON 自動修正なし
- ❌ 新規 checked 昇格なし
- ❌ R8.6 案資料は checked 昇格に使わない
- ❌ public release pack は本 alpha.5.12 で更新しない
- ❌ alpha.5.9 packet / alpha.5.10 gate / alpha.5.11 workbook は破壊しない
- ❌ 過剰な完了感を与える表現は使わない（disclaimer 維持）
- ❌ reviewer 入力ファイルを public に出さない

## 含まれるファイル

| ファイル | 内容 |
|---|---|
| `README.md` | 本ファイル |
| `alpha5_12_reviewer_decision_workbook.xlsx` | 8シート構成のレビュー用ブック (alpha.5.12版) |
| `sample_reviewed_decisions.csv` | 12シナリオの sample fixture (extended 16列) |
| `sample_reviewed_decision_validation_report.md` | sample に対する gate の検証レポート |
| `sample_approved_changes_preview.csv` | sample に対する gate の approved 結果 |
| `sample_blocked_or_incomplete_decisions.csv` | sample に対する gate の blocked 結果 |
| `sample_pending_decisions.csv` | sample に対する gate の pending 結果 |
| `sample_legal_review_required.csv` | sample に対する gate の legal_review_required 結果 |
| `legal_clearance_rules.md` | legal_review_clearance のルール詳細 |
| `alpha5_12_reviewer_workflow_hardening_manifest.json` | パケットメタデータ |

## sample_reviewed_decisions.csv のシナリオ

| # | service | kasan_key | scenario | 想定 bucket |
|---|---|---|---|---|
| 1 | tsusho_kaigo | chujudosha_care_taisei | add_receipt_alias + impl=yes | approved |
| 2 | tsusho_kaigo | nyuyoku_II | approve_official_code_addition + impl=yes | approved |
| 3 | tsusho_kaigo | koukuu_kinou_I | INVALID_DECISION | blocked |
| 4 | tsusho_kaigo | eiyou_kaizen | impl=yes 必須欠落 | blocked |
| 5 | houmon_kaigo | shokai_kasan | correct_internal_legacy_code + risk_ack=no | blocked |
| 6 | houmon_kaigo | seikatsu_kinou_renkei_I | 完全空欄 | pending |
| 7 | houmon_kaigo | seikatsu_kinou_renkei_II | impl=pending | pending |
| 8 | houmon_kango_kaigo | fukusu_mei_houmon_kango_kasan_I_under30 | clearance=pending | legal_review_required |
| 9 | houmon_kango_kaigo | fukusu_mei_houmon_kango_kasan_I_over30 | clearance 空欄 | legal_review_required |
| 10 | houmon_kango_kaigo | fukusu_mei_houmon_kango_kasan_II_under30 | clearance=cleared + 全揃い | **approved (legal cleared)** |
| 11 | houmon_kaigo | shougu_kaizen_kasan | future_candidate に approve | blocked |
| 12 | kyotaku_shien | shougu_kaizen_kasan_2026_06 | future_candidate に defer | pending |

## sample に対する gate 結果

| バケット | 件数 |
|---|---:|
| approved | 3 |
| blocked | 4 |
| pending | 3 |
| legal_review_required | 2 |
| **合計** | **12** |

## 再生成方法

```
cd products/kasan-manager
python scripts/generate_alpha5_12_reviewer_workflow_hardening.py
```

## reviewer 後の運用フロー（alpha.5.12 版）

1. reviewer が alpha5_12_reviewer_decision_workbook.xlsx を開く
2. Decision_Input_All シートで 38 行を埋める（拡張列含む）
3. needs_legal_review 5件は法令確認者が legal_review_clearance を埋める
4. 高リスク decision (correct_internal_legacy_code) は implementation_risk_acknowledged=yes を付ける
5. 保存後にターミナル: `python scripts/export_alpha5_11_workbook_decisions.py --workbook .../alpha5_12_reviewer_decision_workbook.xlsx --output .../reviewer_decision_export.csv`
6. ゲート再実行: `python scripts/generate_alpha5_10_reviewer_decision_gate.py --input .../reviewer_decision_export.csv --output .../alpha5_10_reviewer_decision_gate_from_alpha5_12_workbook/`
7. blocked / pending / legal_review_required を解消するまで 2〜6 を繰り返す
8. **alpha.5.13+ で別途 PR を立て、approved 行のみを段階的に master JSON へ反映**
