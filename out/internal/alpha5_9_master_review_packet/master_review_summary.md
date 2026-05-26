# alpha.5.9 Master Review Summary

**version**: alpha.5.9
**base_commit**: `2f5245e9b2cba759e1aec7d0c47e6041ae512e81`
**generated_at**: 2026-05-10

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

### needs_master_review (合計 28 件)

| サービス | 件数 |
|---|---:|
| 訪問看護(介護) | 1 |
| 通所介護 | 4 |
| 訪問介護 | 7 |
| 居宅介護支援 | 16 |

### needs_legal_review (合計 5 件)

| サービス | 件数 |
|---|---:|
| 訪問看護(介護) | 5 |
| 通所介護 | 0 |
| 訪問介護 | 0 |
| 居宅介護支援 | 0 |

### divergent (proposed=keep_pattern_based_unverified ∧ overall=needs_review): 3 件
### future_candidate_only: 2 件

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
