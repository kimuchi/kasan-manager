# alpha.5.9 Master Review Packet

**version**: alpha.5.9
**base_commit**: `2f5245e9b2cba759e1aec7d0c47e6041ae512e81` (alpha.5.8.1 source_metadata_hotfix)
**generated_at**: 2026-05-10

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
| needs_master_review | 28 | 社内コードと公式コードの不一致・マスタ訂正レビュー対象 |
| needs_legal_review | 5 | 基本コードへの追加加算構造・法令解釈確認対象 |
| divergent (keep_pattern_based_unverified ∧ overall=needs_review) | 3 | proposed_action と overall_mapping_status の divergent 3件 |
| future_candidate_only | 2 | R8.6 確定版が出るまで保留 |
| keep_checked (参考) | 20 | 既に checked 化済（本packet では再レビュー不要）|

合計 reviewer タッチ対象: needs_master_review + needs_legal_review + divergent + future_candidate_only
= 38 件

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
