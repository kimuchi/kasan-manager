# Executive Summary for Kimura CIO

**version**: alpha.5.12-kimura-cio-handoff
**base_commit**: `db031d49134fe6d89bceba5931c8a0569857c6f7` (alpha.5.12)
**handoff target**: 木村CIO
**generated_at**: 2026-05-10

---

## TL;DR (3行)

1. **alpha.5.4 公開デモ版 (2026-05-06) から alpha.5.12 までで進めたのは「外部機能」ではなく「内部監査・承認基盤」の整備**です。  公開デモパック (alpha.5.3 / alpha.5.4) の中身は **完全未改変** で、外部に出ているサンプルレポートに変更はありません。
2. 加算データ全 66 件のうち、公開向けに **公式コード照合済 (checked)** が確定しているのは **20 件 (訪問看護 14 + 通所介護 6)**。残り 46 件は「業務担当・法令確認者・最終承認者」のレビューが必要な状態を **見える化** しました。
3. 次に必要なのは **木村CIO による reviewer 任命** と、**Excel ワークブック（alpha.5.11/5.12 で作成）** を渡してレビューを開始する判断です。**現時点で master JSON への自動修正は一切行っていません**。

---

## 何が変わったか（alpha.5.4 公開デモ版 → alpha.5.12）

### 変わっていないもの（重要）
- **公開デモパック**（`alpha.5.3` / `alpha.5.4`）の出力ファイル
- **介護報酬 master JSON の業務データ**（kasan 業務フィールド・proposed_action・overall_mapping_status）
- **既に checked 化された 20 件の加算判定**
- **算定可否の保証表現**を出さない方針
- **R8.6 案資料を checked 昇格に使わない**方針

### 変わったもの
1. **公式 source の根拠強化**（alpha.5.5〜5.7.2）: WAM NET の公式 PDF を実体ダウンロードして照合し、`current_definitive` / `historical_definitive` / `provisional_future` を明確化
2. **三層コードモデルの導入**（alpha.5.8〜5.8.1）: `official_code_model` / `receipt_detection_model` / `internal_legacy_model` を分離し、社内 legacy code と公式コードの不一致を可視化
3. **レビュー基盤の整備**（alpha.5.9〜5.12）:
   - 28件の master review マトリクス（業務担当向け）
   - 5件の legal review マトリクス（法令確認者向け）
   - 38件の reviewer 決定テンプレート（最終承認者向け）
   - 入力検証ゲート（alpha.5.10）
   - Excel ワークブック（alpha.5.11/5.12）
   - sample fixture と 12 シナリオでの分岐検証

詳細は [`WHAT_CHANGED_SINCE_ALPHA5_4.md`](WHAT_CHANGED_SINCE_ALPHA5_4.md) を参照。

---

## 数字で見る現状（66 件の加算）

### overall_mapping_status

| status | 件数 | 意味 |
|---|---:|---|
| **checked** | **20** | 公式 PDF と社内マスタの単位・コード照合が済んでいる |
| **needs_review** | **36** | 公式コードと社内コードに差があるか、構造解釈が必要 |
| **pattern_based_unverified** | **9** | 公式 PDF に該当コードが見当たらず、検出パターンのみで運用 |
| **not_applicable** | **1** | 訪問看護では算定対象外 |
| **合計** | **66** | |

### proposed_action（次に何をすべきかの分類）

| proposed_action | 件数 | 主な担当 |
|---|---:|---|
| keep_checked | 20 | （現状維持） |
| **needs_master_review** | **28** | 業務担当（社内マスタ訂正の判断） |
| **needs_legal_review** | **5** | 法令確認者（複数名・長時間訪問看護加算の構造解釈） |
| keep_pattern_based_unverified | 10 | （記録のみ・追加作業なし） |
| **future_candidate_only** | **2** | （R8.6.1 確定版が出るまで保留） |
| not_applicable_confirmed | 1 | （対象外確定） |
| **合計** | **66** | |

### サービス別 needs_master_review 28件の内訳

| サービス | 件数 |
|---|---:|
| 訪問看護(介護) | 1 (科学的介護推進体制加算) |
| 通所介護 | 4 (中重度者ケア / 入浴Ⅱ / 口腔機能向上Ⅰ / 栄養改善) |
| 訪問介護 | 7 (社内 116XXX 系 vs 公式 114XXX 系) |
| 居宅介護支援 | 16 (社内 438XXX 系 vs 公式 434XXX/436XXX 系) |

---

## まだ外部公開版ではありません

このパケット一式（alpha.5.5〜alpha.5.12 で作った内部監査・レビュー資料）は
**すべて `out/internal/` 配下** にあり、**public release pack には含めていません**。

| 出力先 | 内容 | 対外公開 |
|---|---|---|
| `releases/public/v2026.05.06-alpha.5.3/` | alpha.5.3 公開デモパック | ✅ 既に公開 (未変更) |
| `releases/public/v2026.05.06-alpha.5.4/` | alpha.5.4 公開デモパック | ✅ 既に公開 (未変更) |
| `out/sample_*_report_public.md` | 公開デモ用サンプル | ✅ 公開可（未変更）|
| `out/internal/alpha5_5_*` 〜 `alpha5_12_*` | 内部監査・レビュー資料 | ❌ **対外公開なし** |
| `out/internal/alpha5_12_kimura_cio_handoff/` (本パケット) | 木村CIO向けハンドオフ | ❌ **対外公開なし** |

---

## 木村CIOが決めること（要決裁）

### 1. レビュー担当者の任命（最優先）

| 役割 | 担当範囲 | 想定人数 |
|---|---|---:|
| **業務担当 (business_reviewer)** | needs_master_review 28件 + divergent 3件 | 1〜2名 |
| **法令確認者 (legal_reviewer)** | needs_legal_review 5件 | 1名（外部社労士・顧問弁護士の可能性あり）|
| **最終承認者 (final_approver)** | implementation_allowed=yes の最終ハンコ | 木村CIO + 渡辺執行役員 想定 |
| **開発担当 (developer)** | approved 行の master JSON 段階反映（alpha.5.13+）| 1名 |

詳細は [`REVIEWER_ASSIGNMENT_TEMPLATE.csv`](REVIEWER_ASSIGNMENT_TEMPLATE.csv) を参照。

### 2. legal_review_clearance の運用責任者の決定

needs_legal_review 5件（複数名訪問看護加算 4 + 長時間訪問看護加算 1）は、独立した
公式コードを持たず **基本サービスコードへの付加加算構造** として書かれている可能性
があります。法令解釈通知（介護報酬告示・大臣基準告示・老企第36号 等）の確認を
誰が行うか、どの法律事務所・コンサル先に委託するかを決めてください。

### 3. レビュー期限の設定

38件の Excel 入力は集中作業として 1〜2 週間で完了可能と想定。担当者の通常業務との
バランスを見て期限を木村CIOが設定。

### 4. alpha.5.13 dry run の GO 判断

reviewer 入力 → export → alpha.5.10 gate で `approved_changes_preview` が確定したら、
**alpha.5.13 で dry run（master JSON への適用シミュレーション・実反映なし）** を
行うかの GO 判断。

詳細は [`NEXT_ACTIONS_FOR_KIMURA.md`](NEXT_ACTIONS_FOR_KIMURA.md) を参照。

---

## 重要な保証事項（CIO が外部に説明する際の前提）

- ✅ **算定可否を法的に保証するものではない**（ツール内 disclaimer 維持）
- ✅ **公式コード完全照合済とは表現していない**（一部加算は社内コードのみで運用中）
- ✅ **R8.6 改定への対応が完了したとは表現していない**（R8.6.1 確定版が出てから再評価）
- ✅ **個人情報（被保険者番号・氏名・住所・電話・給与）は意図的に保存していない**
- ✅ **master JSON は alpha.5.4 公開デモ版と業務データが完全一致**（差分は `_meta` の audit version のみ）
- ✅ **レビュー入力ファイル（reviewer の判断記録）は public に出さない**運用方針

---

## 関連ドキュメント

| ファイル | 用途 |
|---|---|
| [`README.md`](README.md) | 本パケット全体の案内 |
| [`WHAT_CHANGED_SINCE_ALPHA5_4.md`](WHAT_CHANGED_SINCE_ALPHA5_4.md) | 11 リリースの詳細な進化記録 |
| [`REVIEW_WORKFLOW_GUIDE.md`](REVIEW_WORKFLOW_GUIDE.md) | reviewer 向けの実務ワークフロー |
| [`REVIEWER_ASSIGNMENT_TEMPLATE.csv`](REVIEWER_ASSIGNMENT_TEMPLATE.csv) | 担当者割り当て表のテンプレ |
| [`NEXT_ACTIONS_FOR_KIMURA.md`](NEXT_ACTIONS_FOR_KIMURA.md) | CIO が決定する 7 項目 |
| [`RISKS_AND_GUARDRAILS.md`](RISKS_AND_GUARDRAILS.md) | 進める際の制約・リスク |
| `out/internal/alpha5_9_master_review_packet/` | 28件 + 5件 + 3件 + 2件のレビュー対象資料 |
| `out/internal/alpha5_12_reviewer_workflow_hardening/alpha5_12_reviewer_decision_workbook.xlsx` | reviewer に渡す Excel ワークブック (8シート) |

---

_本資料は内部レビュー用。public release pack には含めない。reviewer が入力した実判断ファイルも public に出さない。_
