# CareLinker 加算チェッカー 判定レポート

> **訪問介護** | 事業所コード `DEMO-0005` | 生成日時 `2026-05-26T07:01:26`
> マスタ版 `2026.4` / 改定タグ `R6_2024_04` / 適用開始 `2024-04-01`

> **🧪 公開デモ用の架空サンプル**: 本レポートは公開デモ用の架空事業所コード・架空職員サマリ・架空証跡データを使用しています。実事業所のデータではありません。

> **⚠️ 重要なお断り**: 本レポートは加算算定可否を**法的に保証するものではありません**。
> 取得候補・確認待ち項目・必要書類・増収目安を提示する**支援ツール**です。
> 実際の届出・算定は各自治体の指導課・監査担当および顧問の社労士等に確認してください。

## 📌 結論サマリ

**全13加算中、取得可能性が高い加算は 0 件**

| 状態 | 件数 | 意味 |
|---|---:|---|
| ✅ 取得済/要件クリア | 0 | 既に要件を満たしている／届出済 |
| ⏸ 確認待ち | 0 | 一部の確認・書類整備で取得可能 |
| ❌ 対象外/不可 | 0 | 地域要件等で対象外 |
| ❔ 情報不足 | 13 | 職員/利用者データ取込・追加実装で判定可 |

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
| `tenant_status_missing` | 43 | 事業所ステータスファイル未登録（tenant_data/status/<office>.jsonを作成すれば判定可） |
| `data_missing` | 0 | 職員情報・利用者情報が未入力（staff/user データ取込で解決） |
| `source_required` | 0 | 公式根拠の確認待ち（マスタ要件側に確定値が未投入） |
| `logic_not_implemented` | 0 | 判定ロジック未実装（OR/AND等のネスト評価が今後の対応事項） |
| `not_applicable_unknown` | 0 | 対象外の可能性があるが未確認（地域要件等） |

### tenant_status_missing

- `tokutei_jigyousho_I.saseki` ← saseki_qualifications
- `tokutei_jigyousho_I.kaigo_fukushishi_ratio` ← helper_qualifications
- `tokutei_jigyousho_I.shiji_houkoku` ← shiji_houkoku_record
- `tokutei_jigyousho_I.case_meeting` ← monthly_meeting_record
- `tokutei_jigyousho_I.kenshin` ← saseki_health_check
- `tokutei_jigyousho_I.kinkyu_taiou_meiji` ← explanation_doc_emergency
- `tokutei_jigyousho_I.juudosha_youken` ← juudosha_ratio
- `tokutei_jigyousho_I.saseki_uwanose` ← saseki_uwanose_count
- `tokutei_jigyousho_II.saseki` ← saseki_qualifications
- `tokutei_jigyousho_II.kaigo_fukushishi_ratio` ← helper_qualifications
- ... 他 33 件

## 5. 必要書類チェックリスト（waiting加算分）

（取得対象加算なし、または書類リスト未定義）

## 6. 追加確認すべき職員情報

- [ ] saseki_qualifications
- [ ] helper_qualifications
- [ ] saseki_health_check
- [ ] saseki_uwanose_count
- [ ] kinzoku_7nen_ratio

## 7. 追加確認すべき利用者情報

- [ ] juudosha_ratio
- [ ] chusankan_user_count

## 8. 増収見込み（waiting/clear加算）

| 加算 | 状態 | 単位/レート | 年間増収目安 |
|---|---|---|---|

> 増収目安は40名想定の超概算（単価10円・地域単価補正なし）。実際は要介護度構成・地域単価・実利用者数で変動します。

## 9. 根拠マスタのバージョン

- service_key: `houmon_kaigo`
- version: `2026.4`
- revision_tag: `R6_2024_04`
- effective_from: `2024-04-01`
- source_status: `implemented`
- 法令出典: 指定居宅サービス等の事業の人員・設備・運営基準(H11厚令37) / 指定居宅サービスに要する費用の額の算定に関する基準(H12厚告19) / 大臣基準告示 / 老企第36号 / R6改定（令6厚告86号等）
- generated_at: `2026-05-26T07:01:26`

**サービスコード照合監査（alpha.5.8.1）:**

- audit_version: `alpha.5.8.1`
- audit_date: `2026-05-10`
- checked: 0 件
- pattern_based_unverified: 13 件
- not_applicable: 0 件
- note: houmon_kaigo: alpha.5.7 で R7.4確定版（current_definitive）と照合実施。コード・単位整合は exact_match のみ checked、それ以外は社内マスタ訂正候補として pattern_based_unverified 維持。詳細は service_code_audit 参照。

## 🧠 要件ロジック評価（alpha）

> 公式根拠確認済みの要件のみ、登録済みevidenceに基づいて機械的に評価しています。
> 本結果は算定可否を法的に保証するものではありません。算定可否の最終確認は事業所資料・届出状況・自治体確認が必要です。

| 加算 | PDF検出 | 要件評価 | mapping | 達成ルート | 不足証跡 | 注意 |
|---|---|---|---|---|---|---|
| 特定事業所加算(I) | 未検出 | 📭 不足証跡あり | ℹ️ 帳票パターン | - | staff_summary.helper_fukushishi_jitsumusha_kiso_ratio, staff_summary.helper_kaigo_fukushishi_ratio, staff_summary.saseki_uwanose_fte, tenant_status.explanation_doc_emergency.status, tenant_status.helper_qualifications.fukushishi_jitsumusha_kiso_ratio, tenant_status.helper_qualifications.kaigo_fukushishi_ratio, tenant_status.juudosha_ratio.value, tenant_status.mitorikiki_jisseki_count.value, tenant_status.monthly_meeting_record.status, tenant_status.saseki_health_check.status, tenant_status.saseki_qualifications.status, tenant_status.saseki_uwanose_count.status, tenant_status.shiji_houkoku_record.status, user_summary.severe_user_ratio, user_summary.terminal_care_related_count | ℹ️ pattern_based_unverified |

> 「不足証跡あり」と表示された加算は、職員情報・利用者状態・書類整備状況等の追加確認が必要です。

## 🧾 不足証跡チェックリスト（alpha）

> 要件ロジック評価で不足している証跡を、確認作業用に整理したものです。
> 本チェックリストは算定可否を法的に保証するものではありません。

| 加算 | 不足証跡 | 推奨確認資料 | 優先度 | 次アクション |
|---|---|---|---|---|
| 特定事業所加算(I) | ヘルパーの介護福祉士等比率（職員データ集計） | 研修修了証・勤務表 | 高 | 実務者研修・基礎研修の修了状況を反映する |
| 特定事業所加算(I) | ヘルパーの介護福祉士比率（職員データ集計） | ヘルパー資格証一覧・勤務表 | 高 | ヘルパー在籍者の介護福祉士比率を確認する |
| 特定事業所加算(I) | ヘルパーの介護福祉士+実務者+基礎研修修了者比率 | ヘルパー資格証一覧・研修修了証 | 高 | 実務者研修・基礎研修の修了状況を整理する |
| 特定事業所加算(I) | ヘルパーの介護福祉士比率 | ヘルパー資格証一覧・勤務表 | 高 | ヘルパー在籍者の資格区分を集計する |
| 特定事業所加算(I) | 重度者(要介護4-5/認知症Ⅲ以上等)の利用者割合 | 利用者状態一覧・ケアプラン | 高 | 利用者の要介護度・認知症日常生活自立度を集計する |
| 特定事業所加算(I) | 月次会議議事録 | 定例会議議事録・研修記録 | 高 | 月次会議の開催実績と議事録を整理する |
| 特定事業所加算(I) | サービス提供責任者の資格・実務経験 | サ責資格証・実務経験証明書 | 高 | サ責候補者の資格証・実務経験を整理する |
| 特定事業所加算(I) | 常勤サービス提供責任者の上乗せ配置 | 勤務表・雇用契約書 | 高 | サ責の上乗せ配置状況を整理する |
| 特定事業所加算(I) | サ責→ヘルパー指示・報告書 | 指示書サンプル・報告書サンプル | 高 | サ責からヘルパーへの指示書・報告書の運用を整備する |
| 特定事業所加算(I) | 重度者の利用者割合（利用者集計） | 利用者状態一覧（集計表）・認知症日常生活自立度集計 | 高 | 対象期間内の重度者割合の集計根拠を確認する |
| 特定事業所加算(I) | staff_summary.saseki_uwanose_fte | - | 中 | 事業所内で資料の有無を確認する |
| 特定事業所加算(I) | 重要事項説明書 緊急時対応記載 | 重要事項説明書 改訂版 | 中 | 重要事項説明書に緊急時対応の記載があるか確認する |
| 特定事業所加算(I) | 看取り期対応実績件数 | 看取り対応記録・ターミナルケア記録 | 中 | 看取り期・ターミナルケア対応の記録を集約する |
| 特定事業所加算(I) | サ責健康診断記録 | 健康診断結果票・健康管理台帳 | 中 | サ責の健康診断実施状況を確認する |
| 特定事業所加算(I) | 看取り期対応関連件数（利用者集計） | 看取り対応記録（集計表） | 中 | 看取り期対応実績の集計根拠を確認する |

---

> **⚠️ 重要なお断り**: 本レポートは加算算定可否を**法的に保証するものではありません**。
> 取得候補・確認待ち項目・必要書類・増収目安を提示する**支援ツール**です。
> 実際の届出・算定は各自治体の指導課・監査担当および顧問の社労士等に確認してください。

_Generated by CareLinker 加算チェッカー / judge_kasan.py / v2026.05.06-alpha.5.8.1_