# alpha.5.7.2 Effective Period Hotfix Report

**監査日**: 2026-05-10
**監査者**: alpha.5.7.2 audit (CareLinker)

---

## 0. 経緯と修正前の問題

alpha.5.7.1 で source anchor を 2025-02-01 (案) → 2025-03-28 (確定版) に修正したが、**revision_status が effective period と整合していなかった**:

- R7.4 確定版 (effective 2025-04-01 〜 2025-07-31) を `current_definitive` のまま維持
- 2026-05-10 (現在) は実際には R7.8 期間（effective 2025-08-01 〜 2026-05-31）
- → R7.4 を **historical_definitive** へ降格し、R7.8 を **current_definitive** へ昇格させる必要があった

---

## 1. 修正後の Source Registry 一覧

| source_id | source_kind | revision_status | effective_from | effective_to |
|---|---|---|---|---|
| WAM_R6_4_PROVISIONAL_2024_03_18 | provisional | provisional_historical | 2024-04-01 | 2024-05-31 |
| WAM_R6_6_8_DEFINITIVE_2024_05_07 | definitive | historical_definitive | 2024-06-01 | 2025-03-31 |
| WAM_R7_4_PROVISIONAL_2025_02_01 | provisional | provisional_historical | 2025-04-01 | (null) |
| **WAM_R7_4_DEFINITIVE_2025_03_28** ⬇降格 | definitive | **historical_definitive** | 2025-04-01 | 2025-07-31 |
| **WAM_R7_8_DEFINITIVE_2025_03_28** ⬆昇格 | definitive | **current_definitive** | 2025-08-01 | 2026-05-31 |
| WAM_R8_6_8_PROVISIONAL_2026_04_20 | provisional | provisional_future | 2026-06-01 | (null) |

---

## 2. R7.4 / R7.8 / R8.6.1案 の effective period

### R7.4 確定版（historical_definitive）
- source_id: `WAM_R7_4_DEFINITIVE_2025_03_28`
- effective: 2025-04-01 〜 2025-07-31（R7.4 期間）
- 用途: historical audit / R7.4対象月の再検証
- alpha.5.7.2 で current_definitive → historical_definitive に補正

### R7.8 確定版（current_definitive）
- source_id: `WAM_R7_8_DEFINITIVE_2025_03_28`
- URL: https://www.wam.go.jp/gyoseiShiryou-files/documents/2025/0325232829413/20250328_006.pdf
- effective: 2025-08-01 〜 2026-05-31（R7.8 期間）
- 用途: 2026年5月時点の current definitive
- alpha.5.7.2 で実体PDF取得・R7.4 と差分0確認・current_definitive へ昇格

### R8.6.1 案（provisional_future）
- source_id: `WAM_R8_6_8_PROVISIONAL_2026_04_20`
- URL: https://www.wam.go.jp/gyoseiShiryou-files/documents/2026/0414224940739/20260416_004.pdf
- effective: 2026-06-01 〜 (継続)
- 用途: provisional_future / future_candidate のみ
- **checked 昇格には絶対に使用しない**

---

## 3. checked 20件の R7.8 再検証結果

### 比較方法
pdfplumber で R7.4 (`20250328_005.pdf`) と R7.8 (`20250328_006.pdf`) の加算行を抽出し、code/name/unit を比較。

### 結果サマリ

| サービス | 加算行数 | R7.4 vs R7.8 差分 |
|---|---:|---|
| 訪問看護 | 21 | **0件 (全件一致)** |
| 通所介護 | 29 | **0件 (全件一致)** |

### checked 20件 全件 keep_checked

**訪問看護（介護保険）— 14件 (alpha.5.7.2 keep_checked)**:
- tokubetsu_kanri_kasan_I/II
- kango_taisei_kyouka_kasan_I/II
- service_taisei_kyouka_kasan_I/II
- taiin_kyoudou_shidou_kasan
- kango_kaigo_renkei_kyouka_kasan
- kinkyu_houmon_kango_kasan_I/II
- terminal_care_kasan
- shokai_kasan_I/II
- koukuu_renkei_kyouka_kasan

**通所介護 — 6件 (alpha.5.7.2 keep_checked)**:
- kobetsu_kinou_I_i (155051)
- kobetsu_kinou_I_ro (155053)
- kobetsu_kinou_II_life (155052)
- nyuyoku_I (155301)
- eiyou_assessment (156116)
- kagakuteki_kaigo (156361)

各 audit に `alpha_5_7_2_r7_8_current_definitive_reconfirmed` フィールドを追加し、`source_id: WAM_R7_8_DEFINITIVE_2025_03_28`、`match_type: exact_match`、`diff_from_r7_4: no_diff` を記録。

### downgraded / needs_review 一覧

**該当なし**（PDF byte-equivalent で差分0のため）

### pattern_based_unverified 維持一覧（変化なし）

| サービス | 件数 |
|---|---:|
| 訪問看護 | 7（科学的介護・R8.6処遇改善・複数名×4・長時間） |
| 通所介護 | 7（code_mismatch 6 + not_found 1） |
| 訪問介護 | 13（全件 code_mismatch / not_found） |
| 居宅介護支援 | 18（全件 code_mismatch / not_found） |

---

## 4. target_period helper 実装

`scripts/import_receipt_pdf.py` に2つのヘルパー関数を追加:

### `resolve_current_source_for_date(service_key, target_date)`
指定年月（YYYY-MM-DD）の current source を返す。

判定ロジック:
- effective_from <= target_date <= effective_to かつ source_kind=definitive のものを優先
- 該当が複数あれば revision_status=current_definitive を最優先
- 該当なし（R8.6 案期など）は None

期待挙動（テスト済）:
| 対象日 | 結果 |
|---|---|
| 2025-06-01 | R7.4 (historical_definitive・対象期間) |
| 2026-05-09 | R7.8 (current_definitive) |
| 2026-06-01 | None (R8.6案は provisional のため checked source として返さない) |

### `get_definitive_sources_for_period(service_key, start_date, end_date)`
指定期間に effective な全 definitive sources を返す（連続切り替えの可視化用）。

---

## 5. R8.6.1 案資料の扱い

- source_kind: provisional 維持
- revision_status: provisional_future 維持
- 親ページに「（その2）」（案）明記
- **checked 昇格には使われない**（テスト `test_r8_6_provisional_not_used_for_checked_promotion` で保証）
- public sample / レポートで「R8対応済み」と読める表現は禁止

---

## 6. サービス別 mapping_status 集計（変化なし）

| サービス | checked | not_applicable | pattern_unverified | 計 |
|---|---:|---:|---:|---:|
| houmon_kango_kaigo | **14** | 1 | 7 | 22 |
| tsusho_kaigo | **6** | 0 | 7 | 13 |
| houmon_kaigo | 0 | 0 | 13 | 13 |
| kyotaku_shien | 0 | 0 | 18 | 18 |
| **合計** | **20** | 1 | 45 | 66 |

alpha.5.7.1 比 ±0（hotfix のため件数変化なし、effective period 整合のみ）

---

## 7. 学び（lessons learned）

1. **revision_status は effective period と現在日付で動的に判定すべき**: alpha.5.7.1 では R7.4 を current_definitive のまま固定していたが、本来は対象日付に応じて current/historical を切り替える
2. **target_period helper の実装が重要**: `resolve_current_source_for_date(service, target_date)` を導入し、対象年月から自動的に current source を選べるようにした
3. **provisional_future は checked source として返さない**: R8.6.1案 (effective 2026-06-01〜) は対象期間でも provisional のため None を返す
4. **PDF byte-equivalent comparison が前提**: R7.4 と R7.8 のように同一内容で source_id だけ違う場合は diff=0 確認した上で reconfirm を audit に記録

---

## 8. 未解決リスク

- **R8.6.1 案資料の content 取得**: URL 登録済だが PDF実体検証は未実施。取得しても source_kind=provisional 維持
- **R8.6 確定版が出たときの自動切り替え**: 現在は手動で revision_status を更新。将来的に確定版検出 → current_definitive 昇格を自動化する仕組みが望ましい
- **訪問介護・居宅介護支援の社内コード体系**: 31加算 不整合は alpha.5.7.2 でも未解消（マスタ訂正は別途レビュー後）

---

_本レポートは社内 audit 用。public release pack には含めない。_
