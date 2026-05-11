# alpha.5.8 Three-Layer Code Model Report

**監査日**: 2026-05-10
**監査者**: alpha.5.8 audit (CareLinker)

> 📎 **alpha.5.8.1 補足リンク**: 本レポートの集計値（proposed_action / overall_mapping_status）は machine集計に対し正しい。
> alpha.5.8.1 では追加で:
> - **crosswalk** （proposed_action と overall_mapping_status の対応関係）を [`alpha5_8_1_source_metadata_hotfix_report.md`](alpha5_8_1_source_metadata_hotfix_report.md) §4 に明文化
> - keep_pattern_based_unverified 10件の overall分布（pattern_based_unverified 7件 / needs_review 3件）を §6 に展開
> - R8.6「その3」 source registry の URL / content_verified を充足
>
> master JSON の業務データ（proposed_action / overall_mapping_status）は alpha.5.8 時点から
> 正しく機械集計されており、alpha.5.8.1 で**業務データに変更はない**（divergence 説明用の audit_note 3件を追加したのみ）。

---

## 0. 経緯と目的

alpha.5.7 系で公式サービスコード・PDF検出コード・社内legacyコードの混在が明確化:
- 通所介護: 6/13 が公式と一致、6 code_mismatch、1 not_found
- 訪問介護: 全件不整合（社内116XXX vs 公式114XXX/116192）
- 居宅介護支援: 全件不整合（社内438XXX vs 公式434XXX/436XXX）
- 訪問看護: 14/22 一致、5 structural_mismatch（複数名・長時間）、3 not_found

alpha.5.8 で **三層モデル**を導入し、一括置換せず安全に分離管理する。

---

## 1. R8.6 Provisional Source Refresh

| 項目 | 内容 |
|---|---|
| source_id | `WAM_R8_6_8_PROVISIONAL_2026_04_30` |
| parent_page_title | 介護保険事務処理システム変更に係る参考資料（その3）（令和8年4月30日事務連絡） |
| source_kind | provisional |
| revision_status | provisional_future |
| URL | null（alpha.5.8 時点でWAM NETから直接URL取得できず） |
| same_pdf_under_new_parent_page | 2026-04-20「その2」と同一PDF (`20260416_004.pdf`) を「その3」が参照する可能性が高い |
| 用途 | future_candidate のみ・**checked 昇格には使わない** |

---

## 2. 三層コードモデルの仕様

### 2-1. official_code_model

| field | 内容 |
|---|---|
| official_service_code | 公式サービスコード（6-8桁） |
| official_name | 公式表記名 |
| official_unit | 単位数 |
| official_calc_unit | 算定単位（1回・1月・1日） |
| official_service_type | サービス種別 |
| source_id | source registry の source_id |
| source_kind | definitive / provisional / draft / unknown |
| revision_status | current_definitive / historical_definitive / provisional_future / etc |
| effective_from / to | 施行期間 |
| official_match_type | exact_match / alias_match / unit_mismatch / structural_mismatch / service_type_mismatch / not_found / not_applicable / future_candidate |
| official_code_status | checked / needs_review / not_found / structural_mismatch / provisional_future / not_applicable |

### 2-2. receipt_detection_model

| field | 内容 |
|---|---|
| receipt_detection_code | PDF検出に使うコード（公式と一致しないこともある） |
| receipt_detection_name | 検出パターン名 |
| receipt_detection_pattern | regex パターン |
| receipt_detection_source | pdf_text / receipt_pattern / legacy_code / alias_pattern / unknown |
| receipt_detection_status | exact_official_code / alias_of_official_code / legacy_detection_only / pattern_detection_only / unknown |

### 2-3. internal_legacy_model

| field | 内容 |
|---|---|
| internal_legacy_code | 社内legacyコード |
| internal_legacy_name | 社内legacy表記名 |
| internal_legacy_unit | 社内legacy単位 |
| legacy_origin | 社内マスタ起源 / 帳票起源 / 移行前データ |
| keep_for_backward_compatibility | true/false（PDF検出継続のため残すか） |
| migration_note | alpha.5.8+ でのマスタ訂正方針メモ |

### 2-4. overall_mapping_status

`checked / checked_official_but_detection_unverified / pattern_based_unverified / needs_review / not_applicable / provisional_future`

---

## 3. 未解決45件＋ houmon_kango_kaigo 7件 = 46件の棚卸し結果

### サービス別 overall_mapping_status

| サービス | checked | needs_review | pattern_unverified | not_applicable | 計 |
|---|---:|---:|---:|---:|---:|
| **houmon_kango_kaigo** | **14** | 7 | 0 | 1 | 22 |
| **tsusho_kaigo** | **6** | 6 | 1 | 0 | 13 |
| houmon_kaigo | 0 | 7 | 6 | 0 | 13 |
| kyotaku_shien | 0 | 16 | 2 | 0 | 18 |
| **合計** | **20** | **36** | **9** | **1** | **66** |

### proposed_action 集計

| proposed_action | 件数 | 詳細 |
|---|---:|---|
| keep_checked | 20 | 訪問看護14 + 通所介護6（alpha.5.7.2 で確定） |
| **needs_master_review** | **28** | 社内コードと公式コードの不整合・マスタ訂正候補 |
| **needs_legal_review** | **5** | 訪問看護 複数名×4 + 長時間（基本コードへの追加加算構造） |
| keep_pattern_based_unverified | 10 | 公式コード not_found 等 |
| not_applicable_confirmed | 1 | 認知症専門ケア加算（訪問看護対象外） |
| future_candidate_only | 2 | R8.6処遇改善（訪問介護・居宅） |

---

## 4. official_code_status 集計

| status | 件数 |
|---|---:|
| checked | 20 |
| needs_review | 35 |
| not_found | 9 |
| structural_mismatch | 1 |
| not_applicable | 1 |

---

## 5. receipt_detection_status 集計

| status | 件数 |
|---|---:|
| exact_official_code | 20 |
| legacy_detection_only | 33 |
| pattern_detection_only | 12 |
| unknown | 1 |

→ **33加算が「公式コード未検証だが社内legacyコードでPDF検出は機能している」状態**。alpha.5.8 で明示化。

---

## 6. internal_legacy_code が残る一覧

`keep_for_backward_compatibility: true` の加算は 33件。社内 service_codes フィールドが PDF検出に使われており、PDF抽出を壊さないため legacy code を維持。

---

## 7. checked維持・新規昇格・非昇格

### 7-1. checked維持（20件）
alpha.5.7.2 の checked 20件すべて維持:
- 訪問看護 14件（特別管理Ⅰ/Ⅱ・看護体制Ⅰ/Ⅱ・サ提体強Ⅰ/Ⅱ・退院時共同・看護介護連携・緊急時Ⅰ/Ⅱ・ターミナル・初回Ⅰ/Ⅱ・口腔連携）
- 通所介護 6件（個別機能Ⅰイ/Ⅰロ/Ⅱ・入浴介助Ⅰ・栄養アセスメント・科学的介護推進）

### 7-2. 新規昇格（0件）
**該当なし**。社内マスタの不整合解消には法令解釈レビューが必要なため、alpha.5.8 では昇格しない（方針通り）。

### 7-3. checked にしなかった一覧と理由

| 加算 | 件数 | 理由 |
|---|---:|---|
| 訪問看護 複数名×4・長時間 | 5 | 基本サービスコードへの追加加算構造。独立コードなし。**needs_legal_review** |
| 訪問看護 科学的介護・R8.6処遇改善 | 2 | 公式コード not_found / out_of_scope |
| 通所介護 6加算（中重度者ケア・認知症加算等） | 6 | コード不整合（社内156XXX vs 公式155XXX/156XXX）。**needs_master_review** |
| 通所介護 not_found | 1 | 公式表に対応コードなし |
| 訪問介護 13加算 | 13 | 全件 code_mismatch / not_found。**needs_master_review** |
| 居宅介護支援 18加算 | 18 | 全件 code_mismatch / not_found。**needs_master_review** |

---

## 8. needs_master_review / needs_legal_review 一覧

### needs_master_review（28件）
社内マスタの service_codes と公式コードが不一致。法令解釈ではなくマスタ訂正レビューが必要:
- 通所介護: 入浴介助Ⅱ・中重度者ケア・認知症加算・ADL維持・口腔機能向上Ⅰ・栄養改善（社内コードと公式コードが異なる）
- 訪問介護: 全13加算（社内 116XXX 系 vs 公式 114XXX 系）
- 居宅介護支援: 16加算（社内 438XXX 系 vs 公式 434XXX/436XXX 系）

### needs_legal_review（5件）
基本サービスコードへの追加加算構造で、独立コードでマッピングできない:
- 訪問看護 複数名訪問看護加算 × 4区分（Ⅰ under30, Ⅰ over30, Ⅱ under30, Ⅱ over30）
- 訪問看護 長時間訪問看護加算

---

## 9. future_candidate / provisional_future（2件）

R8.6 処遇改善加算（訪問介護・居宅介護支援）が `future_candidate_only`。R8.6 確定版が出るまで checked 昇格しない。訪問看護の R8.6 処遇改善は alpha.5.7.2 から `pattern_based_unverified` で記録。

---

## 10. レポート表示方針（変更なし）

- ✅ 公式コード照合済み（checked）
- ℹ️ 帳票パターン検出・公式照合は要確認（pattern_based_unverified）
- ⚠️ 公式コードは確認済みだが帳票検出コードとの関係要確認（needs_review）
- 🚫 対象外（not_applicable）
- 🕒 将来改定案（provisional_future）

---

## 11. 学び（lessons learned）

1. **公式コードと社内legacyコードの分離が重要**: PDF検出に使っている社内コードは公式コードと異なる場合があるが、検出パターンとしては有効。三層モデルで両方を維持
2. **needs_master_review と needs_legal_review の区別**: コード差異は社内訂正で解決可能（前者）、構造差異は法令解釈レビューが必要（後者）
3. **一括置換は危険**: PDF検出を壊す可能性があるため、各加算個別にレビューが必要
4. **R8.6案を `future_candidate_only`** で隔離: 確定版が出るまで checked に使わない

---

## 12. 未解決リスク

- **needs_master_review 28件のマスタ訂正**: 訪問介護13・居宅介護支援16・通所介護6 の社内コード体系の根本見直しが必要（alpha.5.9+）
- **needs_legal_review 5件**: 複数名・長時間訪問看護加算の構造解釈は法令解釈通知の確認が必要
- **R8.6.1案 PDF実体検証**: URL未取得・代替で2026-04-20版を参照
- **2026-06-01 以降の current source**: R8.6 確定版が出るまで `resolve_current_source_for_date` は None を返す

---

_本レポートは社内 audit 用。public release pack には含めない。_
