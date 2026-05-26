# マスタ整合性レビュー (alpha.5.9 〜 alpha.5.13)

加算マスタの **三層コードモデル** (official / receipt detection / internal legacy)
と公式コード・社内コード・PDF 検出コードの整合性を、人間レビューで判断する仕組みです。

> このドキュメントは社内レビュー用です。アプリ利用者（事業所スタッフ）向けの
> 機能ではなく、加算マスタを保守する開発者・業務担当・CIO 向けです。

## 構成

```
out/internal/
├── alpha5_9_master_review_packet/         # ベースの review packet
├── alpha5_10_reviewer_decision_gate/      # decision gate（reviewer 入力受入チェック）
├── alpha5_11_reviewer_handoff_workbook/   # Excel workbook (xlsx)
├── alpha5_12_kimura_cio_handoff/          # CIO ハンドオフ資料
├── alpha5_12_reviewer_workflow_hardening/ # workflow 強化版 workbook
└── alpha5_13_review_workload_reducer/     # 初回バッチ 8 件 + CIO 30 分用 brief
```

すべて Python スクリプト (`scripts/generate_alpha5_*.py`) で生成される **再現可能** な
アーティファクトです。手で編集してはいけません。

## レビューバケット

各加算は alpha.5.13 の `REVIEW_PRIORITY_MATRIX.csv` で 4 つのバケットに分類されます。

| バケット | 件数 | 意味 | 推奨判断 |
|---------|------|------|---------|
| `needs_master_review` | 28 | 公式コードと社内コードが食い違う / コードが見つからない | 多くが `add_receipt_alias`（公式コードを alias 登録） |
| `divergent` | 3 | 公式コードと社内コードの単位 / 名称が分岐している | `divergent_keep_or_correct`（個別レビュー要） |
| `needs_legal_review` | 5 | 法令解釈が必要 | `defer_until_legal_clearance`（法令確認者へ） |
| `future_candidate_only` | 2 | R8.6 案資料に基づく将来候補のみ | `defer_until_r8_definitive`（確定版待ち） |

合計 38 件。このうち **初回バッチに 8 件** を絞り、残りは defer。

## 初回バッチ (8 件)

`FIRST_REVIEW_BATCH.csv` に含まれる 8 件は、

- リスクが低い (`risk_level=low`)
- 工数が小さい (`review_effort=15min`)
- 業務担当 (`business_reviewer`) 単独で判断可能
- safe default が明確 (`add_receipt_alias`)

なものに限定されています。サービス内訳:

| サービス | 全件 | 初回バッチ |
|---------|-----:|----------:|
| tsusho_kaigo (通所介護) | 6 | 4 |
| houmon_kaigo (訪問介護) | 8 | 2 |
| kyotaku_shien (居宅介護支援) | 17 | 2 |
| houmon_kango_kaigo (訪問看護) | 7 | 0 |

訪問看護に初回バッチがない理由: 全件が `needs_legal_review` または `divergent` で、
業務担当だけでは判断できないためです。

## アプリ UI からの参照

ログイン済かつ有料プランで解析履歴を開くと、**🔍 マスタ整合性** タブが表示されます。

- そのサービスに該当する加算が `review_bucket` ごとに折りたたみ表示される
- 各加算カードには `recommended_initial_decision` の badge と
  `reason_for_priority` の説明が付く
- 初回バッチ対象は ★初回 タグが付く
- 「CIO 30 分用 brief」（全サービス共通の Markdown）が末尾に展開可能

各加算の **加算別レビューカード** にも、🔍 のマスタ整合性 badge が小さく表示され、
レビュアーが「マスタ側で何を直すべきか」を意識しながら承認 / 差戻しを判断できます。

## API

| エンドポイント | 用途 |
|--------------|------|
| `GET /api/master-review/packets` | 全パケットのメタ情報一覧 |
| `GET /api/master-review/priority-matrix?service=X&bucket=Y&first_batch_only=1` | 38 件の全 / 絞り込み |
| `GET /api/master-review/first-batch` | 初回バッチ 8 件 |
| `GET /api/master-review/workload` | サービス × バケット × ロール の集計 |
| `GET /api/master-review/decision/:service/:kasan` | 1 加算の推奨判断 + master audit |
| `GET /api/master-review/brief/cio` | CIO 30 分用 brief (Markdown) |
| `GET /api/master-review/safe-defaults` | safe default decisions (Markdown) |
| `GET /api/master-review/deferred` | 後送り項目 (Markdown) |
| `GET /api/master-review/workload-by-role` | ロール別 workload (Markdown) |

すべて **読み取り専用**。public API のため認証不要ですが、ヘルパ目的なので
無料 / 有料を問わず開放しています。

## CLI: パケットを再生成する

Python スクリプト依存:

- `pdfplumber` （PDF 抽出テスト用）
- `openpyxl` （Excel workbook 生成）
- `pytest` （Python 単体テスト）

```bash
pip install pdfplumber openpyxl pytest
```

npm 経由で実行:

```bash
cd app
npm run review:generate:packet      # alpha.5.9
npm run review:generate:gate        # alpha.5.10
npm run review:generate:workbook    # alpha.5.11
npm run review:generate:hardening   # alpha.5.12
npm run review:generate:reducer     # alpha.5.13
npm run review:export:decisions     # reviewer 判断を Excel から CSV に書き戻す
npm run test:python                 # Python 側の全テスト
```

各スクリプトは **idempotent** に設計されており、同じ入力に対して常に同じ出力を返します。
タイムスタンプも固定値です（`GENERATED_AT="2026-05-10"`）。

## 不変条件（テストで保護）

| 不変条件 | 内容 |
|---------|------|
| master JSON 自動修正なし | スクリプトは masters を読み取り専用で扱う |
| 新規 checked 昇格なし | reviewer 承認 + 実装ステップが必要 |
| R8.6 案資料は checked 昇格に使わない | `checked_promotion_allowed=false` でガード |
| public release pack は更新しない | `releases/public/*` は別ライン |
| reviewer_decision は上書きしない | `recommended_initial_decision` は提案のみ |
| implementation_allowed=yes は自動で付けない | 実装は別 PR |
| 算定可否保証表現は禁止 | disclaimer 維持 |

これらは `tests/test_master_review_packet.py` ほか 14 ファイルでアサートされており、
スクリプトを変更したら必ず `npm run test:python` で検証してください。

## 参照ファイル

- 生成スクリプト: `scripts/generate_alpha5_*.py`
- Node ローダー: `app/src/services/master-review.js`
- API: `app/src/server.js` の `/api/master-review/*`
- UI: `app/public/app.js` の `fetchAndRenderMasterReview()`
- 出力: `out/internal/alpha5_9..13_*/`
- マスタ audit フィールド: `regulatory_master/kaigo/*.json` 内の
  `service_code_audit.alpha_5_8_three_layer_model`
- ソースレジストリ: `regulatory_master/sources/kaigo_service_code_sources.json`
