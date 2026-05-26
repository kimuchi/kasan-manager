# alpha.5.8.1 Audit Metadata Consistency Hotfix Report

**監査日**: 2026-05-10
**監査者**: alpha.5.8.1 audit (CareLinker)
**スコープ**: alpha.5.8 で導入した三層コードモデルの監査メタデータの整合修正のみ。**業務データ（master JSON 業務フィールド・proposed_action・overall_mapping_status）に変更はない**。

> ⚠️ **2026-05-10 訂正通知（社長レビュー反映）**: 本レポートで指摘した「needs_master_review 件数不整合（narrative 35 vs 機械集計 28）」は、社長による再確認で**撤回**された。alpha.5.8 master JSON の業務データ（proposed_action 集計）は当初から正しく、件数の不整合は**存在しない**。本レポート Section 2「needs_master_review 件数不整合の原因」以降の narrative不整合に関する記述は、**Section 7 / Section 8 の listing が machine集計に正しく対応している**事実そのものは正確だが、その差分を「不整合」と呼ぶ評価は撤回する。
>
> 本レポートで実施した実作業のうち、撤回されないもの:
> - R8.6「その3」 source registry の URL / content_verified 充足
> - `checked_promotion_allowed=false` 二重防御の追加
> - `resolve_current_source_for_date` / `get_definitive_sources_for_period` のフィルタ追加
> - registry_version / schema_version / audit_version の `alpha.5.8.1` への更新
> - 19 invariants tests の追加
> - audit report 内の listing（28件 / 5件 / 10件 / 2件 / 1件 / 20件）
>
> 加えて、proposed_action と overall_mapping_status の **crosswalk** および keep_pattern_based_unverified 10件の overall分布（7+3）の audit_note 化は、別レポート [`alpha5_8_1_source_metadata_hotfix_report.md`](alpha5_8_1_source_metadata_hotfix_report.md) で実施した。

---

## 1. 修正対象（5項目）

| # | 対象 | 修正内容 |
|---|------|---------|
| 1 | `regulatory_master/sources/kaigo_service_code_sources.json` | registry_version → `alpha.5.8.1`。R8.6「その3」の URL null / content未検証を解消。`checked_promotion_allowed=false` を全 R8.6 案 source に明示化 |
| 2 | `regulatory_master/sources/code_model_schema.json` | schema_version → `alpha.5.8.1`。`alpha_5_8_1_invariants` セクション新設（合計66件・1 kasan 1 status 等の不変条件） |
| 3 | 4 master JSON (`houmon_kango_kaigo` / `tsusho_kaigo` / `houmon_kaigo` / `kyotaku_shien`) | `_meta.service_code_mapping_audit.audit_version` → `alpha.5.8.1`。`alpha_5_8_1_audit_metadata_hotfix` block を `_meta` に追記（kasan 業務データは無変更） |
| 4 | `out/internal/alpha5_8_three_layer_code_model_report.md` | hotfix で narrative数値が訂正された旨を冒頭に明示・本レポートを参照誘導 |
| 5 | `scripts/judge_kasan.py` | signature → `v2026.05.06-alpha.5.8.1` |
| 6 | `scripts/import_receipt_pdf.py` | `resolve_current_source_for_date` / `get_definitive_sources_for_period` に `checked_promotion_allowed=false` 除外フィルタを追加（二重防御） |
| 7 | `tests/test_mapping_status.py` | alpha.5.8.1 不変条件テスト 19 件追加・既存 audit_version assertion 拡張 |
| 8 | `out/internal/alpha5_8_1_audit_metadata_hotfix_report.md` | 本レポート（新規） |

---

## 2. needs_master_review 件数不整合の原因

### 不整合の内容
alpha.5.8 audit report `Section 8 needs_master_review（28件）` の narrative では:

| narrative上の内訳 | 件数 |
|---|---:|
| 通所介護 | 6 |
| 訪問介護 | 13 |
| 居宅介護支援 | 16 |
| **narrative計** | **35** |

しかし冒頭の見出しは「needs_master_review（**28**件）」。narrative合計 35 と冒頭 28 が矛盾していた。

### 根本原因

machine集計（`_update_three_layer_alpha5_8.py` の判定ロジック）は正しく:

```python
elif official_code_model["official_code_status"] == "needs_review" and internal_codes:
    proposed_action = "needs_master_review"
```

の **「social_codes が空でないこと」** を条件にしていた。一方、narrative を書く際に「公式コードと不整合な加算」を一括で 通所6・訪問介護13・居宅16 と数えてしまい、実際には `internal_codes` が空のため `keep_pattern_based_unverified` に流れる加算（後述）も含めてしまっていた。

### narrative上「needs_master_review」と書かれていたが実際は `keep_pattern_based_unverified` だった加算

| サービス | 加算 | 理由 |
|---|---|---|
| 通所介護 | `adl_iji`（ADL維持等加算） | service_codes=空 → 公式コード `156338` への対応は社内マスタ未登録 |
| 通所介護 | `ninchi_kasan`（認知症加算） | 同上（公式 `155305`） |
| 訪問介護 | `tokutei_jigyousho_I` 〜 `V` 全5件 | service_codes はあるが official_code 検証で `not_found` → 厳密には `keep_pattern_based_unverified`（official_code_status=`not_found`） |

### narrative 上で抜けていた加算

| サービス | 加算 | 実際の proposed_action |
|---|---|---|
| 訪問看護 | `kagakuteki_kaigo_suishin_kasan`（科学的介護推進体制加算） | **needs_master_review**（社内136900 / 公式コード not_found） |

### 集計の正解（machine-counted）

| サービス | needs_master_review | 内訳 |
|---|---:|---|
| 訪問看護 | 1 | 科学的介護推進体制加算 |
| 通所介護 | 4 | 中重度者ケア体制・入浴介助Ⅱ・口腔機能向上Ⅰ・栄養改善 |
| 訪問介護 | 7 | 初回・生活機能向上連携Ⅰ/Ⅱ・認知症専門ケアⅠ/Ⅱ・緊急時訪問介護・口腔連携強化 |
| 居宅介護支援 | 16 | 特定事業所Ⅰ-Ⅲ・A・入院情報連携Ⅰ/Ⅱ・退院退所Ⅰ-Ⅲ・通院情報連携・緊急時カンファ・ターミナル・初回・特定事業所医療介護連携 |
| **合計** | **28** | |

---

## 3. 修正後の proposed_action 集計（66件）

| proposed_action | 件数 | service別内訳 |
|---|---:|---|
| **keep_checked** | **20** | 訪問看護14・通所介護6 |
| **needs_master_review** | **28** | 訪問看護1・通所介護4・訪問介護7・居宅介護支援16 |
| **needs_legal_review** | **5** | 訪問看護5（複数名×4 + 長時間） |
| **keep_pattern_based_unverified** | **10** | 訪問看護1・通所介護3・訪問介護5・居宅介護支援1 |
| **future_candidate_only** | **2** | 訪問介護1・居宅介護支援1 |
| **not_applicable_confirmed** | **1** | 訪問看護1（認知症専門ケア加算） |
| **合計** | **66** | |

---

## 4. 修正後の overall_mapping_status 集計（66件）

| overall_mapping_status | 件数 | service別内訳 |
|---|---:|---|
| **checked** | **20** | 訪問看護14・通所介護6 |
| **needs_review** | **36** | 訪問看護7・通所介護6・訪問介護7・居宅介護支援16 |
| **pattern_based_unverified** | **9** | 通所介護1・訪問介護6・居宅介護支援2 |
| **not_applicable** | **1** | 訪問看護1 |
| **合計** | **66** | |

---

## 5. 修正後の official_code_status 集計（66件）

alpha.5.8 audit report Section 4 の数値も訂正:

| official_code_status | alpha.5.8 narrative | machine-counted (alpha.5.8.1) |
|---|---:|---:|
| checked | 20 | **20** ✓ |
| needs_review | 35 ← narrative誤り | **31** |
| not_found | 9 | **9** ✓ |
| structural_mismatch | 1 ← narrative誤り | **5** |
| not_applicable | 1 | **1** ✓ |
| **合計** | 66 | **66** |

structural_mismatch は訪問看護の複数名×4 + 長時間 = 5件（needs_legal_review 対象）で、narrative の「1件」は誤り。

---

## 6. 修正後の receipt_detection_status 集計（66件）

alpha.5.8 audit report Section 5 の数値も訂正:

| receipt_detection_status | alpha.5.8 narrative | machine-counted (alpha.5.8.1) |
|---|---:|---:|
| exact_official_code | 20 | **20** ✓ |
| legacy_detection_only | 33 ← narrative誤り | **35** |
| pattern_detection_only | 12 ← narrative誤り | **10** |
| unknown | 1 | **1** ✓ |
| **合計** | 66 | **66** |

---

## 7. needs_master_review 一覧（28件・全件）

### 訪問看護（1件）
- `kagakuteki_kaigo_suishin_kasan`（科学的介護推進体制加算） — internal=136900 / official=not_found

### 通所介護（4件）
- `chujudosha_care_taisei`（中重度者ケア体制加算） — internal=156271 / official=155306
- `nyuyoku_II`（入浴介助加算Ⅱ） — internal=155302 / official=155303
- `koukuu_kinou_I`（口腔機能向上加算Ⅰ） — internal=155501 / official=155606
- `eiyou_kaizen`（栄養改善加算） — internal=156112 / official=155605

### 訪問介護（7件）— 社内 116XXX 系 vs 公式 114XXX 系
- `shokai_kasan`（初回加算） — internal=116200 / official=114001
- `seikatsu_kinou_renkei_I`（生活機能向上連携加算Ⅰ） — internal=116301 / official=114003
- `seikatsu_kinou_renkei_II`（生活機能向上連携加算Ⅱ） — internal=116302 / official=114002
- `ninchi_senmon_care_I`（認知症専門ケア加算Ⅰ） — internal=116401 / official=114004
- `ninchi_senmon_care_II`（認知症専門ケア加算Ⅱ） — internal=116402 / official=114005
- `kinkyu_houmon`（緊急時訪問介護加算） — internal=116500 / official=114000
- `koukuu_renkei_kyouka`（口腔連携強化加算） — internal=116600 / official=116192

### 居宅介護支援（16件）— 社内 438XXX 系 vs 公式 434XXX/436XXX 系
- `tokutei_jigyousho_I`（特定事業所加算Ⅰ） — internal=438100 / official=434002
- `tokutei_jigyousho_II`（特定事業所加算Ⅱ） — internal=438101 / official=434003
- `tokutei_jigyousho_III`（特定事業所加算Ⅲ） — internal=438102 / official=434004
- `tokutei_jigyousho_A`（特定事業所加算A） — internal=438104 / official=434006
- `nyuin_jouhou_renkei_I`（入院時情報連携加算Ⅰ） — internal=438200 / official=436125
- `nyuin_jouhou_renkei_II`（入院時情報連携加算Ⅱ） — internal=438201 / official=436129
- `taiin_taisho_kasan_I_i`（退院・退所加算Ⅰイ） — internal=438301 / official=436132
- `taiin_taisho_kasan_I_ro`（退院・退所加算Ⅰロ） — internal=438302 / official=436143
- `taiin_taisho_kasan_II_i`（退院・退所加算Ⅱイ） — internal=438303 / official=436144
- `taiin_taisho_kasan_II_ro`（退院・退所加算Ⅱロ） — internal=438304 / official=436145
- `taiin_taisho_kasan_III`（退院・退所加算Ⅲ） — internal=438305 / official=436146
- `tsuuin_jouhou_renkei`（通院時情報連携加算） — internal=438400 / official=436135
- `kinkyu_kyotaku_conference`（緊急時等居宅カンファレンス加算） — internal=438500 / official=436133
- `terminal_care_management`（ターミナルケアマネジメント加算） — internal=438600 / official=436100
- `shokai_kasan`（初回加算） — internal=438700 / official=434001
- `tokutei_jigyousho_iryou_kaigo`（特定事業所医療介護連携加算） — internal=438800 / official=434005

---

## 8. needs_legal_review 一覧（5件・全件）

訪問看護の基本サービスコードへの追加加算構造で、独立コードを持たない:

- `fukusu_mei_houmon_kango_kasan_I_under30`（複数名訪問看護加算Ⅰ・30分未満）
- `fukusu_mei_houmon_kango_kasan_I_over30`（複数名訪問看護加算Ⅰ・30分以上）
- `fukusu_mei_houmon_kango_kasan_II_under30`（複数名訪問看護加算Ⅱ・30分未満）
- `fukusu_mei_houmon_kango_kasan_II_over30`（複数名訪問看護加算Ⅱ・30分以上）
- `chouji_kan_houmon_kango_kasan`（長時間訪問看護加算）

→ 法令解釈通知の精読が必要。マスタ訂正では解決しない。

---

## 9. keep_pattern_based_unverified 一覧（10件・全件）

### 訪問看護（1件）
- `shougu_kaizen_kasan_2026_06`（介護職員等処遇改善加算 2026-06新規対象）— alpha.5.7.2 から `pattern_based_unverified`

### 通所介護（3件）
- `koukuu_kinou_II_life`（口腔機能向上加算Ⅱ）— internal=155502 / official=not_found
- `adl_iji`（ADL維持等加算）— internal=空 / official=156338
- `ninchi_kasan`（認知症加算）— internal=空 / official=155305

### 訪問介護（5件・全件 not_found）
- `tokutei_jigyousho_I` 〜 `V`（特定事業所加算Ⅰ-Ⅴ）— 公式コード not_found

### 居宅介護支援（1件）
- `tokutei_jigyousho_IV`（特定事業所加算Ⅳ）— official=not_found

---

## 10. future_candidate_only 一覧（2件・全件）

R8.6.1 案資料のみが根拠。確定版が出るまで checked 化しない:

- 訪問介護 `shougu_kaizen_kasan`（介護職員処遇改善加算）
- 居宅介護支援 `shougu_kaizen_kasan_2026_06`（処遇改善加算 2026年6月新規対象）

---

## 11. R8.6「その3」 source registry 修正内容

### 修正前（alpha.5.8）

```json
{
  "source_id": "WAM_R8_6_8_PROVISIONAL_2026_04_30",
  "source_url": null,
  "page_or_section": "URL未取得（alpha.5.8時点でWAM NETから直接URL取得できず）",
  "same_pdf_under_new_parent_page": "...同一PDFが「その3」ページからも参照されている可能性が高い。alpha.5.8 時点でURL検証は未実施・確認後に source_url を充足。"
}
```

### 修正後（alpha.5.8.1）

```json
{
  "source_id": "WAM_R8_6_8_PROVISIONAL_2026_04_30",
  "source_url": "https://www.wam.go.jp/gyoseiShiryou-files/documents/2026/0414224940739/20260416_004.pdf",
  "parent_page_url": "https://www.wam.go.jp/gyoseiShiryou/detail?gno=22523&ct=020050010",
  "parent_page_title": "介護保険事務処理システム変更に係る参考資料（その3）（令和8年4月30日事務連絡）",
  "parent_page_published_at": "2026-04-30",
  "parent_page_updated_at": "2026-04-30",
  "pdf_filename": "20260416_004.pdf",
  "pdf_size_bytes": 1887737,
  "pdf_pages": 406,
  "content_verified": true,
  "content_verified_at": "2026-05-10",
  "content_verified_by": "alpha.5.8.1 audit (CareLinker, pdfplumber実体確認)",
  "content_title": "介護給付費単位数等サービスコード表（案）（令和8年6月・8月施行版）",
  "content_verification_keywords": {
    "案_in_first_page": true,
    "介護給付費単位数_in_first_page": true,
    "サービスコード表_in_first_page": true
  },
  "source_kind": "provisional",
  "revision_status": "provisional_future",
  "checked_promotion_allowed": false,
  "audit_note": "r8_6_8_provisional_future_not_used_for_checked",
  "relation_to_2026_04_20": "same_pdf_under_new_parent_page",
  "document_version": "R8.6.1 / R8.8.1（案・その3）",
  "effective_from": "2026-06-01"
}
```

---

## 12. R8.6 PDF title 確認結果

`pdfplumber` で実体ダウンロード（1,887,737 bytes / 406 pages）し、表紙テキストを検証:

```
Ⅰ-資料2②
介護給付費単位数等サービスコード表（案）
（令和８年６月・８月施行版）
介護サービス
Ⅰ 居宅サービスコード
１ 訪問介護サービスコード表 1
２ 訪問入浴介護サービスコード表 108
３ 訪問看護サービスコード表 109
...
```

検証結果:
- `案` 文字 in 表紙: ✅ True
- `介護給付費単位数` in 表紙: ✅ True
- `サービスコード表` in 表紙: ✅ True
- 「（案）」表記の確定: PDFタイトル本体に明示

→ **本資料は確定版ではなく案資料**。`source_kind=provisional` / `revision_status=provisional_future` を維持。

---

## 13. R8.6案を checked に使っていない確認

### コード側の防御
1. `import_receipt_pdf.resolve_current_source_for_date()`:
   - `source_kind != "definitive"` を除外（既存）
   - alpha.5.8.1で `checked_promotion_allowed is False` を追加除外（二重防御）
2. `import_receipt_pdf.get_definitive_sources_for_period()`: 同上の除外を追加

### テストでの保護
- `test_alpha_5_8_1_r8_6_not_returned_by_resolve_for_2026_06`: 2026-06-01 / 2026-09-01 両方で `None` 返却を assert
- `test_alpha_5_8_1_r8_6_2026_04_30_checked_promotion_not_allowed`: registry で `checked_promotion_allowed=false` を assert
- `test_alpha_5_8_1_future_candidate_items_are_not_checked`: 2件の future_candidate_only kasan が overall=checked / mapping=checked に**ならない**ことを assert
- `test_provisional_future_does_not_promote_to_checked`（既存）も継続

### registry 側の表現
`target_period_resolution_rules.rules` の 2026-06-01 〜 のエントリで `current_source_id: null` を維持。`checked_promotion_allowed_filter` ノートを追加。

---

## 14. checked 20件 維持確認

`test_alpha_5_8_1_keep_checked_total_is_20`:

| サービス | keep_checked件数 |
|---|---:|
| 訪問看護 | 14 |
| 通所介護 | 6 |
| 訪問介護 | 0 |
| 居宅介護支援 | 0 |
| **合計** | **20** |

alpha.5.7.2 / alpha.5.8 / alpha.5.8.1 を通して 20件すべて維持。新規昇格 0件・降格 0件。

---

## 15. public release pack 未変更確認

| ファイル | diff |
|---|---|
| `out/sample_houmon_kaigo_report_public.md` | 0 |
| `out/sample_houmon_kango_kaigo_report_public.md` | 0 |
| `out/sample_kyotaku_shien_report_public.md` | 0 |
| `out/public_release_note.md` | 0 |

alpha.5.3 / alpha.5.4 公開デモ pack は完全に未改変。alpha.5.8.1 では public release pack を新規作成しない。

---

## 16. 未解決リスク（次フェーズ持ち越し）

1. **needs_master_review 28件のマスタ訂正**:
   - 訪問介護7件・居宅介護支援16件・通所介護4件・訪問看護1件の社内コード体系の根本見直し
   - alpha.5.9+ で社長／業務担当のレビュー
2. **needs_legal_review 5件**:
   - 訪問看護 複数名×4 + 長時間訪問看護加算の法令解釈通知精読
3. **R8.6.1 確定版が出るまで current_source_id は null**:
   - `resolve_current_source_for_date` は 2026-06-01 以降 None を返す
   - 確定版が出たら `WAM_R8_6_8_PROVISIONAL_2026_04_30` を `historical` に降格 + 新 source 登録
4. **alpha.5.8 audit report Section 7-3 の narrative**:
   - 一部内訳（通所介護6加算 / 訪問介護13加算 等）に narrative数値の不整合が残存。本 hotfix では新 report で正解値を提示し、旧 report 冒頭に注意書きを追加するに留めた

---

## 17. 学び（lessons learned）

1. **narrative数値は machine集計値で必ず再生成する**: 手書きの narrative は集計ロジックの仕様（社内コード空判定など）と乖離しやすい。alpha.5.9+ では report 生成スクリプトを設けて narrative も自動化する候補
2. **invariant のテスト化**: 合計件数・1件1値の不変条件を test で固定すると、master JSON 編集時に自動的に protect される
3. **provisional source の defense-in-depth**: `source_kind` だけでなく `checked_promotion_allowed` を明示化することで、案資料が誤って current として扱われるリスクを二重防御化
4. **PDF実体検証は alpha.5.8 段階で実施すべきだった**: alpha.5.8 で「URL未取得」placeholder にしたが、alpha.5.8.1 で `pdfplumber` 経由 1分で検証できた。次回は同セッション内で実施

---

_本レポートは社内 audit 用。public release pack には含めない。_
