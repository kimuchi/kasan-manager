# alpha.5.9 Future Candidate Review

**version**: alpha.5.9
**base_commit**: `2f5245e9b2cba759e1aec7d0c47e6041ae512e81`
**generated_at**: 2026-05-10

---

## 1. R8.6 案資料の扱い

- `WAM_R8_6_8_PROVISIONAL_2026_04_30` は **「その3」（令和8年4月30日事務連絡）** の案資料です（`provisional_future`）
- PDF実体は WAM_R8_6_8_PROVISIONAL_2026_04_20 と同一（20260416_004.pdf）
- PDF表紙に「（案）」表記あり（alpha.5.8.1 で `pdfplumber` 実体確認済）
- **R8.6 案資料は checked 昇格に絶対使わない** (`checked_promotion_allowed: false`)
- 二重防御:
  1. registry の `source_kind=provisional` で `resolve_current_source_for_date` から除外
  2. `checked_promotion_allowed=false` で重ねて除外（alpha.5.8.1 追加）

## 2. future_candidate_only 2件

### 訪問介護 `shougu_kaizen_kasan`

- 表示名: 介護職員処遇改善加算
- proposed_action: `future_candidate_only`
- overall_mapping_status: `pattern_based_unverified`
- audit_note: R7.4確定版に対応コードを抽出できなかった（alpha.5.7時点で要追加調査）
- 対象施行: 2026-06-01〜（R8.6.1 / R8.8.1 案）
### 居宅介護支援 `shougu_kaizen_kasan_2026_06`

- 表示名: 処遇改善加算（2026年6月臨時改定・新規対象）
- proposed_action: `future_candidate_only`
- overall_mapping_status: `pattern_based_unverified`
- audit_note: R7.4確定版に対応コードを抽出できなかった（alpha.5.7時点で要追加調査）
- 対象施行: 2026-06-01〜（R8.6.1 / R8.8.1 案）


## 3. R8.6 確定版が出た場合の確認手順案

確定版（おそらく令和8年5月下旬〜6月初頭）が出たら、以下の流れで処理する想定:

1. WAM NET の最新「確定版（令和8年X月X日事務連絡）」ページを開き、新規 source_id を採番
2. PDF実体を `pdfplumber` で取得し、表紙に「（案）」が **無い** ことを確認
3. `regulatory_master/sources/kaigo_service_code_sources.json` に新 source を追加
   - source_kind: `definitive` / revision_status: `current_definitive`
   - effective_from: 2026-06-01 / effective_to: null
4. `WAM_R8_6_8_PROVISIONAL_2026_04_30` と `_2026_04_20` を `historical_definitive` または削除候補に降格
5. `target_period_resolution_rules` の 2026-06-01〜 を新 source_id に変更
6. future_candidate_only 2件を再 audit して `needs_master_review` または `checked` 候補に再分類
7. 訪看 divergent の `shougu_kaizen_kasan_2026_06` も再評価
8. 4 master JSON を再生成 + 全テスト + 4サービスPDF回帰

## 4. 2026-06-01以降の運用リスク

R8.6.1 確定版が出るまでの期間:

- `resolve_current_source_for_date(svc, "2026-06-01")` は **None を返す**
- `target_period_resolution_rules` でも `current_source_id: null` 明示
- 報告レポート上では当該期間の加算は `pattern_based_unverified` または `needs_review` のまま表示
- 「令和8年6月改定への対応が完了した」と読める過剰表現は禁止（disclaimer 維持）

## 5. レビュアーへのお願い

- **R8.6 案を checked 昇格に使う判断は絶対に承認しない**
- 確定版が出るまで future_candidate_only 2件の `reviewer_decision` は `defer_until_r8_definitive` のままで良い
- WAM NET の新規ページ（gno=22524 以降）を定期的に確認
