# alpha.5.9 Divergent Mapping Review

**version**: alpha.5.9
**base_commit**: `2f5245e9b2cba759e1aec7d0c47e6041ae512e81`
**generated_at**: 2026-05-10

---

## 1. divergent とは

`keep_pattern_based_unverified` proposed_action だが `overall_mapping_status=needs_review` になっている **3件** の加算。

`proposed_action` と `overall_mapping_status` は **異なる目的** で生成されているため、`internal_codes` が空かつ `official_code_status=needs_review` の場合に divergent が発生する:

- **overall_mapping_status**: 外部表示用ラベル。`official_code_status` の機械的反映
- **proposed_action**: 社内が「何をすべきか」の運用ラベル。`internal_codes` 非空時のみ `needs_master_review` に流れ、空なら `keep_pattern_based_unverified` に流れる

詳細は [`alpha5_8_1_source_metadata_hotfix_report.md`](../alpha5_8_1_source_metadata_hotfix_report.md) §5-6 参照。

## 2. divergent 3件の内訳

### 訪問看護(介護) `shougu_kaizen_kasan_2026_06`

- 表示名: 介護職員等処遇改善加算（2026年6月臨時改定・訪問看護新規対象）
- proposed_action: `keep_pattern_based_unverified`
- overall_mapping_status: `needs_review`
- divergence_reason: official_match_type=out_of_definitive_scope (R7.8確定版に未収録) のため official_code_status=needs_review。一方、service_codes が空なので proposed_action 判定では keep_pattern_based_unverified（needs_master_review は internal_codes 非空が条件）に流れる。R8.6.1案は確定版ではないため checked 昇格には使わない。
- overall_status_basis: official_code_status (=needs_review)
- proposed_action_basis: internal_codes is empty → keep_pattern_based_unverified

**人間が確認すべきこと**:
1. この divergence は machine-counted で正しい状態か（**alpha.5.8.1 で audit_note 化済 → YES**）
2. 社内マスタにコードを追加すべきか（`internal_codes` を埋めるかどうか）
3. 公式コード（official_service_code）が **本当に存在しないか**、別表に移動した可能性はないか
4. R8.6.1 確定版で対応公式コードが追加された場合、`needs_master_review` 経由で `checked` 昇格できるか

**この段階ではマスタ修正しない**: divergence 自体は正しく記録されており、本packet では reviewer 判断のための情報提示のみ行う。
### 通所介護 `adl_iji`

- 表示名: ADL維持等加算
- proposed_action: `keep_pattern_based_unverified`
- overall_mapping_status: `needs_review`
- divergence_reason: official_code_status=needs_review (公式コード 156338 と社内 service_codes 空のため code_mismatch 相当)。一方 service_codes が空なので proposed_action は needs_master_review ではなく keep_pattern_based_unverified に流れる。社内マスタへのコード追加レビューが先決。
- overall_status_basis: official_code_status (=needs_review)
- proposed_action_basis: internal_codes is empty → keep_pattern_based_unverified

**人間が確認すべきこと**:
1. この divergence は machine-counted で正しい状態か（**alpha.5.8.1 で audit_note 化済 → YES**）
2. 社内マスタにコードを追加すべきか（`internal_codes` を埋めるかどうか）
3. 公式コード（official_service_code）が **本当に存在しないか**、別表に移動した可能性はないか
4. R8.6.1 確定版で対応公式コードが追加された場合、`needs_master_review` 経由で `checked` 昇格できるか

**この段階ではマスタ修正しない**: divergence 自体は正しく記録されており、本packet では reviewer 判断のための情報提示のみ行う。
### 通所介護 `ninchi_kasan`

- 表示名: 認知症加算
- proposed_action: `keep_pattern_based_unverified`
- overall_mapping_status: `needs_review`
- divergence_reason: official_code_status=needs_review (公式コード 155305 と社内 service_codes 空のため code_mismatch 相当)。service_codes が空なので proposed_action は needs_master_review ではなく keep_pattern_based_unverified に流れる。社内マスタへのコード追加レビューが先決。
- overall_status_basis: official_code_status (=needs_review)
- proposed_action_basis: internal_codes is empty → keep_pattern_based_unverified

**人間が確認すべきこと**:
1. この divergence は machine-counted で正しい状態か（**alpha.5.8.1 で audit_note 化済 → YES**）
2. 社内マスタにコードを追加すべきか（`internal_codes` を埋めるかどうか）
3. 公式コード（official_service_code）が **本当に存在しないか**、別表に移動した可能性はないか
4. R8.6.1 確定版で対応公式コードが追加された場合、`needs_master_review` 経由で `checked` 昇格できるか

**この段階ではマスタ修正しない**: divergence 自体は正しく記録されており、本packet では reviewer 判断のための情報提示のみ行う。


## 3. レビュアーへのお願い

- **マスタ修正は本packet 段階では行わない**。reviewer 決定を `reviewer_decision_template.csv` に記録するに留める
- divergence の事実を「業務データの不整合」と誤読しないこと（alpha.5.8.1 で正しく documentation 済）
- R8.6.1 確定版が出た場合、訪看 `shougu_kaizen_kasan_2026_06` は再評価対象（`future_candidate_review.md` も参照）
