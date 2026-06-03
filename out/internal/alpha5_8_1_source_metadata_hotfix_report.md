# alpha.5.8.1 Lightweight Source Metadata Hotfix Report

**監査日**: 2026-05-10
**監査者**: alpha.5.8.1 source_metadata_hotfix (CareLinker)
**スコープ**: alpha.5.8 三層コードモデルを壊さず、R8.6「その3」 source registry の URL null / content未検証を補正し、proposed_action と overall_mapping_status の crosswalk を明文化する。**業務データ（kasan の proposed_action / overall_mapping_status の値）に変更はない**。**新規 checked 昇格・公式コードへの一括置換・公開リリースパック更新は一切行わない**。

---

## 1. 経緯

社長による alpha.5.8 集計の再確認で、以下が確定:

- proposed_action 合計 **66** ✓
- overall_mapping_status 合計 **66** ✓
- alpha.5.8 master JSON 業務データに不整合は**なかった**
- 前回 alpha.5.8.1 audit_metadata_hotfix で言及した「needs_master_review 件数不整合」は**撤回**

その上で、**proposed_action と overall_mapping_status は1対1対応ではない**ため、対応関係（crosswalk）と分岐理由を audit に明文化する必要がある。

---

## 2. 確定 proposed_action 集計（66件）

| proposed_action | 件数 |
|---|---:|
| keep_checked | 20 |
| needs_master_review | 28 |
| needs_legal_review | 5 |
| keep_pattern_based_unverified | 10 |
| future_candidate_only | 2 |
| not_applicable_confirmed | 1 |
| **合計** | **66** |

---

## 3. 確定 overall_mapping_status 集計（66件）

| overall_mapping_status | 件数 |
|---|---:|
| checked | 20 |
| needs_review | 36 |
| pattern_based_unverified | 9 |
| not_applicable | 1 |
| **合計** | **66** |

---

## 4. proposed_action / overall_mapping_status crosswalk

machine集計に基づく完全な crosswalk:

| proposed_action | → overall_mapping_status | 件数 | 備考 |
|---|---|---:|---|
| **keep_checked** | → checked | **20** | 1対1（マスタ業務データのまま）|
| **not_applicable_confirmed** | → not_applicable | **1** | 1対1（訪問看護対象外） |
| **needs_master_review** | → needs_review | **28** | 1対1（社内コードと公式コードの不一致・マスタ訂正レビュー対象） |
| **needs_legal_review** | → needs_review | **5** | 1対1（基本コードへの追加加算構造・法令解釈レビュー対象） |
| **future_candidate_only** | → pattern_based_unverified | **2** | 1対1。R8.6案資料のみが根拠のため確定版が出るまで pattern_based_unverified に隔離。**checked 昇格には使わない** |
| **keep_pattern_based_unverified** | → pattern_based_unverified | **7** | 公式コード not_found・確定版未収録 |
| **keep_pattern_based_unverified** | → needs_review | **3** | ← **唯一の divergence**。下記 §6 参照 |

### 検算

- **checked**: 20 (keep_checked) = 20 ✓
- **needs_review**: 28 (needs_master_review) + 5 (needs_legal_review) + 3 (keep_pattern_based_unverified divergent) = **36** ✓
- **pattern_based_unverified**: 7 (keep_pattern_based_unverified) + 2 (future_candidate_only) = **9** ✓
- **not_applicable**: 1 (not_applicable_confirmed) = 1 ✓
- **合計**: 20 + 36 + 9 + 1 = **66** ✓

---

## 5. 設計原則: なぜ 1対1 ではないのか

`overall_mapping_status` と `proposed_action` は **異なる目的**で設計されているため、すべての組合せが 1対1 ではない:

| 軸 | 設計目的 | 主な入力 |
|---|---|---|
| **overall_mapping_status** | 各加算が「どれくらい確実に検証済か」を示す**外部表示用ラベル** | `service_code_mapping_status` ＋ `official_code_status` |
| **proposed_action** | alpha.5.9+ で社内が**何をすべきか**（マスタ訂正 / 法令解釈 / 公式確定待ち / 維持）を示す**内部運用ラベル** | `official_code_status` ＋ `internal_codes` の有無 ＋ kasan_key パターン |

→ 同じ「needs_review な状態」でも、**internal_codes が空かどうか**で proposed_action が分岐する:
- internal_codes 非空 → `needs_master_review`（社内マスタを公式コードへ訂正レビュー）
- internal_codes 空 → `keep_pattern_based_unverified`（マスタにそもそも登録がないので検出パターンで運用継続）

---

## 6. keep_pattern_based_unverified 10件 の overall_mapping_status 分布

実機械集計の内訳:

| overall_mapping_status | 件数 | 内訳 |
|---|---:|---|
| pattern_based_unverified | **7** | official_code_status=`not_found`（標準ケース） |
| needs_review | **3** | official_code_status=`needs_review` だが internal_codes が空 |

### 内訳7件（pattern_based_unverified · 標準ケース）
- 通所介護 `koukuu_kinou_II_life`（口腔機能向上加算Ⅱ）
- 訪問介護 `tokutei_jigyousho_I` 〜 `tokutei_jigyousho_V`（特定事業所加算Ⅰ-Ⅴ・5件）
- 居宅介護支援 `tokutei_jigyousho_IV`（特定事業所加算Ⅳ）

これらは全て `official_match_type=not_found` で、確定版PDFに該当公式コードが存在しないため `pattern_based_unverified` に分類。proposed_action も `keep_pattern_based_unverified` で一致（標準パス）。

### 内訳3件（needs_review · divergent ケース）

各加算の `service_code_audit.alpha_5_8_three_layer_model.alpha_5_8_1_proposed_overall_divergence_note` フィールドに理由を記録した:

| サービス | kasan_key | name | 分岐理由 |
|---|---|---|---|
| 訪問看護 | `shougu_kaizen_kasan_2026_06` | 介護職員等処遇改善加算（2026年6月臨時改定対象） | `match_type=out_of_definitive_scope`（R7.8確定版に未収録）→ `official_code_status=needs_review` (フォールスルー判定)。一方 `service_codes` が空のため proposed_action は `keep_pattern_based_unverified` に流れる。R8.6.1案は確定版でないので checked 昇格には使わない |
| 通所介護 | `adl_iji` | ADL維持等加算 | `official_code=156338` と社内 `service_codes` 空のため `code_mismatch` 相当 → `official_code_status=needs_review`。`service_codes` 空のため proposed_action は `needs_master_review` ではなく `keep_pattern_based_unverified` に流れる。社内マスタへのコード追加レビューが先決 |
| 通所介護 | `ninchi_kasan` | 認知症加算 | `official_code=155305` と社内 `service_codes` 空のため `code_mismatch` 相当 → `official_code_status=needs_review`。`service_codes` 空のため proposed_action は `keep_pattern_based_unverified` に流れる。社内マスタへのコード追加レビューが先決 |

### この divergence が生じた設計上の理由
`overall_mapping_status` は **「official_code_status の機械的反映」** で生成されるのに対し、`proposed_action` は **「社内が何をすべきか」** という運用判断で生成される。`internal_codes` が空のとき:
- official 側: `needs_review`（公式コードと一致しない事実は変わらない）
- 社内対応: 社内マスタにそもそもコードが登録されていないので「マスタ訂正」（needs_master_review）は表現として不正確 → `keep_pattern_based_unverified`（既存の検出パターンを維持しつつ要レビュー）に分類

このルールは alpha.5.9+ で社内コード追加レビュー時に再評価され、必要に応じて `service_codes` を追記後 `needs_master_review` または `checked` に昇格する想定。

---

## 7. R8.6「その3」 source registry 修正内容

`WAM_R8_6_8_PROVISIONAL_2026_04_30` の URL null / content未検証を解消（前回 commit `70280b2` で実施済を本 hotfix で正式採用）:

| field | 値 |
|---|---|
| source_id | `WAM_R8_6_8_PROVISIONAL_2026_04_30` |
| source_url | `https://www.wam.go.jp/gyoseiShiryou-files/documents/2026/0414224940739/20260416_004.pdf` |
| parent_page_url | `https://www.wam.go.jp/gyoseiShiryou/detail?gno=22523&ct=020050010` |
| parent_page_title | 介護保険事務処理システム変更に係る参考資料（その3）（令和8年4月30日事務連絡） |
| parent_page_published_at | 2026-04-30 |
| parent_page_updated_at | 2026-04-30 |
| pdf_filename | `20260416_004.pdf` |
| pdf_size_bytes | 1,887,737 |
| pdf_pages | 406 |
| **content_verified** | **true** |
| content_title | 介護給付費単位数等サービスコード表（案）（令和8年6月・8月施行版） |
| content_verification_keywords | `案_in_first_page=true` / `介護給付費単位数_in_first_page=true` / `サービスコード表_in_first_page=true` |
| document_version | R8.6.1 / R8.8.1（案・その3） |
| effective_from | 2026-06-01 |
| effective_to | null |
| **source_kind** | **provisional** |
| **revision_status** | **provisional_future** |
| **checked_promotion_allowed** | **false** |
| audit_note | `r8_6_8_provisional_future_not_used_for_checked` |
| relation_to_2026_04_20 | `same_pdf_under_new_parent_page` |

---

## 8. R8.6 PDF title 確認結果

`pdfplumber` 経由で実体検証（前回 commit `70280b2` で実施・本 hotfix で再確認）:

```
Ⅰ-資料2②
介護給付費単位数等サービスコード表（案）
（令和８年６月・８月施行版）
介護サービス
Ⅰ 居宅サービスコード
１ 訪問介護サービスコード表 1
...
```

- `案` 文字 in 表紙: ✅ **True**
- `介護給付費単位数` in 表紙: ✅ True
- `サービスコード表` in 表紙: ✅ True

→ **PDFタイトル本体に「（案）」表記が明示**。確定版ではない案資料であることが確定。

---

## 9. R8.6案を checked に使っていない確認

### コード側
- `import_receipt_pdf.resolve_current_source_for_date()` / `get_definitive_sources_for_period()` で:
  1. `source_kind != "definitive"` を除外（既存）
  2. `checked_promotion_allowed is False` を除外（alpha.5.8.1 で追加・二重防御）
- `target_period_resolution_rules`: 2026-06-01 〜 のエントリで `current_source_id: null` を維持

### テスト
- `test_alpha_5_8_1_r8_6_not_returned_by_resolve_for_2026_06`: 2026-06-01 / 2026-09-01 両方で `None` 返却を assert
- `test_alpha_5_8_1_r8_6_2026_04_30_checked_promotion_not_allowed`: registry で `checked_promotion_allowed=false` を assert
- `test_alpha_5_8_1_future_candidate_items_are_not_checked`: 2件の `future_candidate_only` kasan が overall=checked / mapping=checked に**ならない**ことを assert
- `test_alpha_5_8_1_provisional_future_does_not_promote_to_checked`（既存）も継続

---

## 10. checked 20件 維持確認

| サービス | keep_checked | overall_mapping_status=checked |
|---|---:|---:|
| 訪問看護 | 14 | 14 |
| 通所介護 | 6 | 6 |
| 訪問介護 | 0 | 0 |
| 居宅介護支援 | 0 | 0 |
| **合計** | **20** | **20** |

alpha.5.7.2 / alpha.5.8 / alpha.5.8.1 を通して 20件すべて維持。新規昇格 0件・降格 0件。

---

## 11. 公開リリースパック未変更確認

| ファイル / フォルダ | diff |
|---|---|
| `out/sample_houmon_kaigo_report_public.md` | 0 |
| `out/sample_houmon_kango_kaigo_report_public.md` | 0 |
| `out/sample_kyotaku_shien_report_public.md` | 0 |
| `out/public_release_note.md` | 0 |
| `releases/public/v2026.05.06-alpha.5.3/` | 0 |
| `releases/public/v2026.05.06-alpha.5.4/` | 0 |

alpha.5.3 / alpha.5.4 公開デモ pack は完全に未改変。alpha.5.8.1 では公開リリースパックを新規作成しない。

---

## 12. 未解決リスク（次フェーズ持ち越し）

1. **needs_master_review 28件のマスタ訂正**: 訪看1・通所4・訪介7・居宅16 の社内コード体系の根本見直し（alpha.5.9+）
2. **needs_legal_review 5件**: 訪看 複数名×4 + 長時間訪看の法令解釈通知精読
3. **keep_pattern_based_unverified divergent 3件**: 通所 ADL維持・認知症加算は社内マスタへのコード追加で `needs_master_review` 経由 `checked` 昇格候補。訪看 R8.6処遇改善は確定版が出てから再評価
4. **R8.6.1 確定版が出るまで `current_source_id=null`**: 2026-06-01 以降の current source は不在。確定版が出たら `WAM_R8_6_8_PROVISIONAL_2026_04_30` を `historical` に降格 + 新 source 登録
5. **Section 7-3 の narrative自動化**: alpha.5.8 audit report の narrative数値は手書きで、machine集計と乖離リスク。alpha.5.9+ で生成スクリプト化を検討（**ただし alpha.5.8 master JSON 業務データは正しかったので緊急性なし**）

---

## 13. 学び

1. **proposed_action と overall_mapping_status は1対1ではない**: 異なる目的を持つ2軸であり、`internal_codes` の有無で divergence が発生する。crosswalk を audit に明示することで、報告レビュー時の混乱を防ぐ
2. **divergence は audit_note で残す**: 機械的に説明できる divergence でも、`alpha_5_8_1_proposed_overall_divergence_note` フィールドに理由・基準を残すことで、後続の運用者が再判断するときの根拠になる
3. **public release pack は安易に上書きしない**: alpha.5.3 / alpha.5.4 のリリースパックは公開済の固定アーカイブとして扱い、内部 audit/hotfix では `out/internal/` 配下のみ更新する原則を継続

---

_本レポートは社内 audit 用。public release pack には含めない。_
