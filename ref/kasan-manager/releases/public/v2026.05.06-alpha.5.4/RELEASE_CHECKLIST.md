# リリース判断チェックリスト v2026.05.06-alpha.5.4

公開デモ版リリース前に必ず通すチェックリストです。すべて pass してからリリース判断します。

---

## 0. 事前確認

- [x] ベースコミット c756d90 が remote に push 済み（alpha.5.4 user_summary bridge）
- [x] alpha.5.3 release pack（c339eff）は固定扱いで上書きしていない
- [x] worktree clean（実コミット対象の未コミット変更なし）
- [x] 現在ブランチ `claude/hopeful-galileo-a96fda` を確認

## 1. 8ファイル存在確認

- [x] `releases/public/v2026.05.06-alpha.5.4/README.md`
- [x] `releases/public/v2026.05.06-alpha.5.4/PRODUCT_OVERVIEW.md`
- [x] `releases/public/v2026.05.06-alpha.5.4/DEMO_SCRIPT.md`
- [x] `releases/public/v2026.05.06-alpha.5.4/SAMPLE_REPORTS_INDEX.md`
- [x] `releases/public/v2026.05.06-alpha.5.4/KNOWN_LIMITATIONS.md`
- [x] `releases/public/v2026.05.06-alpha.5.4/DATA_SAFETY.md`
- [x] `releases/public/v2026.05.06-alpha.5.4/RELEASE_CHECKLIST.md`（本書）
- [x] `releases/public/v2026.05.06-alpha.5.4/RELEASE_MANIFEST.json`

## 2. JSON valid 確認

- [x] RELEASE_MANIFEST.json が機械可読
- [x] 全 JSON ファイル（マスタ・evidence_labels等）が構文上有効

## 3. 既存テスト全PASS

- [x] test_requirement_dsl.py（DSL evaluator単体）
- [x] test_judge_requirement_dsl.py（judge×DSL連携）
- [x] test_evidence_checklist.py（不足証跡）
- [x] test_tenant_status_facts.py（DEMO tenant_status）
- [x] test_staff_facts.py（DEMO staff データ・14テスト）
- [x] test_import_receipt_pdf.py（PDF取込）

## 4. 新規テストPASS（alpha.5.4）

- [x] test_user_summary_facts.py（DEMO 利用者集計・15テスト）
  - PII保護
  - 名前空間侵犯保護
  - 公開セクション非開示
  - --user-summary 有無の動作確認
  - source_required で clear しない
  - any 配下の代替ルート抑制
  - alpha.5.3 release pack の固定確認

## 5. 4サービスPDF回帰

- [x] 通所介護（DEMO-0004）→ `sample_tsusho_kaigo_with_pdf_public.md`
- [x] 訪問介護（DEMO-0005）→ `sample_houmon_kaigo_with_pdf_public.md`
- [x] 居宅介護支援（DEMO-0006）→ `sample_kyotaku_shien_with_pdf_public.md`
- [x] 訪問看護（介護保険）（DEMO-0007）→ `sample_houmon_kango_kaigo_with_pdf_public.md`

## 6. 5パターン既存サービス回帰

- [x] 訪問介護（基本レポート）
- [x] 居宅介護支援（基本レポート）
- [x] 通所介護（基本レポート）
- [x] 訪問看護（介護保険）（基本レポート）
- [x] 訪問看護（医療保険）（draft レポート・別管理）

## 7. PII / 禁止語 / 危険表現チェック

- [x] 実社名・実事業所コード・実職員名・実利用者名 → public ファイルに含まれない
- [x] 「算定可否を保証」表現 → 否定形のみ存在（「保証するものではありません」）
- [x] 「PDF未検出＝未算定」表現 → 含まれない
- [x] 「対象外加算が改善候補・収益機会に混入」 → 否定形のみ（「混入しない」）
- [x] 内部資料パス → public ファイルに含まれない
- [x] 内部用語 → public ファイルに含まれない
- [x] PII raw value（被保険者番号10桁・email・電話・生年月日）→ 検出なし

## 8. raw データ非表示チェック

- [x] **raw staff露出チェック**: staff_id の値・個別職員リスト → 含まれない
- [x] **raw tenant_status露出チェック**: 個別fact値の生露出 → 含まれない（公開向け日本語labelに変換済）
- [x] **raw user_summary露出チェック（alpha.5.4 追加）**: 内部fact path直接出力なし・利用者個票なし
- [x] **raw user個票露出チェック（alpha.5.4 追加）**: 利用者ID・名前・住所・生年月日 → 含まれない
- [x] 内部 fact path の生露出 → 公開向け日本語labelに変換済

## 9. DSL 安全弁

- [x] `source_status != checked` の要件は評価せず `not_evaluated_source_required`
- [x] `logic_status != checked` のロジックは評価せず `not_evaluated_logic_unchecked`
- [x] `applicability == not_applicable` の加算は評価せず `not_applicable`
- [x] `pattern_based_unverified` のmapping依存fact は `blocked_by_unverified_mapping`
- [x] `missing` / `unknown` / `waiting` / `null` 値は `blocked_by_missing_evidence`
- [x] `any` 配下の代替ルートで救われた条件は不足証跡から除外
- [x] **demo_aggregate_unverified を不正に clear 化していない（alpha.5.4）**

## 10. 公開サンプル注記

- [x] 各 sample_*_public.md に「🧪 公開デモ用の架空サンプル」相当の注記あり（冒頭に自動付与）
- [x] 利用者データ連携セクションに「個別利用者の氏名・被保険者番号等は表示しません（集計値のみ）」記載
- [x] 職員データ連携セクションに「個別の氏名・staff_id・資格詳細は表示しません（集計値のみ）」記載
- [x] 不足証跡チェックリストに「次アクション」列あり
- [x] レポート末尾に CareLinker 加算チェッカー / judge_kasan.py / `v2026.05.06-alpha.5.4` の署名

## 11. alpha.5.3 release pack 固定確認

- [x] `releases/public/v2026.05.06-alpha.5.3/` 配下の8ファイル全て **未変更**
- [x] alpha.5.3 RELEASE_MANIFEST.json の `release_version` = `v2026.05.06-alpha.5.3-public-demo.1`（不変）
- [x] alpha.5.3 RELEASE_MANIFEST.json の `base_commit` = `c32f313`（不変）

## 12. リリース判断

- [x] 限定外販MVP / 公開デモ版として提示可能
- [x] 営業デモで本リリースパックの DEMO_SCRIPT.md を使用可能
- [x] 公開サンプル4種を提示可能
- [x] 本番SaaSとして未対応の点は KNOWN_LIMITATIONS.md に明記済

---

_CareLinker / ケア・プランニング株式会社_
