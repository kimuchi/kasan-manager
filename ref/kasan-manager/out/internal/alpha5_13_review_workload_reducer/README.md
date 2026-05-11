# alpha.5.13 Review Workload Reducer

**version**: alpha.5.13
**base_commit**: `228897a415aa8b2ff9a0d0a0b96723901a995266` (alpha.5.12 kimura cio handoff)
**generated_at**: 2026-05-10

---

## 目的

alpha.5.12 までで木村CIO ハンドオフパックを揃えましたが、38 件全件を一括レビュー
依頼するのは負荷が高すぎるため、本パケットで **初回バッチを 8 件に絞り込み**、
残りを **安全に defer / legal / future_candidate へ振り分け** ました。

- CIO が 30 分で判断できる brief あり
- 初回バッチ 8 件のみで業務担当の作業時間を最小化
- 法令確認者は初回対象外（後続フェーズ）
- 残り 30 件は明示的に defer

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
| `FIRST_REVIEW_BATCH.csv` | 初回バッチ 8 件 (9 列) |
| `REVIEW_WORKLOAD_BY_ROLE.md` | 役割別の想定作業時間 |
| `SAFE_DEFAULT_DECISIONS.md` | safe default decisions の整理 |
| `DEFERRED_ITEMS.md` | defer したアイテムの分類と再評価条件 |
| `alpha5_13_review_workload_reducer_manifest.json` | パケットメタデータ |

## 数字サマリ

| カテゴリ | 件数 |
|---|---:|
| 全レビュー対象 | 38 |
| **初回バッチ** | **8** |
| 後続バッチ候補 (medium risk / 単位不一致 / not_found) | 1 |
| 同じパターンの後続代表 (per_service_cap_exceeded) | 19 |
| divergent (記録のみ) | 3 |
| needs_legal_review (法令確認者へ) | 5 |
| future_candidate_only (R8.6.1 待ち) | 2 |

## CIO がやること（30 分・4 つ）

1. `CIO_30MIN_DECISION_BRIEF.md` を読む
2. reviewer 4 名（business / legal / final_approver × 2 / developer）を決める
3. 初回バッチ 8 件のみで進めることを承認
4. business_reviewer に `FIRST_REVIEW_BATCH.csv` を渡す

## 再生成方法

```
cd products/kasan-manager
python scripts/generate_alpha5_13_review_workload_reducer.py
```

idempotent: master JSON が変わらない限り同じ packet が出力される。

---

_本パケットは内部レビュー用。public release pack には含めない。_
