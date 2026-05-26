# alpha.5.7.1 Source Registry Anchor Hotfix Report

**監査日**: 2026-05-10
**監査者**: alpha.5.7.1 audit (CareLinker)

---

## 0. 修正前の問題

alpha.5.7 で以下の誤りがあった:

- `WAM_R7_4_DEFINITIVE_2025_02_01` を **current_definitive** として扱っていた
- 実際にはこの 2025-02-01 PDF は **「介護保険事務処理システム変更に係る参考資料（その2）（令和7年2月3日事務連絡）」** という案・予備版ページ配下の資料
- PDFタイトル本体には「案」表記がないが、**親WAM NETページ名に「（その2）」（案・予備版）が明記されている**
- 真の R7.4 確定版は **「介護保険事務処理システム変更に係る参考資料（確定版）（令和7年3月28日事務連絡）」** 配下の `20250328_005.pdf`
- 同様に R7.8 確定版は同じ確定版ページ配下の `20250328_006.pdf`
- R8.6.1 案資料は **「介護保険事務処理システム変更に係る参考資料（その2）（令和8年4月20日事務連絡）」** 配下の `20260416_004.pdf`

---

## 1. 修正前後の Source Registry 一覧

### 修正前 (alpha.5.7)

| source_id | source_kind | revision_status |
|---|---|---|
| WAM_R6_4_PROVISIONAL_2024_03_18 | provisional | provisional_historical |
| WAM_R6_6_8_DEFINITIVE_2024_05_07 | definitive | historical_definitive |
| **WAM_R7_4_DEFINITIVE_2025_02_01** ❌誤判定 | definitive | current_definitive |
| WAM_R8_6_PROVISIONAL_PLACEHOLDER (URL未取得) | provisional | provisional_future |

### 修正後 (alpha.5.7.1)

| source_id | source_kind | revision_status |
|---|---|---|
| WAM_R6_4_PROVISIONAL_2024_03_18 | provisional | provisional_historical |
| WAM_R6_6_8_DEFINITIVE_2024_05_07 | definitive | historical_definitive |
| **WAM_R7_4_PROVISIONAL_2025_02_01** ⬇降格 | provisional | provisional_historical |
| **WAM_R7_4_DEFINITIVE_2025_03_28** ⬆新規追加 | definitive | **current_definitive** |
| **WAM_R7_8_DEFINITIVE_2025_03_28** ⬆新規追加 | definitive | current_or_future_definitive |
| **WAM_R8_6_8_PROVISIONAL_2026_04_20** ⬆実URL登録 | provisional | provisional_future |

---

## 2. 2025-02-01 資料の扱い

| 項目 | 内容 |
|---|---|
| source_id (新) | WAM_R7_4_PROVISIONAL_2025_02_01 |
| source_kind | **provisional**（降格） |
| revision_status | provisional_historical |
| URL | https://www.wam.go.jp/gyoseiShiryou-files/documents/2025/0130170719328/20250201_006.pdf |
| 親ページ | 介護保険事務処理システム変更に係る参考資料（**その2**）（令和7年2月3日事務連絡） |
| 判定根拠 | 親ページ名に「（その2）」（案・予備版）明記 |
| 用途 | checked 昇格には使用しない（参考履歴として保持） |

---

## 3. R7.4 確定版（current_definitive）の登録内容

| 項目 | 内容 |
|---|---|
| source_id | **WAM_R7_4_DEFINITIVE_2025_03_28** |
| source_kind | **definitive** |
| revision_status | **current_definitive** |
| URL | https://www.wam.go.jp/gyoseiShiryou-files/documents/2025/0325232823856/20250328_005.pdf |
| 親ページ | 介護保険事務処理システム変更に係る参考資料（**確定版**）（令和7年3月28日事務連絡） |
| document_version | R7.4.1 確定版 |
| effective_from | 2025-04-01 |
| effective_to | 2025-07-31 |
| applies_to_services | tsusho_kaigo / houmon_kaigo / kyotaku_shien / houmon_kango_kaigo |
| 判定根拠 | 親ページに「確定版」明記、リンクラベル「②介護サービス（R7.4.1）」（案表記なし） |

---

## 4. R7.8 確定版の登録内容

| 項目 | 内容 |
|---|---|
| source_id | **WAM_R7_8_DEFINITIVE_2025_03_28** |
| source_kind | definitive |
| revision_status | current_or_future_definitive |
| URL | https://www.wam.go.jp/gyoseiShiryou-files/documents/2025/0325232829413/20250328_006.pdf |
| document_version | R7.8.1 確定版 |
| effective_from | 2025-08-01 |
| effective_to | 2026-05-31 |
| 判定根拠 | 親ページ「確定版」、リンクラベル「②介護サービス（R7.8.1）」（案表記なし） |

---

## 5. R8.6.1 案資料の登録内容

| 項目 | 内容 |
|---|---|
| source_id | **WAM_R8_6_8_PROVISIONAL_2026_04_20** |
| source_kind | **provisional** |
| revision_status | **provisional_future** |
| URL | https://www.wam.go.jp/gyoseiShiryou-files/documents/2026/0414224940739/20260416_004.pdf |
| 親ページ | 介護保険事務処理システム変更に係る参考資料（**その2**）（令和8年4月20日事務連絡） |
| document_version | R8.6.1 / R8.8.1（案） |
| effective_from | 2026-06-01 |
| 判定根拠 | 親ページ「（その2）」、リンクラベル「②介護サービス（R8.6.1）（案）（新規資料）」 |
| 用途 | **checked 昇格には絶対に使用しない**。future_candidate / provisional_future として audit に記録するに留める |

---

## 6. checked 20件の再検証結果

### 検証方法
1. 旧 PDF (2025-02-01) と 新 PDF (2025-03-28) の内容を比較
2. **訪問看護加算 21コード行**: 全件一致（diff=0）
3. **通所介護加算 29コード行**: 全件一致（diff=0）

### 検証結果サマリ

| サービス | alpha.5.7 checked | alpha.5.7.1 検証後 | 変化 |
|---|---:|---|---|
| 訪問看護（介護保険） | 14件 | **14件 keep_checked** | 無変化（PDF同一） |
| 通所介護 | 6件 | **6件 keep_checked** | 無変化（PDF同一） |
| 訪問介護 | 0件 | 0件 (pattern_unverified) | 無変化 |
| 居宅介護支援 | 0件 | 0件 (pattern_unverified) | 無変化 |
| **計** | **20件** | **20件** | 無変化 |

### checked維持一覧（全20件）

**訪問看護（介護保険）— 14件 keep_checked**:
- alpha.5.6 維持 8件: tokubetsu_kanri_kasan_I/II, kango_taisei_kyouka_kasan_I/II, service_taisei_kyouka_kasan_I/II, taiin_kyoudou_shidou_kasan, kango_kaigo_renkei_kyouka_kasan
- alpha.5.6 promoted 5件: kinkyu_houmon_kango_kasan_I/II, terminal_care_kasan, shokai_kasan_I/II
- alpha.5.6 newly_checked 1件: koukuu_renkei_kyouka_kasan

**通所介護 — 6件 keep_checked**:
- kobetsu_kinou_I_i (155051), kobetsu_kinou_I_ro (155053), kobetsu_kinou_II_life (155052), nyuyoku_I (155301), eiyou_assessment (156116), kagakuteki_kaigo (156361)

### downgraded / needs_review 一覧

該当なし（PDF同一で差分0）

### pattern_based_unverified 維持一覧

- 訪問看護: 7件（科学的介護推進・R8.6処遇改善・複数名×4・長時間）
- 通所介護: 7件（code_mismatch 6 + not_found 1）
- 訪問介護: 13件（code_mismatch 7 + not_found 6）
- 居宅介護支援: 18件（code_mismatch 16 + not_found 2）

---

## 7. source_kind 判定ルール強化

`regulatory_master/sources/kaigo_service_code_sources.json` の `_meta.source_kind_determination_rules` に以下を明記:

1. PDFタイトルに「案」がある場合は provisional
2. **PDFタイトルに「案」がなくても、親WAM NET detailページのタイトル・資料見出し・リンクラベルに「案」がある場合は provisional**
3. 親ページが「（その2）」「（その3）」など案・予備版の名称の場合も provisional
4. 親ページが「確定版」明記でかつ資料見出し・リンクラベルに「案」がない場合のみ definitive 候補
5. definitive でも effective_from / effective_to / document_version を必ず持たせる
6. source_kind=provisional の資料だけで checked に昇格してはいけない

---

## 8. サービス別 mapping_status 集計（変化なし）

| サービス | checked | not_applicable | pattern_unverified | 計 |
|---|---:|---:|---:|---:|
| houmon_kango_kaigo | **14** | 1 | 7 | 22 |
| tsusho_kaigo | **6** | 0 | 7 | 13 |
| houmon_kaigo | 0 | 0 | 13 | 13 |
| kyotaku_shien | 0 | 0 | 18 | 18 |
| **合計** | **20** | 1 | 45 | 66 |

alpha.5.7 比 ±0（hotfix のため件数変化なし、source anchor 整合のみ）

---

## 9. 学び（lessons learned）

1. **PDF タイトルだけで source_kind を判定しない** — 親WAM NETページの状態（確定版/その2/その3）も確認する必要がある
2. **同一PDF が異なる親ページから配布される可能性** — 2025-02-01版（その2）と 2025-03-28版（確定版）は内容同一だが status は異なる
3. **source registry の親ページタイトル記録が重要** — `parent_page_title` フィールドで判定根拠をトレース可能にした
4. **PDF間の content diff 確認の自動化** — 今回は手動比較で同一を確認したが、将来的には自動化ツールが必要

---

## 10. 未解決リスク

- **R7.8 確定版の content 確認**: registry には登録したが、PDF実体の検証は alpha.5.7.1 では未実施。次バッチで R7.4 vs R7.8 差分確認
- **R8.6 案資料の content 取得**: URL 登録済だが PDF実体の確認は未実施。取得しても source_kind=provisional 維持
- **訪問介護・居宅介護支援の社内コード体系**: alpha.5.7 で発覚した不整合（合計 31加算 code_mismatch + not_found）はそのまま。マスタ訂正は alpha.5.8+ で別途レビュー後

---

_本レポートは社内 audit 用。public release pack には含めない。_
