# What Changed Since alpha.5.4

**version**: alpha.5.12-kimura-cio-handoff
**base_commit**: `db031d49134fe6d89bceba5931c8a0569857c6f7`
**generated_at**: 2026-05-10

---

## 概要

alpha.5.4 公開デモ版（2026-05-06）以降、**11 リリース** を経て alpha.5.12 に到達。
今回の進化は **外部公開機能の追加ではなく、内部監査・承認基盤の整備** です。

```
alpha.5.4 公開デモ
   ↓ (内部監査・承認基盤の構築)
alpha.5.5 → 5.6 → 5.7 → 5.7.1 → 5.7.2 → 5.8 → 5.8.1 → 5.9 → 5.10 → 5.11 → 5.12
   ↓ (人間レビュー投入準備完了)
[現在] 木村CIO に reviewer 任命を依頼するハンドオフ
```

---

## リリースごとの変更点

### alpha.5.5: service_code_mapping_status の導入
**何をしたか**: 各加算に「公式コードと社内コードの照合状態」を `service_code_mapping_status`
として明示。値: `checked` / `pattern_based_unverified` / `not_applicable` / `source_required` / `unknown`。

**なぜ重要か**: それまで「PDF パターン検出さえ通れば算定中扱い」していた状態を、
**公式コードに紐づくか否か** で 1 段細かい区分に分けた。これが alpha.5.6 以降の根拠強化の土台。

**外部影響**: 公開サンプルの脚注・disclaimer に「`pattern_based_unverified`」の意味を追記。

---

### alpha.5.6: definitive source revalidation
**何をしたか**: WAM NET 公式 PDF（令和 6 年 6 月・8 月施行版・確定版）を **実体ダウンロード**
して照合し、訪問看護 14 件の checked 化根拠を確定版 PDF に揃えた。

**なぜ重要か**: alpha.5.5 までは「案資料」で照合していた疑いがあり、確定版で再検証
することで **法的根拠の質が上がった**。alpha.4.5 時点の checked 14 件はそのまま維持。

**外部影響**: なし（既存公開サンプルの数字に変更なし）。

---

### alpha.5.7: source registry
**何をしたか**: 公式 PDF を `regulatory_master/sources/kaigo_service_code_sources.json`
の **source registry** で一元管理。`source_id` / `source_kind` / `revision_status` /
`effective_from` / `effective_to` を全 source に付与。通所介護 6 件を新たに checked 化。

**なぜ重要か**: 「どの公式 PDF が当時 current だったか」を後から再現可能に。
通所介護 6 件 (個別機能Ⅰイ/Ⅰロ/Ⅱ・入浴Ⅰ・栄養アセスメント・科学的介護推進)
が確定版で照合済 → checked 20 件体制が確立。

**外部影響**: なし（master JSON 内部のみ）。

---

### alpha.5.7.1: source anchor hotfix
**何をしたか**: alpha.5.7 で R7.4 を `current_definitive` 扱いしていたが、親ページが
「（その2）」（案・予備版）であることに気付き、`provisional` に降格。確定版
（令和7年3月28日事務連絡）の PDF に source_url を訂正。

**なぜ重要か**: alpha.5.5 と同じ「案資料を確定版扱いしてしまった」失敗の再発を防いだ。
今後は親ページの `その N` 表記とリンクラベルの「案」記載を必ず確認する運用ルールを文書化。

**外部影響**: なし。

---

### alpha.5.7.2: effective-period hotfix
**何をしたか**: R7.4.1 の `effective_to` が 2025-07-31 で終了していることを発見。
2026-05 時点の `current_definitive` は **R7.8.1**（令和7年8月施行版）であることを
明示し、`resolve_current_source_for_date()` / `get_definitive_sources_for_period()`
ヘルパー関数を実装。

**なぜ重要か**: 「現在から見て、ある日付の current source は何か」を機械的に判定
できるようになった。R7.4.1 と R7.8.1 の PDF 差分は **0**（訪問看護 21 / 通所介護 29
コード行とも完全一致）であることも検証済。

**外部影響**: なし。

---

### alpha.5.8: three-layer code model
**何をしたか**: 各加算を **3 つの層** に分けて記録:
1. `official_code_model` — 公式 PDF のコード・単位
2. `receipt_detection_model` — レセプト PDF 検出パターン
3. `internal_legacy_model` — 社内マスタの legacy code

**なぜ重要か**: 社内 legacy code（例: 訪問介護の 116XXX 系）と公式コード（114XXX 系）
の **不一致を破壊せずに可視化** できた。一括置換せず安全に段階対応する基盤が完成。
未解決 46 件を `proposed_action` で 6 種類に分類:
- needs_master_review 28 / needs_legal_review 5 / keep_pattern_based_unverified 10 /
  future_candidate_only 2 / not_applicable_confirmed 1

**外部影響**: なし。

---

### alpha.5.8.1: source metadata hotfix
**何をしたか**: R8.6 案資料（「その3」令和8年4月30日事務連絡）の URL を充足し、
PDF 実体（`pdfplumber` で取得）を確認。表紙に「（案）」表記があることを検証。
`checked_promotion_allowed=false` を明示化し、二重防御フィルタを `resolve_current_source_for_date`
に追加。`alpha_5_8_1_proposed_overall_divergence_note` で divergent 3 件の理由を記録。

**なぜ重要か**: R8.6.1 案資料が誤って checked 化に使われるリスクを **コード側で
ガード**。divergent（proposed_action と overall_mapping_status の分岐）3 件の理由を
audit_note 化し、後続フェーズで「本物の不整合か」を誤読しないように。

**外部影響**: なし。

---

### alpha.5.9: master review packet
**何をしたか**: needs_master_review 28 件 + needs_legal_review 5 件 + divergent 3 件
+ future_candidate_only 2 件 = **38 件のレビュー対象** を、人間が読める CSV / Markdown
パケットにまとめた。

**生成物**:
- `needs_master_review_matrix.csv`（28 件 × 27 列・UTF-8 BOM・Excel 互換）
- `needs_legal_review_matrix.csv`（5 件 × 18 列）
- `divergent_mapping_review.md`（3 件の説明）
- `future_candidate_review.md`（2 件 + R8.6.1 確定版が出た場合の手順）
- `reviewer_decision_template.csv`（38 件の決定記録テンプレ）
- `master_review_summary.md` / `README.md` / `manifest.json`

**なぜ重要か**: 「どの加算を誰がいつまでにレビューする必要があるか」を **人間が
管理しやすい形** で提示できた。

**外部影響**: なし（内部 review 資料）。

---

### alpha.5.10: reviewer decision gate
**何をしたか**: reviewer が入力した CSV を読み込んで **承認可能 / ブロック / 保留 /
法令確認待ち** に分類するバリデーションゲート。

**判定ルール**（10 段階）:
1. 重複行 → blocked
2. master JSON 未登録 kasan → blocked
3. 完全空欄 → pending
4. 不正 reviewer_decision → blocked
5. 不正 implementation_allowed → blocked
6. impl=yes 必須フィールド欠落 → blocked
7. needs_legal_review → legal_review_required
8. future_candidate_only 非 defer → blocked
9. impl != yes → pending
10. 通常ルート（modifying / non-modifying / escalate / defer）

**なぜ重要か**: reviewer 入力ミスを **master JSON 反映前に機械的に止められる**。
「approved に何が入っているか」が常に保証される。

**外部影響**: なし。

---

### alpha.5.11: reviewer handoff workbook
**何をしたか**: alpha.5.9 + alpha.5.10 を前提に、reviewer が **Excel で判断入力できる**
内部レビュー用ワークブック（8 シート・26.5KB）を生成。

**主要シート**:
- Decision_Input_All（38 件の入力シート・プルダウン・色分け）
- Needs_Master_Review（28 件・業務担当向け参照）
- Needs_Legal_Review（5 件・法令確認者向け参照）
- Divergent / Future_Candidate（参照のみ）
- Valid_Values（選択肢一覧）
- Gate_Instructions（export → gate 再実行手順）

**なぜ重要か**: CSV だけでは入力ミスが起きやすい。**Excel プルダウンで選択肢を
強制** することで blocked 件数を減らせる。

**外部影響**: なし。

---

### alpha.5.12: reviewer workflow hardening
**何をしたか**: alpha.5.11 ワークブックを運用面で強化:
1. **legal_review_clearance** 列を追加（needs_legal_review の手前ゲート）
2. **Excel 備考欄 export 拡張**（reviewer_role / review_note / implementation_priority /
   implementation_risk_acknowledged 等の 7 列追加）
3. **sample reviewed fixture**（12 シナリオで gate の全分岐を網羅検証）
4. **alpha.5.10 gate 拡張**（後方互換あり・legacy 9 列 / extended 16 列両対応）
5. **高リスク decision の risk_ack=yes 必須化**（correct_internal_legacy_code 用）

**なぜ重要か**: 実 reviewer 投入前に「**詰まらない運用**」を sample で実証できた。
特に `correct_internal_legacy_code`（社内コード置換）は PDF 検出回帰必須の高リスク
変更なので、reviewer が明示的にリスク認識した上でしか進められないようになった。

**外部影響**: なし。

---

## 累計の変更ファイル数

| 種別 | ファイル |
|---|---|
| Master JSON | **業務データは無変更**（`_meta` の audit version のみ更新）|
| 公開リリースパック (`releases/public/`) | **完全未改変** |
| 公開サンプル (`out/sample_*_public.md`) | **完全未改変** |
| 内部 audit レポート (`out/internal/alpha5_*`) | 多数（全て `out/internal/` 配下のみ）|
| Python スクリプト (`scripts/`) | gate / export / packet generator など多数 |
| テスト (`tests/`) | 221 テスト pass（alpha.5.4 時点から +約 100 件）|

---

## なぜ「外部機能ではなく内部基盤」を優先したか

alpha.5.4 公開デモ版は **「外側のスキン」** （見栄え・disclaimer・サンプル）が完成。
この上で外部に営業・契約を進めるには、**「中身の根拠」** が必要でした。

具体的に避けたかったリスク:
1. **公式コード未照合のまま外販** → 顧客から「この加算判定の根拠は何ですか？」と
   聞かれて答えられない
2. **社内 legacy code の上書き** → PDF 検出が壊れて既存サンプルレポートが動かなくなる
3. **R8.6 案資料を根拠扱い** → 6 月以降に確定版と差分が出たら全顧客に訂正連絡が必要
4. **法令解釈の自動判断** → 複数名・長時間訪問看護加算の構造解釈を間違えると
   行政指導につながる可能性

alpha.5.5〜alpha.5.12 はこれらを **コードと運用フローでガード** する作業でした。

---

## 次フェーズの想定（alpha.5.13+）

alpha.5.12 の handoff を受けて木村CIO が reviewer を任命したあと:

| バージョン | 内容 |
|---|---|
| alpha.5.13 | reviewer 入力済 CSV に対する **dry run**（master JSON 適用シミュレーション・実反映なし） |
| alpha.5.14 | approved 行のうち **低リスク decision** から段階的に master JSON に適用（個別 PR） |
| alpha.5.15 | `correct_internal_legacy_code`（高リスク・PDF 検出回帰必須）の段階適用 |
| alpha.5.16+ | needs_legal_review 5 件の法令解釈確認結果を反映 |
| alpha.6 | R8.6.1 確定版（公開後）への切替 |

各段階で 4 サービス PDF 回帰 + 5 パターン回帰 + checked 20 件維持確認を必須実施。
