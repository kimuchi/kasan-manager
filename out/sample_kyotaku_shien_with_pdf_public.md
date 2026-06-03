# CareLinker 加算チェッカー 判定レポート

> **居宅介護支援** | 事業所コード `DEMO-0006` | 生成日時 `2026-05-11T02:19:12`
> マスタ版 `2026.6` / 改定タグ `R6_2024_04_plus_2026_06_shougu` / 適用開始 `2024-04-01`

> **🧪 公開デモ用の架空サンプル**: 本レポートは公開デモ用の架空事業所コード・架空職員サマリ・架空証跡データを使用しています。実事業所のデータではありません。

> **⚠️ 重要なお断り**: 本レポートは加算算定可否を**法的に保証するものではありません**。
> 取得候補・確認待ち項目・必要書類・増収目安を提示する**支援ツール**です。
> 実際の届出・算定は各自治体の指導課・監査担当および顧問の社労士等に確認してください。

> **📄 PDF取込モード**: 本レポートはレセプトPDFから抽出した算定中加算を反映しています。
> - PDFで検出された加算は **「算定中の推定」** です（要件充足を保証するものではありません）
> - PDFから検出されないことは **「未算定」を意味しません**（帳票形式・抽出ロジック未対応の可能性）
> - **個人情報は保存していません**（被保険者番号・氏名・住所・電話番号は意図的に非抽出）

## 📄 PDF取込結果サマリ

- ソースファイル: `kyotaku_shien_receipt_sample.pdf`
- 抽出日時: 2026-05-11T02:19:11
- 抽出版: `v2026.05.06-alpha.4.4`
- 推定利用者数: **7名**
- 要介護度分布: 要介護1: 1名 / 要介護2: 2名 / 要介護3: 1名 / 要介護4: 1名 / 要介護5: 2名
- 要介護3以上割合（参考値・PDFのみで要件clearしない）: **57.1%**
    - 居宅介護支援の特定事業所加算(I)40%要件は地域包括紹介除外などPDFだけでは確定できないため参考値扱い
- 抽出信頼度: `high`
- サービスコード抽出: 暫定パターンによる推定（公式サービスコード表との完全照合は継続更新対象）
- 帳票形式により抽出精度が変動します

> **個人情報を保存していません**: 個人を特定できる情報は意図的に抽出・保存しない設計。集計値・統計値のみを残す。

**抽出警告**:
- ⚠️ kyotaku_shien: 特定事業所加算(I)の40%要件は地域包括紹介除外などPDFのみで確定できない。raw_yokaigo_3plus_ratioは参考値。

---

## 📌 結論サマリ

**全18加算中、取得可能性が高い加算は 0 件**

| 状態 | 件数 | 意味 |
|---|---:|---|
| ✅ 取得済/要件クリア | 0 | 既に要件を満たしている／届出済 |
| ⏸ 確認待ち | 0 | 一部の確認・書類整備で取得可能 |
| ❌ 対象外/不可 | 0 | 地域要件等で対象外 |
| ❔ 情報不足 | 9 | 職員/利用者データ取込・追加実装で判定可 |
| 📄 PDFで算定中として検出 | 9 | レセプトPDFから算定中と推定された加算 |
| 　└ うち要件確認済 | 0 | 要件マスタとも整合（自信度高） |
| 　└ うち要件未確認 | 9 | 算定中だが要件マスタは未確認 |
| 📄❔ PDFから未検出だが取得候補 | 3 | PDF未検出≠未算定。要追加確認 |

## 📄 PDFで算定中として検出された加算

> **重要**: PDF検出は「算定中の推定」です。要件充足を保証するものではありません。要件マスタとの整合性は別途確認が必要です。

| 加算 | PDF検出件数 | 要件状態 |
|---|---:|---|
| 特定事業所加算(II) (`tokutei_jigyousho_II`) | 7件 | 💰❔ 算定中（要件未確認） |
| 入院時情報連携加算(I) (`nyuin_jouhou_renkei_I`) | 1件 | 💰❔ 算定中（要件未確認） |
| 入院時情報連携加算(II) (`nyuin_jouhou_renkei_II`) | 1件 | 💰❔ 算定中（要件未確認） |
| 退院・退所加算(I)ロ (`taiin_taisho_kasan_I_ro`) | 1件 | 💰❔ 算定中（要件未確認） |
| 退院・退所加算(II)ロ (`taiin_taisho_kasan_II_ro`) | 1件 | 💰❔ 算定中（要件未確認） |
| 通院時情報連携加算 (`tsuuin_jouhou_renkei`) | 1件 | 💰❔ 算定中（要件未確認） |
| ターミナルケアマネジメント加算 (`terminal_care_management`) | 1件 | 💰❔ 算定中（要件未確認） |
| 初回加算 (`shokai_kasan`) | 1件 | 💰❔ 算定中（要件未確認） |
| 処遇改善加算（2026年6月臨時改定・新規対象） (`shougu_kaizen_kasan_2026_06`) | 7件 | 💰❔ 算定中（要件未確認） |

## 📄❔ PDFから未検出だが取得候補の加算

> **重要**: PDFから検出されないことは「未算定」を断定するものではありません。サービスコード未収載・帳票形式違い・PDF抽出ロジック未対応の場合があります。

- 📄❔ **特定事業所加算(I)** (`tokutei_jigyousho_I`) — 最重要・年200-500万円規模・要件ハードル高
- 📄❔ **特定事業所加算(III)** (`tokutei_jigyousho_III`) — 小規模事業所向け（常勤専従CM2名）
- 📄❔ **特定事業所加算(IV)** (`tokutei_jigyousho_IV`) — Ⅰ/Ⅱ/Ⅲ取得済なら追加で取りやすい

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
| `tenant_status_missing` | 48 | 事業所ステータスファイル未登録（tenant_data/status/<office>.jsonを作成すれば判定可） |
| `data_missing` | 0 | 職員情報・利用者情報が未入力（staff/user データ取込で解決） |
| `source_required` | 0 | 公式根拠の確認待ち（マスタ要件側に確定値が未投入） |
| `logic_not_implemented` | 0 | 判定ロジック未実装（OR/AND等のネスト評価が今後の対応事項） |
| `not_applicable_unknown` | 0 | 対象外の可能性があるが未確認（地域要件等） |

### tenant_status_missing

- `tokutei_jigyousho_I.staff` ← joukin_senjuu_cm_count
- `tokutei_jigyousho_I.renkei_24h` ← renkei_24h
- `tokutei_jigyousho_I.case_meeting` ← case_meeting_weekly
- `tokutei_jigyousho_I.kenshuu` ← annual_training_plan
- `tokutei_jigyousho_I.houkatsu_renkei` ← houkatsu_renkei
- `tokutei_jigyousho_I.kongan_jirei_ratio` ← kongan_jirei_ratio
- `tokutei_jigyousho_I.no_gensan` ← no_gensan
- `tokutei_jigyousho_I.houtei_kenshuu_kyouryoku` ← kenshuu_kyouryoku
- `tokutei_jigyousho_II.staff` ← joukin_senjuu_cm_count
- `tokutei_jigyousho_II.renkei_24h` ← renkei_24h
- ... 他 38 件

## 5. 必要書類チェックリスト（waiting加算分）

（取得対象加算なし、または書類リスト未定義）

## 6. 追加確認すべき職員情報

- [ ] joukin_senjuu_cm_count

## 7. 追加確認すべき利用者情報

- [ ] kongan_jirei_ratio

## 8. 増収見込み（waiting/clear加算）

| 加算 | 状態 | 単位/レート | 年間増収目安 |
|---|---|---|---|

> 増収目安は40名想定の超概算（単価10円・地域単価補正なし）。実際は要介護度構成・地域単価・実利用者数で変動します。

## 9. 根拠マスタのバージョン

- service_key: `kyotaku_shien`
- version: `2026.6`
- revision_tag: `R6_2024_04_plus_2026_06_shougu`
- effective_from: `2024-04-01`
- source_status: `implemented`
- 法令出典: 指定居宅介護支援等の事業の人員及び運営に関する基準(H11厚令38) / 指定居宅介護支援に要する費用の額の算定に関する基準(R6厚告72) / 大臣基準告示 / 老企第36号 / 2026年6月臨時介護報酬改定(処遇改善加算対象拡大)
- generated_at: `2026-05-11T02:19:12`

**サービスコード照合監査（alpha.5.8.1）:**

- audit_version: `alpha.5.8.1`
- audit_date: `2026-05-10`
- checked: 0 件
- pattern_based_unverified: 18 件
- not_applicable: 0 件
- note: kyotaku_shien: alpha.5.7 で R7.4確定版（current_definitive）と照合実施。コード・単位整合は exact_match のみ checked、それ以外は社内マスタ訂正候補として pattern_based_unverified 維持。詳細は service_code_audit 参照。

## 🧠 要件ロジック評価（alpha）

> 公式根拠確認済みの要件のみ、登録済みevidenceに基づいて機械的に評価しています。
> 本結果は算定可否を法的に保証するものではありません。算定可否の最終確認は事業所資料・届出状況・自治体確認が必要です。

| 加算 | PDF検出 | 要件評価 | mapping | 達成ルート | 不足証跡 | 注意 |
|---|---|---|---|---|---|---|
| 初回加算 | 算定中の推定 | ✅ clear | ℹ️ 帳票パターン | 当月の新規ケアプラン作成1件以上 / Aルート: 要介護認定の新規 | - | ℹ️ pattern_based_unverified |

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
| users_total | 45 |
| care_level_3_or_higher_count | 25 |
| care_level_3_or_higher_ratio | 0.556 |
| care_level_4_or_higher_count | 12 |
| care_level_4_or_higher_ratio | 0.267 |
| severe_user_count | 10 |
| severe_user_ratio | 0.222 |
| dementia_related_count | 11 |
| medical_dependency_count | 6 |
| terminal_care_related_count | 1 |
| discharge_support_related_count | 4 |
| emergency_response_related_count | 3 |
| care_level_distribution | youshien_1: 0 / youshien_2: 0 / youkaigo_1: 9 / youkaigo_2: 11 / youkaigo_3: 13 / youkaigo_4: 8 / youkaigo_5: 4 |
| dementia_care_level_distribution | I: 6 / IIa: 5 / IIb: 6 / IIIa: 5 / IIIb: 4 / IV: 2 / M: 0 |

> 上記サマリは要件DSLでも参照されます（user_summary.* facts）。
> source_status は `demo_aggregate_unverified` であり、本番運用前に集計根拠の確認が必要です。

## 👥 職員データ連携（DEMO alpha）

> DEMO用の架空staff.jsonから集計した職員サマリです。
> 個別の氏名・staff_id・資格詳細は表示しません（集計値のみ）。
> 算定可否を法的に保証するものではありません。

| 集計項目 | 値 |
|---|---|
| cm_count | 6 |
| shunin_cm_count | 2 |
| cm_total_fte | 5.80 |

> 上記サマリは要件DSLの判定にも使用されます（staff_summary.* facts）。

---

> **⚠️ 重要なお断り**: 本レポートは加算算定可否を**法的に保証するものではありません**。
> 取得候補・確認待ち項目・必要書類・増収目安を提示する**支援ツール**です。
> 実際の届出・算定は各自治体の指導課・監査担当および顧問の社労士等に確認してください。

_Generated by CareLinker 加算チェッカー / judge_kasan.py / v2026.05.06-alpha.5.8.1_