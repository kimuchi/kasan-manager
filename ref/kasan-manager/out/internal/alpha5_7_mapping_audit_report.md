# alpha.5.7 service_code_mapping_status 監査レポート

**監査日**: 2026-05-10
**監査者**: alpha.5.7 audit (CareLinker)

---

## 0. 経緯と主要発見

### Source registry 導入

alpha.5.5 で「案」資料を誤って正本扱いした失敗を踏まえ、alpha.5.7 で **公式資料の source versioning** を導入:
- `regulatory_master/sources/kaigo_service_code_sources.json` を新設
- 各 source に `source_kind` (definitive/provisional/draft/unknown) と `revision_status` (current_definitive/historical_definitive/provisional_future/draft/unknown) を付与
- 各加算の `service_code_audit` から `source_id` で参照

### R7.4 確定版を取得

- WAM NET 介護給付費単位数等サービスコード表（**令和7年4月施行版**・2025-02-01版）
- URL: https://www.wam.go.jp/gyoseiShiryou-files/documents/2025/0130170719328/20250201_006.pdf
- 表紙に「案」表示なし → **definitive**
- revision_status: **current_definitive**（2026年5月現在の最新確定版）
- 全406ページ・4サービス全カバー

### 残り3サービスの大規模不整合発見

社内マスタの `service_codes` フィールドは **R7.4 確定版コード体系と大きく異なる**:

| サービス | exact_match | code_mismatch | not_found | 比率 |
|---|---:|---:|---:|---|
| 通所介護 | **6** | 6 | 1 | 46% |
| 訪問介護 | 0 | 7 | 6 | 0% |
| 居宅介護支援 | 0 | 16 | 2 | 0% |

通所介護のみ部分整合。訪問介護・居宅介護支援は**社内コード体系全体が公式と異なる**。

---

## 1. Source Registry 内容

| source_id | source_kind | revision_status | 期間 |
|---|---|---|---|
| WAM_R6_4_PROVISIONAL_2024_03_18 | provisional | provisional_historical | 2024-04 to 2024-05 |
| WAM_R6_6_8_DEFINITIVE_2024_05_07 | definitive | historical_definitive | 2024-06 to 2025-03 |
| **WAM_R7_4_DEFINITIVE_2025_02_01** | **definitive** | **current_definitive** | **2025-04 to 2026-05** |
| WAM_R8_6_PROVISIONAL_PLACEHOLDER | provisional | provisional_future | 2026-06 〜 (URL未取得) |

---

## 2. 訪問看護（介護保険）— alpha.5.6 14 checked の R7.4 再確認結果

R7.4 確定版 (p109-129) で訪問看護加算を抽出した結果、**21コード全件が R6.6/8 と R7.4 で同一**。

| 加算 | R6.6/8 確定版 | R7.4 確定版 | 判定 |
|---|---|---|---|
| 緊急時Ⅰ１ | 13 3001 600u | 13 3001 600u | no_diff |
| 緊急時Ⅱ１ | 13 3100 574u | 13 3100 574u | no_diff |
| 特別管理Ⅰ/Ⅱ | 13 4000/4001 500/250u | 同上 | no_diff |
| 看護体制Ⅰ/Ⅱ | 13 4010/4005 550/200u | 同上 | no_diff |
| サ提体強Ⅰ/Ⅱ | 13 6103/6101 6/3u | 同上 | no_diff |
| ターミナルケア | 13 7000 2,500u | 同上 | no_diff |
| 初回Ⅰ/Ⅱ | 13 4023/4002 350/300u | 同上 | no_diff |
| 退院時共同 | 13 4003 600u | 同上 | no_diff |
| 看護介護連携 | 13 4004 250u | 同上 | no_diff |
| 口腔連携 | 13 6192 50u | 同上 | no_diff |

**結論**: alpha.5.6 で checked 化した **14件全件 keep_checked**。`source_id` を `WAM_R6_6_8_DEFINITIVE_2024_05_07` のまま、`alpha_5_7_r7_4_reconfirm` で R7.4 でも整合確認した記録を追加。

---

## 3. 通所介護 — alpha.5.7 R7.4 照合結果

### 3-1. exact_match → checked（6加算）

| kasan_key | 社内コード | R7.4 公式コード | 単位 | 判定 |
|---|---|---|---:|---|
| kobetsu_kinou_I_i | 155051 | 155051 | 56 | **checked** |
| kobetsu_kinou_I_ro | 155053 | 155053 | 76 | **checked** |
| kobetsu_kinou_II_life | 155052 | 155052 | 20 | **checked** |
| nyuyoku_I | 155301 | 155301 | 40 | **checked** |
| eiyou_assessment | 156116 | 156116 | 50 | **checked** |
| kagakuteki_kaigo | 156361 | 156361 | 40 | **checked** |

### 3-2. code_mismatch（6加算）

| kasan_key | 社内コード | R7.4 公式 | 単位 | 不整合内容 |
|---|---|---|---:|---|
| nyuyoku_II | 155302 | 155303 | 55 | コード末尾差 |
| chujudosha_care_taisei | 156271 | 155306 | 45 | コード差 |
| ninchi_kasan | 156274 | 155305 | 60 | コード差 |
| adl_iji | 156275 | 156338 | 30 | コード差 |
| koukuu_kinou_I | 155501 | 155606 | 150 | コード差・**単位 50→150** |
| eiyou_kaizen | 156112 | 155605 | 200 | コード差 |

### 3-3. not_found（1加算）

| kasan_key | 詳細 |
|---|---|
| 確認用 | R7.4 確定版で対応コードを抽出できず（要追加調査） |

---

## 4. 訪問介護 — alpha.5.7 R7.4 照合結果

### 4-1. checked（0加算）

該当なし。社内コード体系（116XXX）と公式コード体系（114XXX/116192）が大きく異なる。

### 4-2. code_mismatch（7加算）

| kasan_key | 社内コード | R7.4 公式 | 単位 | 不整合内容 |
|---|---|---|---:|---|
| shokai_kasan | 116200 | 114001 | 200 | コード差 |
| seikatsu_kinou_renkei_I | 116301 | 114003 | 100 | コード差 |
| seikatsu_kinou_renkei_II | 116302 | 114002 | 200 | コード差 |
| ninchi_senmon_care_I | 116401 | 114004 | 3 | コード差 |
| ninchi_senmon_care_II | 116402 | 114005 | 4 | コード差 |
| kinkyu_houmon | 116500 | 114000 | 100 | コード差 |
| koukuu_renkei_kyouka | 116600 | 116192 | 50 | コード差（166192→116192 接近） |

### 4-3. not_found（6加算）

特定事業所加算 Ⅰ-Ⅴ + 処遇改善加算 — R7.4 では別構造で扱われている可能性。要追加調査。

---

## 5. 居宅介護支援 — alpha.5.7 R7.4 照合結果

### 5-1. checked（0加算）

該当なし。社内コード体系（438XXX）と公式コード体系（434XXX/436XXX）が完全に異なる。

### 5-2. code_mismatch（16加算）

社内 `438XXX` 系 vs 公式 `434XXX`（特定事業所・初回・医療介護連携）/ `436XXX`（入院時連携・退院退所・通院・緊急・ターミナル）系。詳細は各加算の audit に記録。

### 5-3. not_found（2加算）

| kasan_key | 詳細 |
|---|---|
| kyotaku_shien_I | 居宅介護支援費(I)— 基本サービスで別管理 |
| kyotaku_shien_II | 居宅介護支援費(II)— 基本サービスで別管理 |

---

## 6. checked 維持・昇格・残置の集計

### 維持（keep_checked）
- 訪問看護 14加算（alpha.5.6 で checked 化、R7.4 でも整合確認）

### 昇格（promoted_in_alpha_5_7）
- 通所介護 6加算（exact_match）

### pattern_based_unverified 維持
- 通所介護 7加算（code_mismatch 6 + not_found 1）
- 訪問介護 13加算（code_mismatch 7 + not_found 6）
- 居宅介護支援 18加算（code_mismatch 16 + not_found 2）
- 訪問看護 7加算（structural_mismatch 5 + not_found 1 + out_of_scope 1）

### not_applicable 維持
- 訪問看護 1加算（認知症専門ケア）

---

## 7. R8.6 案資料の扱い

- WAM_R8_6_PROVISIONAL_PLACEHOLDER として registry に登録
- source_kind: provisional / revision_status: provisional_future
- URL は alpha.5.7 時点で未取得
- **checked 昇格には絶対に使用しない**
- 取得後も future_candidate として audit に記録するに留める
- 令和8年6月臨時改定（処遇改善加算 訪問看護新規対象・1.8%）に該当する加算は `out_of_definitive_scope` で `pattern_based_unverified`

---

## 8. 学び（lessons learned）

1. **「案」資料を definitive 扱いしない** — alpha.5.5 の失敗を繰り返さない仕組みとして source_kind 管理を導入
2. **社内コード体系の見直しは alpha.5.8+ で実施** — 訪問介護・居宅介護支援の社内コードは公式コードと完全に異なる。マスタ訂正には法令解釈レビューが必要
3. **通所介護は部分整合**（46%）— 社内マスタの一部加算は公式と整合していたため、6加算は alpha.5.7 で checked 化
4. **訪問看護は alpha.5.6 と R7.4 で同一** — 14加算 checked を維持し、R7.4 reconfirm を audit に記録
5. **R8.6 案を future_candidate** として隔離 — provisional_future ステータスで、checked 昇格対象から除外

---

## 9. 未解決リスク

- **訪問介護・居宅介護支援の社内コード体系訂正**: 全加算が公式と不整合。社内マスタの service_codes フィールドの根本見直しが必要（alpha.5.8+）
- **通所介護 not_found 1加算**: R7.4 で対応コードを抽出できなかった加算の特定が必要
- **R8.6 案資料の取得**: 令和8年6月臨時改定の公式案資料を別途取得して provisional_future として記録
- **訪問看護 7 加算**: 専門管理1/2、遠隔死亡診断補助加算は確定版で発見されたが社内マスタ未登録（needs_master_addition）

---

_本レポートは社内 audit 用。public release pack には含めない。_
