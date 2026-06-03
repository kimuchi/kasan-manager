# Deferred Items

**version**: alpha.5.13
**generated_at**: 2026-05-10

---

## 概要

初回バッチに含めず **defer (後回し)** したアイテムの一覧。
**defer は失敗ではなく、安全設計です**。

無理に初回で判断すると以下のリスクがあります:
- 判断材料不足のまま強引な判断 → 後から覆す手間
- 法令確認者の clearance なしに進める → 行政指導リスク
- R8.6 案資料を根拠扱い → 確定版と差異が出たら全顧客対応
- PDF 検出パターンの一括書き換え → 既存サンプル / 外販顧客への影響

---

## defer 理由別の件数

| 理由 | 件数 | 再評価フェーズ |
|---|---:|---|
| `legal_required` | 5 | legal_reviewer の clearance 取得後 (alpha.5.13+) |
| `wait_r8_definitive` | 2 | R8.6.1 確定版公開後 (alpha.5.16+) |
| `divergent_mapping` | 3 | 後続バッチで個別レビュー |
| `per_service_cap_exceeded` | 19 | 後続バッチで業務担当が判断（初回バッチ通過後） |
| `high_risk_master_change` | (本パケットでは初回除外のみ) | alpha.5.16+ で個別 PR |
| `low_priority` | 1 | 後続バッチで業務担当が判断 |

---

## 1. legal_required (5 件)

法令確認者の clearance が必要。alpha.5.12 で `legal_review_clearance` フラグを
ワークブックに追加済。

| service | kasan_key | display_name |
|---|---|---|
| 訪問看護 | `fukusu_mei_houmon_kango_kasan_I_under30` | 複数名訪問看護加算(Ⅰ)・30分未満 |
| 訪問看護 | `fukusu_mei_houmon_kango_kasan_I_over30` | 複数名訪問看護加算(Ⅰ)・30分以上 |
| 訪問看護 | `fukusu_mei_houmon_kango_kasan_II_under30` | 複数名訪問看護加算(Ⅱ)・30分未満 |
| 訪問看護 | `fukusu_mei_houmon_kango_kasan_II_over30` | 複数名訪問看護加算(Ⅱ)・30分以上 |
| 訪問看護 | `chouji_kan_houmon_kango_kasan` | 長時間訪問看護加算 |

**運用**: legal_reviewer が alpha.5.12 workbook の Needs_Legal_Review シートで
clearance を記入 → alpha.5.10 gate 再実行 → approved_changes_preview に進む。

---

## 2. wait_r8_definitive (2 件)

R8.6 案資料は checked 昇格に使えないため、確定版公開まで defer。

| service | kasan_key | display_name |
|---|---|---|
| 訪問介護 | `shougu_kaizen_kasan` | 介護職員処遇改善加算 |
| 居宅介護支援 | `shougu_kaizen_kasan_2026_06` | 処遇改善加算（2026年6月臨時改定・新規対象） |

**運用**: R8.6.1 確定版（おそらく令和8年5月下旬〜6月初頭公開予定）が出たら
alpha.5.16+ で再評価。alpha.5.12 workbook の Future_Candidate シート参照。

---

## 3. divergent_mapping (3 件)

proposed_action と overall_mapping_status が分岐するアイテム。
alpha.5.8.1 で `alpha_5_8_1_proposed_overall_divergence_note` に audit_note 化済。

| service | kasan_key | display_name |
|---|---|---|
| 訪問看護 | `shougu_kaizen_kasan_2026_06` | 介護職員等処遇改善加算（2026年6月臨時改定・訪問看護新規対象） |
| 通所介護 | `adl_iji` | ADL維持等加算 |
| 通所介護 | `ninchi_kasan` | 認知症加算 |

**運用**: 現状維持（`keep_pattern_based_unverified`）で OK。記録のみ・追加作業不要。

---

## 4. per_service_cap_exceeded (19 件)

初回バッチで「同サービスから 2 件まで」のような上限を設けたため、cap を超えて
こぼれた **代表選定候補の残り** です。多くは初回バッチに含めた kasan と
**同じ社内コード体系** を持っており、初回バッチで承認された対応方針を
そのまま後続バッチに適用できる可能性が高いです。

| service | kasan_key | display_name | recommended_initial_decision |
|---|---|---|---|
| 訪問介護 | `shokai_kasan` | 初回加算 | `add_receipt_alias` |
| 訪問介護 | `seikatsu_kinou_renkei_I` | 生活機能向上連携加算(I) | `add_receipt_alias` |
| 訪問介護 | `seikatsu_kinou_renkei_II` | 生活機能向上連携加算(II) | `add_receipt_alias` |
| 訪問介護 | `ninchi_senmon_care_I` | 認知症専門ケア加算(I) | `add_receipt_alias` |
| 訪問介護 | `ninchi_senmon_care_II` | 認知症専門ケア加算(II) | `add_receipt_alias` |
| 居宅介護支援 | `tokutei_jigyousho_I` | 特定事業所加算(I) | `add_receipt_alias` |
| 居宅介護支援 | `tokutei_jigyousho_II` | 特定事業所加算(II) | `add_receipt_alias` |
| 居宅介護支援 | `tokutei_jigyousho_III` | 特定事業所加算(III) | `add_receipt_alias` |
| 居宅介護支援 | `tokutei_jigyousho_A` | 特定事業所加算(A) | `add_receipt_alias` |
| 居宅介護支援 | `nyuin_jouhou_renkei_II` | 入院時情報連携加算(II) | `add_receipt_alias` |
| 居宅介護支援 | `taiin_taisho_kasan_I_i` | 退院・退所加算(I)イ | `add_receipt_alias` |
| 居宅介護支援 | `taiin_taisho_kasan_I_ro` | 退院・退所加算(I)ロ | `add_receipt_alias` |
| 居宅介護支援 | `taiin_taisho_kasan_II_i` | 退院・退所加算(II)イ | `add_receipt_alias` |
| 居宅介護支援 | `taiin_taisho_kasan_II_ro` | 退院・退所加算(II)ロ | `add_receipt_alias` |
| 居宅介護支援 | `taiin_taisho_kasan_III` | 退院・退所加算(III) | `add_receipt_alias` |
| 居宅介護支援 | `tsuuin_jouhou_renkei` | 通院時情報連携加算 | `add_receipt_alias` |
| 居宅介護支援 | `terminal_care_management` | ターミナルケアマネジメント加算 | `add_receipt_alias` |
| 居宅介護支援 | `shokai_kasan` | 初回加算 | `add_receipt_alias` |
| 居宅介護支援 | `tokutei_jigyousho_iryou_kaigo` | 特定事業所医療介護連携加算 | `add_receipt_alias` |

**運用**: 初回バッチが alpha.5.10 gate を通過し、approved_changes_preview が
生成されたあと、業務担当が **同じ判断パターンを後続バッチに適用** できるか確認。
無理がなければ 5〜10 件ずつバッチ化して進める。

---

## 5. low_priority / 後続バッチ (1 件)

初回バッチには入らなかったが、後続バッチで業務担当が判断するアイテム。

| service | kasan_key | display_name | why_not_first_batch |
|---|---|---|---|
| 訪問看護 | `kagakuteki_kaigo_suishin_kasan` | 科学的介護推進体制加算 | 公式 not_found のため R8.6.1 待ちまたは legacy 維持判断 |

**運用**: 初回バッチが alpha.5.10 gate を通過した後、業務担当が次のバッチを判断。
1 バッチあたり 5〜10 件を目安に進める。

---

## defer は失敗ではない

**重要なメッセージ**:

- defer は **安全設計の一部** です
- 「全件を一気に approved にする」ことを目指していません
- 「reviewer / CIO の負担を増やさず、安全に master JSON 反映を進める」
  ことを目指しています
- 法令確認・R8.6.1 確定版・追加情報の収集を待つ間は、**現状の運用は問題なく機能**しています
- 外部に出ている公開デモパック (alpha.5.3 / alpha.5.4) は **完全未改変** で
  顧客への影響なし

---

## 次のフェーズへの引き継ぎ

各 defer 理由ごとに、再評価が可能になる条件:

| 理由 | 再評価可能な条件 | 担当 |
|---|---|---|
| legal_required | legal_reviewer の clearance 取得 | legal_reviewer |
| wait_r8_definitive | R8.6.1 確定版 PDF 公開 | 開発担当 (公開 PDF を取得) |
| divergent_mapping | 後続バッチでの個別判断 | business_reviewer |
| high_risk_master_change | alpha.5.16+ で個別 PR | 開発担当 + business_reviewer |
| low_priority | 初回バッチ完了後 | business_reviewer |
