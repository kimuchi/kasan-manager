# CareLinker 加算チェッカー 判定レポート

> **訪問看護（介護保険）** | 事業所コード `DEMO-0007` | 生成日時 `2026-05-07T11:17:25`
> マスタ版 `v2026.05.06-alpha.4.5` / 改定タグ `R6_2024_06_plus_2026_06_shougu_alpha4_5` / 適用開始 `2024-06-01`

> **🧪 公開デモ用の架空サンプル**: 本レポートは公開デモ用の架空事業所コード・架空職員サマリ・架空証跡データを使用しています。実事業所のデータではありません。

> **⚠️ 重要なお断り**: 本レポートは加算算定可否を**法的に保証するものではありません**。
> 取得候補・確認待ち項目・必要書類・増収目安を提示する**支援ツール**です。
> 実際の届出・算定は各自治体の指導課・監査担当および顧問の社労士等に確認してください。

> **📄 PDF取込モード**: 本レポートはレセプトPDFから抽出した算定中加算を反映しています。
> - PDFで検出された加算は **「算定中の推定」** です（要件充足を保証するものではありません）
> - PDFから検出されないことは **「未算定」を意味しません**（帳票形式・抽出ロジック未対応の可能性）
> - **個人情報は保存していません**（被保険者番号・氏名・住所・電話番号は意図的に非抽出）

## 📄 PDF取込結果サマリ

- ソースファイル: `houmon_kango_kaigo_receipt_sample.pdf`
- 抽出日時: 2026-05-07T11:17:25
- 抽出版: `v2026.05.06-alpha.4.4`
- 推定利用者数: **7名**
- 要介護度分布: 要介護1: 1名 / 要介護2: 2名 / 要介護3: 1名 / 要介護4: 1名 / 要介護5: 2名
- 要介護3以上割合: **57.1%**
- 抽出信頼度: `high`
- サービスコード抽出: 暫定パターンによる推定（公式サービスコード表との完全照合は継続更新対象）
- 帳票形式により抽出精度が変動します

> **個人情報を保存していません**: 個人を特定できる情報は意図的に抽出・保存しない設計。集計値・統計値のみを残す。

---

## 📌 結論サマリ

**全22加算中、取得可能性が高い加算は 0 件**

| 状態 | 件数 | 意味 |
|---|---:|---|
| ✅ 取得済/要件クリア | 0 | 既に要件を満たしている／届出済 |
| ⏸ 確認待ち | 0 | 一部の確認・書類整備で取得可能 |
| ❌ 対象外/不可 | 0 | 地域要件等で対象外 |
| ❔ 情報不足 | 8 | 職員/利用者データ取込・追加実装で判定可 |
| 🚫 当サービスでは算定対象外 | 1 | 公式根拠で対象外確定（改善候補・収益機会には含めない） |
| 📄 PDFで算定中として検出 | 13 | レセプトPDFから算定中と推定された加算 |
| 　└ うち要件確認済 | 0 | 要件マスタとも整合（自信度高） |
| 　└ うち要件未確認 | 13 | 算定中だが要件マスタは未確認 |
| 📄❔ PDFから未検出だが取得候補 | 2 | PDF未検出≠未算定。要追加確認 |

## 📄 PDFで算定中として検出された加算

> **重要**: PDF検出は「算定中の推定」です。要件充足を保証するものではありません。要件マスタとの整合性は別途確認が必要です。

| 加算 | PDF検出件数 | 要件状態 |
|---|---:|---|
| 緊急時訪問看護加算(II) (`kinkyu_houmon_kango_kasan_II`) | 7件 | 💰❔ 算定中（要件未確認） |
| 特別管理加算(I) (`tokubetsu_kanri_kasan_I`) | 1件 | 💰❔ 算定中（要件未確認） |
| 特別管理加算(II) (`tokubetsu_kanri_kasan_II`) | 2件 | 💰❔ 算定中（要件未確認） |
| ターミナルケア加算 (`terminal_care_kasan`) | 1件 | 💰❔ 算定中（要件未確認） |
| 看護体制強化加算(II) (`kango_taisei_kyouka_kasan_II`) | 1件 | 💰❔ 算定中（要件未確認） |
| サービス提供体制強化加算(II) (`service_taisei_kyouka_kasan_II`) | 1件 | 💰❔ 算定中（要件未確認） |
| 退院時共同指導加算 (`taiin_kyoudou_shidou_kasan`) | 1件 | 💰❔ 算定中（要件未確認） |
| 看護・介護職員連携強化加算 (`kango_kaigo_renkei_kyouka_kasan`) | 1件 | 💰❔ 算定中（要件未確認） |
| 口腔連携強化加算 (`koukuu_renkei_kyouka_kasan`) | 1件 | 💰❔ 算定中（要件未確認） |
| 科学的介護推進体制加算 (`kagakuteki_kaigo_suishin_kasan`) | 1件 | 💰❔ 算定中（要件未確認） |
| 介護職員等処遇改善加算（2026年6月臨時改定・訪問看護新規対象） (`shougu_kaizen_kasan_2026_06`) | 7件 | 💰❔ 算定中（要件未確認） |
| 初回加算(Ⅰ) (`shokai_kasan_I`) | 1件 | 💰❔ 算定中（要件未確認） |
| 初回加算(Ⅱ) (`shokai_kasan_II`) | 1件 | 💰❔ 算定中（要件未確認） |

## 📄❔ PDFから未検出だが取得候補の加算

> **重要**: PDFから検出されないことは「未算定」を断定するものではありません。サービスコード未収載・帳票形式違い・PDF抽出ロジック未対応の場合があります。

- 📄❔ **緊急時訪問看護加算(I)** (`kinkyu_houmon_kango_kasan_I`) — ★最重要・体制加算の中核・R6改定で新設
- 📄❔ **看護体制強化加算(I)** (`kango_taisei_kyouka_kasan_I`) — 実績ベース要件のため新規ステーションは2年目以降に検討

---

## 🎯 すぐ確認すべき項目 TOP5

（事業所ステータスを `tenant_data/status/<office>.json` に登録すると、確認すべき項目が表示されます）

## 🗓️ 今月やること

- `tenant_data/status/<office_code>.json` を作成し、職員情報・利用者構成・確認進捗を登録
- 請求明細書PDF（直近3か月）を取り込み、現状算定中の加算を抽出

---

## 1. 取得可能性が高い加算（waiting + clear）

（該当なし）
## 2. 対象外・取得不可の加算

（該当なし）

## 3. 確認待ち項目（テナント側）

（事業所ステータス未読込）

## 4. ❔ 情報不足の内訳（5分類）

| 分類 | 件数 | 説明 |
|---|---:|---|
| `tenant_status_missing` | 51 | 事業所ステータスファイル未登録（tenant_data/status/<office>.jsonを作成すれば判定可） |
| `data_missing` | 0 | 職員情報・利用者情報が未入力（staff/user データ取込で解決） |
| `source_required` | 0 | 公式根拠の確認待ち（マスタ要件側に確定値が未投入） |
| `logic_not_implemented` | 0 | 判定ロジック未実装（OR/AND等のネスト評価が今後の対応事項） |
| `not_applicable_unknown` | 0 | 対象外の可能性があるが未確認（地域要件等） |

### tenant_status_missing

- `kinkyu_houmon_kango_kasan_I.todoke` ← kinkyu_houmon_todoke
- `kinkyu_houmon_kango_kasan_I.joji_taiou` ← joji_taiou_taisei
- `kinkyu_houmon_kango_kasan_I.ninni_kango_shitei` ← kinkyu_kango_setsumei_doui
- `kinkyu_houmon_kango_kasan_I.yakan_taiou_keigen` ← yakan_taiou_keigen_taisei
- `kinkyu_houmon_kango_kasan_II.todoke` ← kinkyu_houmon_todoke
- `kinkyu_houmon_kango_kasan_II.joji_taiou` ← joji_taiou_taisei
- `kinkyu_houmon_kango_kasan_II.ninni_kango_shitei` ← kinkyu_kango_setsumei_doui
- `tokubetsu_kanri_kasan_I.user_jokyo` ← tokubetsu_kanri_I_taisho_user
- `tokubetsu_kanri_kasan_II.user_jokyo` ← tokubetsu_kanri_II_taisho_user
- `terminal_care_kasan.shibou_zen_taiou` ← terminal_taiou_jisseki
- ... 他 41 件

## 5. 必要書類チェックリスト（waiting加算分）

（取得対象加算なし、または書類リスト未定義）

## 6. 追加確認すべき職員情報

（該当なし）

## 7. 追加確認すべき利用者情報

（該当なし）

## 8. 増収見込み（waiting/clear加算）

| 加算 | 状態 | 単位/レート | 年間増収目安 |
|---|---|---|---|

> 増収目安は40名想定の超概算（単価10円・地域単価補正なし）。実際は要介護度構成・地域単価・実利用者数で変動します。

## 9. 根拠マスタのバージョン

- service_key: `houmon_kango_kaigo`
- version: `v2026.05.06-alpha.4.5`
- revision_tag: `R6_2024_06_plus_2026_06_shougu_alpha4_5`
- effective_from: `2024-06-01`
- source_status: `checked`
- 法令出典: 指定居宅サービス等の事業の人員・設備・運営基準(H11厚令37) / 指定居宅サービスに要する費用の額の算定に関する基準(H12厚告19・別表4) / 大臣基準告示 / 老企第36号 / 令和6年度介護報酬改定（令6厚告86号等）/ 令和8年6月臨時改定（処遇改善加算 訪問看護新規対象・加算率1.8%）
- generated_at: `2026-05-07T11:17:25`

## 🧠 要件ロジック評価（alpha）

> 公式根拠確認済みの要件のみ、登録済みevidenceに基づいて機械的に評価しています。
> 本結果は算定可否を法的に保証するものではありません。算定可否の最終確認は事業所資料・届出状況・自治体確認が必要です。

| 加算 | PDF検出 | 要件評価 | 達成ルート | 不足証跡 | 注意 |
|---|---|---|---|---|---|
| 緊急時訪問看護加算(II) | 算定中の推定 | 🟡 partially_clear | 緊急時訪問看護加算の届出が完了している / 24時間連絡体制が整備されている | tenant_status.kinkyu_kango_setsumei_doui.status | ℹ️ pattern_based_unverified |
| 認知症専門ケア加算（訪問看護では算定対象外） | 対象外 | 🚫 当サービス対象外 | - | - | - |

> 「不足証跡あり」と表示された加算は、職員情報・利用者状態・書類整備状況等の追加確認が必要です。

## 🧑‍🤝‍🧑 利用者データ連携（DEMO alpha）

> DEMO用の架空利用者集計データから組み立てた利用者サマリです。
> 個別利用者の氏名・被保険者番号・住所・電話番号・生年月日・家族情報・医療機関名・具体的病名は表示しません（集計値のみ）。
> 本セクションの値は **要件確認補助** であり、算定可否を保証するものではありません。

| 集計項目 | 値 |
|---|---|
| data_source_type | demo_aggregate |
| source_status | demo_aggregate_unverified |
| target_period_start | 2026-04-01 |
| target_period_end | 2026-04-30 |
| users_total | 28 |
| care_level_3_or_higher_count | 20 |
| care_level_3_or_higher_ratio | 0.714 |
| care_level_4_or_higher_count | 13 |
| care_level_4_or_higher_ratio | 0.464 |
| severe_user_count | 14 |
| severe_user_ratio | 0.500 |
| dementia_related_count | 13 |
| medical_dependency_count | 11 |
| terminal_care_related_count | 3 |
| discharge_support_related_count | 2 |
| emergency_response_related_count | 8 |
| care_level_distribution | youshien_1: 0 / youshien_2: 0 / youkaigo_1: 3 / youkaigo_2: 5 / youkaigo_3: 7 / youkaigo_4: 8 / youkaigo_5: 5 |
| dementia_care_level_distribution | I: 3 / IIa: 3 / IIb: 4 / IIIa: 5 / IIIb: 4 / IV: 3 / M: 1 |

> 上記サマリは要件DSLでも参照されます（user_summary.* facts）。
> source_status は `demo_aggregate_unverified` であり、本番運用前に集計根拠の確認が必要です。

## 👥 職員データ連携（DEMO alpha）

> DEMO用の架空staff.jsonから集計した職員サマリです。
> 個別の氏名・staff_id・資格詳細は表示しません（集計値のみ）。
> 算定可否を法的に保証するものではありません。

| 集計項目 | 値 |
|---|---|
| kango_count | 5 |
| kango_fte | 4.40 |
| kango_joukin_count | 3 |
| rihabilitation_count | 2 |

> 上記サマリは要件DSLの判定にも使用されます（staff_summary.* facts）。

## 🧾 不足証跡チェックリスト（alpha）

> 要件ロジック評価で不足している証跡を、確認作業用に整理したものです。
> 本チェックリストは算定可否を法的に保証するものではありません。
> DEMO用の架空tenant_statusを使用。実事業所データではありません。
> DEMO用の架空staff.jsonから集計した職員サマリも参照しています。
> DEMO用の架空利用者集計（user_summary）も参照しています（要件確認補助・算定可否は保証しません）。

| 加算 | 不足証跡 | 推奨確認資料 | 優先度 | 次アクション |
|---|---|---|---|---|
| 緊急時訪問看護加算(II) | 担当看護師指定・利用者への文書説明・同意 | 担当看護師指定書・利用者同意書 | 高 | 担当看護師の指定書・利用者同意書を整備する |

---

> **⚠️ 重要なお断り**: 本レポートは加算算定可否を**法的に保証するものではありません**。
> 取得候補・確認待ち項目・必要書類・増収目安を提示する**支援ツール**です。
> 実際の届出・算定は各自治体の指導課・監査担当および顧問の社労士等に確認してください。

_Generated by CareLinker 加算チェッカー / judge_kasan.py / v2026.05.06-alpha.5.4_