# alpha.5.6 service_code_mapping_status 監査レポート

**監査日**: 2026-05-09
**監査者**: alpha.5.6 audit (CareLinker)

---

## 0. 経緯と主要発見

### alpha.5.5 で発生した重大な誤判定

alpha.5.5 で根拠とした WAM NET PDF (2024-03-18版) は、表題に **「介護給付費単位数等サービスコード表（案）」** と明記された **「案」（provisional・draft）資料** だった。

確定版（2024-05-07・令和6.6.1/8月施行版・「案」表示なし）と再照合したところ、alpha.5.5 で「不整合」と判定した5加算は、**確定版では全て社内マスタと整合**していた。社内マスタは正しく、案版が古い情報だっただけ。

### Source kind 分類

| 分類 | 該当 |
|---|---|
| `definitive` | WAM NET 介護給付費単位数等サービスコード表（令和6年6月・8月施行版・2024-05-07版） |
| `provisional` | WAM NET 介護給付費単位数等サービスコード表（案）（令和6年4月施行版・2024-03-18版） |
| `draft` | （該当なし） |
| `unknown` | （該当なし） |

---

## 1. alpha.5.5 checked 8件の再検証結果

| kasan_key | alpha.5.5判定 | alpha.5.6再検証 | match_type |
|---|---|---|---|
| tokubetsu_kanri_kasan_I | checked (provisional) | **keep_checked (definitive)** | exact_match |
| tokubetsu_kanri_kasan_II | checked (provisional) | **keep_checked (definitive)** | exact_match |
| kango_taisei_kyouka_kasan_I | checked (provisional) | **keep_checked (definitive)** | exact_match |
| kango_taisei_kyouka_kasan_II | checked (provisional) | **keep_checked (definitive)** | exact_match |
| service_taisei_kyouka_kasan_I | checked (provisional) | **keep_checked (definitive)** | exact_match |
| service_taisei_kyouka_kasan_II | checked (provisional) | **keep_checked (definitive)** | exact_match |
| taiin_kyoudou_shidou_kasan | checked (provisional) | **keep_checked (definitive)** | exact_match |
| kango_kaigo_renkei_kyouka_kasan | checked (provisional) | **keep_checked (definitive)** | exact_match |

**結論**: alpha.5.5 の 8件 checked は確定版でも全件整合。`source_kind: definitive` に更新して `keep_checked`。

---

## 2. alpha.5.5 で「不整合」と判定した5加算の再検証

これらは「案版（provisional）」では構造差・単位差があったが、**確定版（definitive・令和6.6.1施行で構造変更）では全て社内マスタと整合**。alpha.5.5 の判定を訂正し、`pattern_based_unverified → checked` に昇格。

### 2-1. 緊急時訪問看護加算Ⅰ/Ⅱ

| 項目 | 案版 (2024-03-18) | 確定版 (2024-05-07・令和6.6.1施行) | 社内マスタ | 判定 |
|---|---|---|---|---|
| 緊急時Ⅰ１（指定訪問看護S） | （Ⅰ/Ⅱ区分なし） | **13 3001 600単位** | kinkyu_houmon_kango_kasan_I 600単位 | **exact_match → checked** |
| 緊急時Ⅰ２（医療機関） | （区分なし） | 13 3002 325単位 | （該当なし） | （該当区分なし） |
| 緊急時Ⅱ１（指定訪問看護S） | 13 3100 574単位 | **13 3100 574単位** | kinkyu_houmon_kango_kasan_II 574単位 | **exact_match → checked** |
| 緊急時Ⅱ２（医療機関） | 13 3200 315単位 | 13 3200 315単位 | （該当なし） | （該当区分なし） |

**結論**: 令和6.6.1 で「Ⅰ/Ⅱ × 1/2」の四区分構造が確定。社内マスタの解釈は**指定訪問看護ステーションのⅠ/Ⅱ**に該当。社内マスタは正しい。

### 2-2. ターミナルケア加算

| 項目 | 案版 | 確定版 | 社内マスタ | 判定 |
|---|---|---|---|---|
| ターミナルケア加算 | 13 7000 2,000単位 | **13 7000 2,500単位** | terminal_care_kasan 2,500単位 | **exact_match → checked** |

**結論**: 令和6.6.1 で 2,000→**2,500単位** に増額確定。社内マスタが正しかった。

### 2-3. 初回加算Ⅰ/Ⅱ

| 項目 | 案版 | 確定版 | 社内マスタ | 判定 |
|---|---|---|---|---|
| 初回加算Ⅰ | （Ⅰ/Ⅱ区分なし） | **13 4023 350単位** | shokai_kasan_I 350単位 | **exact_match → checked** |
| 初回加算Ⅱ | 13 4002 300単位 | **13 4002 300単位** | shokai_kasan_II 300単位 | **exact_match → checked** |

**結論**: 令和6.6.1 で初回加算 Ⅰ/Ⅱ 区分が新設。社内マスタの 350/300単位 構造と整合。

---

## 3. alpha.5.6 で新規 checked 化した加算

### 3-1. 口腔連携強化加算

| 項目 | 確定版 | 社内マスタ | 判定 |
|---|---|---|---|
| 口腔連携強化加算 | **13 6192 50単位** 月1回限度 | koukuu_renkei_kyouka_kasan 50単位 | **exact_match → checked** |

---

## 4. pattern_based_unverified のまま残した加算

| kasan | 理由分類 | 詳細 |
|---|---|---|
| 科学的介護推進体制加算 | not_found_in_definitive_source | 確定版訪問看護コード表 (p65-74) に独立コード見当たらず。要追加調査 |
| 処遇改善加算（R8.6新規対象） | out_of_definitive_scope | 令和8年6月臨時改定対象。確定版PDF（令和6.6.1/8月施行版）の対象期間外。R8.6資料を別途取得して照合必要 |
| 複数名訪問看護加算 ×4 | structural_mismatch | 確定版で複数名加算は基本サービスコード（13 1017〜等）に組み込まれた構造。独立コードではないため kasan_key 単位の mapping_status は確定不可 |
| 長時間訪問看護加算 | structural_mismatch | 同上 — 基本サービスコードへの追加加算として組み込み |

---

## 5. not_applicable で再確認

| kasan | 詳細 |
|---|---|
| ninchi_senmon_care_kasan | 確定版（プレフィックス13・訪問看護）でも該当コードなし。訪問看護では算定対象外（alpha.4.5確認・alpha.5.6で確定版でも再確認） |

---

## 6. 訪問看護 mapping_status 集計（alpha.5.6 結果）

| status | 件数 |
|---|---:|
| **checked** | **14** |
| not_applicable | 1 |
| pattern_based_unverified | 7 |
| **合計** | 22 |

### checked 内訳
- alpha.5.5 維持: 8件（特別管理Ⅰ/Ⅱ・看護体制Ⅰ/Ⅱ・サ提体強Ⅰ/Ⅱ・退院時共同指導・看護介護連携）
- alpha.5.6 で promote (案版誤りで保留されていた): 5件（緊急時Ⅰ/Ⅱ・ターミナル・初回Ⅰ/Ⅱ）
- alpha.5.6 で新規 checked: 1件（口腔連携強化加算）

---

## 7. 残り3サービス（houmon_kaigo / kyotaku_shien / tsusho_kaigo）の状態

alpha.5.6 時点では未照合。確定版PDFは手元にあるため次の作業バッチで対応予定。各加算は引き続き `pattern_based_unverified` で `_meta.service_code_mapping_audit.definitive_source_planned` に予定として記録。

| サービス | 加算数 | mapping_status |
|---|---:|---|
| houmon_kaigo | 13 | 全て pattern_based_unverified |
| kyotaku_shien | 18 | 全て pattern_based_unverified |
| tsusho_kaigo | 13 | 全て pattern_based_unverified |

---

## 8. 訪問看護 不整合5加算 audit 結果（alpha.5.5 → alpha.5.6 訂正）

alpha.5.5 で「不整合」とした5加算について、確定版で再検証した結果:

| kasan | alpha.5.5判定理由 | alpha.5.6判定 | 訂正内容 |
|---|---|---|---|
| kinkyu_houmon_kango_kasan_I | structural_mismatch (Ⅰ/Ⅱ区分差) | **checked** | 確定版で四区分（Ⅰ/Ⅱ×1/2）構造確定。社内マスタ整合 |
| kinkyu_houmon_kango_kasan_II | structural_mismatch | **checked** | 同上 |
| terminal_care_kasan | unit_mismatch (2500 vs 案2000) | **checked** | 確定版で 2,500単位 確定（R6.6.1増額） |
| shokai_kasan_I | structural_mismatch (Ⅰ/Ⅱ区分新設) | **checked** | 確定版で Ⅰ/Ⅱ区分 13 4023/4002 確定 |
| shokai_kasan_II | structural_mismatch | **checked** | 同上 |

### 学び (lessons learned)

- **「案」資料 (provisional) を確定版扱いしてはならない**。alpha.5.5 では (案) 表示を見落として `definitive` 相当の判定をしてしまった
- **PDFタイトルに「（案）」マーカーがある場合、自動的に `source_kind: provisional`** とする必要がある
- **R6.4.1施行 → R6.6.1施行 で構造変更された加算がある**（緊急時×4区分・初回Ⅰ/Ⅱ・ターミナル増額）。改定履歴を意識する必要がある
- **社内マスタは令和6.6.1施行ベースで作られていた**ため、案版（令和6.4施行版）との比較で「不整合」になっていた
- alpha.5.6 で `source_kind` フィールドを必須化し、provisional/definitive を区別する仕組みを実装

---

_本レポートは社内 audit 用。public release pack には含めない。_
