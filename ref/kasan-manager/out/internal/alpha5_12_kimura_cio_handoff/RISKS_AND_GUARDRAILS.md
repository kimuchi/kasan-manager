# Risks and Guardrails

**version**: alpha.5.12-kimura-cio-handoff
**base_commit**: `db031d49134fe6d89bceba5931c8a0569857c6f7`
**generated_at**: 2026-05-10

---

## 全体方針: 攻めすぎない・壊さない・嘘を言わない

このプロダクトは介護事業所向けの加算チェッカーであり、行政指導・返還命令の
リスクが直接 reviewer / 顧客に及ぶ可能性があります。alpha.5.5〜alpha.5.12 の
基盤整備は **「攻めずに守る」** 方針で進めました。本ファイルは、reviewer 投入後も
維持すべきガードレールをまとめています。

---

## ガードレール 1: 外部公開しない

### 何を守るか

reviewer ワークブック・reviewer 入力済 CSV・内部 audit レポート・本ハンドオフパケット
は **すべて内部レビュー用資料** です。

### 具体的な禁止事項

- ❌ `out/internal/alpha5_*` 配下のファイルを `releases/public/` に**コピーしない**
- ❌ reviewer 入力済 CSV を顧客プレゼン資料に**貼り付けない**
- ❌ Excel ワークブックの中身（needs_master_review 28 件のリスト）を**外部公開しない**
- ❌ alpha.5.5 以降の audit レポート（三層モデル / hotfix report 等）を**外部に共有しない**

### 守られる仕組み

- すべての alpha.5.5〜5.12 成果物は `out/internal/` 配下に格納
- alpha.5.10 gate / alpha.5.11/5.12 ワークブック生成 script で path 検証 (テスト)
- public release pack ディレクトリ (`releases/public/v2026.05.06-alpha.5.3/` /
  `alpha.5.4/`) は alpha.5.5 以降 **完全未改変** (diff_lines=0)

### 例外: 公開してよいもの

- ✅ alpha.5.3 / alpha.5.4 の公開デモパック（既に公開済・未変更）
- ✅ `out/sample_*_report_public.md`（公開デモ用サンプル）
- ✅ 本パケットを **公開する場合** は CIO 承認 + 個人情報スキャン後に限る

---

## ガードレール 2: 算定可否を保証する表現を出さない

### 何を守るか

「この加算は算定可能です」と reviewer・顧客・利用者に断定することは絶対にしない。
公式コードと社内コードが照合済でも、**実際の届出・算定は自治体指導課の確認が必要**
であることを明記する。

### NG 表現（使用禁止）

- ❌ 「算定可否を保証します」
- ❌ 「公式コード完全照合済み」
- ❌ 「R8 改定対応済み」（R8.6.1 確定版が出るまで）
- ❌ 「PDF 未検出 = 未算定」（検出ロジックの限界を伝えていない）
- ❌ 「監査をパスしました」（社内 audit と行政監査は別物）

### OK 表現（既存 disclaimer の継続）

- ✅ 「算定可否を法的に保証するものではありません」
- ✅ 「取得候補・確認待ち項目・必要書類・増収目安を提示する支援ツールです」
- ✅ 「実際の届出・算定は各自治体の指導課・監査担当および顧問の社労士等に確認してください」
- ✅ 「公式根拠確認済み要件に対する機械的な充足推定」
- ✅ 「PDF から検出されないことは『未算定』を意味しません」
- ✅ 「個人情報は保存していません」

### 守られる仕組み

- alpha.5.10 gate / alpha.5.11/5.12 ワークブック生成 script に禁止語スキャンテストを実装
- 4 サービス公開サンプル (`sample_*_with_pdf_public.md`) の disclaimer 維持を回帰テスト
- alpha.5.3 / alpha.5.4 release pack の disclaimer は未変更

---

## ガードレール 3: master JSON を一括修正しない

### 何を守るか

reviewer の判断に従って master JSON を変更するのは **alpha.5.13+ で個別 PR にて
段階的にのみ** 行う。一括スクリプトでの全件反映は禁止。

### 守る理由

| リスク | 一括反映で起きること |
|---|---|
| PDF 検出パターン破壊 | 既存サンプルレポートが動かなくなる・顧客から問い合わせ |
| 公式コード照合の誤り混入 | reviewer 1 名の判断ミスが 28 件全件に波及 |
| 4 サービス回帰テスト不十分 | サンプル PDF で回帰検出できない問題が後から発覚 |
| checked 20 件維持失敗 | 既に確定済の根拠が崩れる |

### 守られる仕組み

- alpha.5.10 gate の出力 `approved_changes_preview.csv` は **候補提示のみ**
- alpha.5.11/5.12 ワークブック generator は master JSON を **読み取り専用**
- alpha.5.13+ の段階反映 PR で **1 PR = 1 加算 or 1 サービス** を原則とする
  （リグレッション切り分けのため）
- 各 PR で **4 サービス PDF 回帰 + 5 パターン回帰 + checked 20 件維持確認** を必須実施

---

## ガードレール 4: approved-only で進める

### 何を守るか

alpha.5.13+ で master JSON に反映するのは、alpha.5.10 gate で
`approved_changes_preview.csv` に入った行 **のみ** とする。

### 進めない行

- ❌ blocked（不正・不備）
- ❌ pending（記入待ち / non-modifying / deferred）
- ❌ legal_review_required（法令確認待ち）
- ❌ future_candidate_only（R8.6.1 確定版待ち）

### approved 行の質

approved に入るには alpha.5.10 gate で以下をすべて通過する必要があります:
1. 重複なし / master JSON に存在
2. reviewer_decision が valid 値
3. implementation_allowed = yes
4. 必須 6 フィールド全揃い (reviewer_decision / reason / required_evidence /
   reviewer_name / reviewed_at / final_approved_by)
5. needs_legal_review の場合は legal_review_clearance=cleared + reference あり
6. future_candidate_only ではない
7. 高リスク decision の場合は implementation_risk_acknowledged=yes

---

## ガードレール 5: high-risk decision は個別 PR で進める

### 何を守るか

`correct_internal_legacy_code`（社内コードを公式コードに置換）は **PDF 検出パターンを
直接書き換える可能性** があるため、最高リスク。これだけは alpha.5.15 で別 PR にて段階対応。

### 守る運用

- alpha.5.10 gate で `implementation_risk_acknowledged=yes` 必須化（既に実装済）
- alpha.5.11/5.12 ワークブックで濃オレンジ色強調 + プルダウン補助
- alpha.5.13 dry run でも他の decision と分けて検証
- alpha.5.14 では `approve_official_code_addition` / `add_receipt_alias` を先に進める
- alpha.5.15 で `correct_internal_legacy_code` を **1 PR = 1 加算** で進める

### 必須テスト

`correct_internal_legacy_code` を含む PR では:
- 該当加算の従来 PDF 検出が壊れていないこと（4 サービス回帰）
- 単位数の数値再計算が正しいこと
- 公開サンプルの該当行が想定通りに変化すること
- 他の checked 20 件には影響しないこと

---

## ガードレール 6: R8.6.1 案資料を checked に使わない

### 何を守るか

WAM_R8_6_8_PROVISIONAL_2026_04_30 / WAM_R8_6_8_PROVISIONAL_2026_04_20 は **案資料**
であり、確定版が出るまで根拠として使わない。

### 守られる仕組み（コード側ガード）

- registry の `source_kind=provisional` / `revision_status=provisional_future`
- registry の `checked_promotion_allowed=false`
- `resolve_current_source_for_date()` / `get_definitive_sources_for_period()` で
  二重防御（source_kind != definitive かつ checked_promotion_allowed=false で除外）
- alpha.5.10 gate で future_candidate_only 行は legal clearance があっても
  approved にしない

### 守られる仕組み（運用側ガード）

- future_candidate_only 2 件 (訪介 shougu_kaizen_kasan / 居宅 shougu_kaizen_kasan_2026_06)
  は reviewer ワークブックで `defer_until_r8_definitive` のみ受理（プルダウン補助）
- 確定版が出た場合は alpha.5.16+ で再評価（`alpha5_12_reviewer_workflow_hardening/
  legal_clearance_rules.md` に手順記載）

---

## ガードレール 7: PII / 業務機密を出力に混ぜない

### 何を守るか

被保険者番号・利用者氏名・職員氏名・給与額・実事業所コードを **すべての出力に
含めない**（公開・内部問わず）。

### NG 一覧

- ❌ 被保険者番号 10 桁
- ❌ 利用者氏名（フルネーム / 一部）
- ❌ 職員氏名（フルネーム / 一部）
- ❌ 給与額・賞与額・賃金単価
- ❌ 実事業所コード（特定 3 桁の市町村番号 + 7 桁の固有番号）
- ❌ 顧問社労士・弁護士の氏名（reviewer 入力欄でも避ける）

### OK 一覧（架空デモ）

- ✅ DEMO-0004 / 0005 / 0006 / 0007（架空事業所コード）
- ✅ sample_業務担当A / sample_最終承認者X（架空 reviewer 氏名）
- ✅ 架空の集計値・統計値

### 守られる仕組み

- alpha.5.5〜5.12 各 audit / packet 生成 script に禁止語スキャンテスト
- 公開サンプル disclaimer に「個人情報は保存していません」を明記
- reviewer 入力済 CSV は **public 配下に出さない**運用方針

---

## リスク分類別の対応マトリクス

| リスク種類 | 重度 | ガードレール | 監視方法 |
|---|---|---|---|
| 公開デモパック上書き | 致命 | 1 / 2 | release pack diff=0 を全フェーズで確認 |
| master JSON 業務データ改変 | 致命 | 3 / 4 | regulatory_master/kaigo/ diff=0 を全フェーズで確認 |
| checked 20 件維持失敗 | 高 | 3 / 4 | service_code_mapping_status=checked を 20 件で常時 assert |
| R8.6 案資料の checked 流入 | 高 | 6 | gate / source registry の二重防御 + 自動テスト |
| 算定保証表現の混入 | 高 | 2 | 禁止語スキャンを CI で実行 |
| PII 漏洩 | 致命 | 7 | 全出力ファイルで自動スキャン |
| reviewer 判断ミスの一括反映 | 高 | 5 | alpha.5.13 dry run + 個別 PR + 回帰テスト |
| 法令解釈の誤り | 中 | 4 | needs_legal_review は legal_reviewer の clearance 必須 |
| PDF 検出回帰 | 中 | 5 | 4 サービス PDF 回帰テストを各 PR で必須実施 |

---

## 既存 disclaimer（公開サンプルで維持）

以下の表現は alpha.5.4 公開デモから **完全に維持** されており、alpha.5.13+ でも継続:

> **⚠️ 重要なお断り**: 本レポートは加算算定可否を**法的に保証するものではありません**。
> 取得候補・確認待ち項目・必要書類・増収目安を提示する**支援ツール**です。
> 実際の届出・算定は各自治体の指導課・監査担当および顧問の社労士等に確認してください。

> **🧪 公開デモ用の架空サンプル**: 本レポートは公開デモ用の架空事業所コード・架空職員サマリ・架空証跡データを使用しています。実事業所のデータではありません。

> **📄 PDF取込モード**: 本レポートはレセプトPDFから抽出した算定中加算を反映しています。
> - PDFで検出された加算は **「算定中の推定」** です（要件充足を保証するものではありません）
> - PDFから検出されないことは **「未算定」を意味しません**（帳票形式・抽出ロジック未対応の可能性）
> - **個人情報は保存していません**（被保険者番号・氏名・住所・電話番号は意図的に非抽出）

---

## 木村CIO への約束（alpha.5.4 → alpha.5.12）

1. **公開デモパックは触っていません**: alpha.5.3 / alpha.5.4 の出力は完全未改変
2. **業務データは無変更**: master JSON の kasan 業務フィールド・proposed_action・overall は同じ
3. **checked 20 件は維持**: 訪問看護 14 + 通所介護 6 = 20 件すべて
4. **R8.6 案を checked 化していません**: future_candidate_only 2 件は defer のまま
5. **算定保証の表現は出していません**: disclaimer 維持
6. **個人情報は保存していません**: 集計値・統計値のみ
7. **reviewer 入力ファイルを public に出しません**: 内部運用方針として明文化

これらは **221 個の自動テスト** で常時保護されており、alpha.5.13+ でも継続適用されます。
