# 加算マネージャー Web版

介護保険・障害福祉サービスの加算（報酬加算）取得を AI（Gemini）で支援する Web アプリです。
事業所の情報やレセプト PDF・職員一覧 JSON などをブラウザからアップロードすると、
取り漏れている可能性が高い加算とその取り方を JSON 構造化レポートで返します。

- フロント: バニラ HTML/CSS/JS（フレームワーク非依存・大きめ文字の読みやすい UI）
- バック: Node.js 20 + Express
- AI: Google Gemini（`@google/generative-ai`）
- 判定: 既存の Python 実装（judge_kasan.py / requirement_dsl.py / import_receipt_pdf.py）を **Node.js に完全移植**
- マスタ: リポジトリの `regulatory_master/` を読み込み
- デプロイ: Cloud Run（Dockerfile + Cloud Build / `npm run deploy:cloudrun`）

## 構成

```
app/
├── bin/
│   ├── judge-kasan.js          # 旧 scripts/judge_kasan.py 互換 CLI
│   ├── import-receipt-pdf.js   # 旧 scripts/import_receipt_pdf.py 互換 CLI
│   ├── deploy-cloudrun.js      # Cloud Run デプロイ（Node.js 版）
│   └── smoke-test.js           # ポート済みコアロジックのスモークテスト
├── src/
│   ├── server.js               # Express エントリ（/api/health, /api/services, /api/judge, /api/analyze, /api/import-receipt）
│   ├── services/
│   │   ├── gemini.js           # Gemini クライアント
│   │   ├── regulator.js        # regulatory_master/ を読み込む
│   │   ├── extractor.js        # PDF/CSV 等のテキスト抽出（参考添付用）
│   │   ├── dsl.js              # 旧 requirement_dsl.py の Node.js 移植
│   │   ├── receipt-pdf.js      # 旧 import_receipt_pdf.py の Node.js 移植
│   │   ├── judge.js            # 旧 judge_kasan.py の判定エンジン部
│   │   ├── markdown-report.js  # 旧 judge_kasan.py の Markdown レンダラ
│   │   └── analyzer.js         # 判定エンジン → Gemini 補完の合成器
│   └── routes/                 # （拡張用）
└── public/
    ├── index.html              # アップロード UI（PDF + 3 種類のJSON + その他添付）
    ├── styles.css              # 文字を大きめにした読みやすいスタイル
    └── app.js                  # クライアントロジック
```

リポジトリ直下の以下も使用します:

- `regulatory_master/` — 介護・医療・障害福祉の加算マスタ JSON（service_registry.json で管理）
- `Dockerfile` — Cloud Run 用イメージ
- `cloudbuild.yaml` — Cloud Build パイプライン
- `.env.example` — 環境変数のサンプル（実体 `.env` は `.gitignore` 対象）
- `scripts/*.py` — 旧 Python 実装（参考用に保持）

## ローカルで動かす

```bash
# 1) 環境変数を準備
cp .env.example .env
# .env に GEMINI_API_KEY を設定

# 2) 依存をインストール（リポジトリルートから）
npm run install:app
# あるいは cd app && npm install

# 3) サーバー起動
npm start
# → http://localhost:8080
```

## CLI（Python 版互換）

```bash
# 加算判定（旧 python scripts/judge_kasan.py 互換）
npm run judge -- --service tsusho_kaigo --office DEMO-0004 \
  --tenant-status tenant_data/demo_status/DEMO-0004/tenant_status.json \
  --staff-data    tenant_data/demo_staff/DEMO-0004/staff.json \
  --user-summary  tenant_data/demo_user_summary/DEMO-0004/user_summary.json \
  --report-md out/report.md --json out/report.json

# レセプトPDF → evidence JSON（旧 python scripts/import_receipt_pdf.py 互換）
npm run import-receipt -- --service tsusho_kaigo --office DEMO-0004 \
  --pdf path/to/receipt.pdf --evidence-out tenant_data/evidence/DEMO-0004/

# スモークテスト（24件）
npm run test:smoke
```

## Cloud Run へデプロイする

```bash
# 0) gcloud CLI で認証
gcloud auth login
gcloud config set project <YOUR_PROJECT_ID>

# 1) .env の GCP_PROJECT_ID, GCP_REGION, CLOUD_RUN_SERVICE_NAME を設定

# 2) Gemini API キーを Secret Manager に登録（推奨）
gcloud secrets create gemini-api-key --replication-policy=automatic
printf '%s' "<your-api-key>" | gcloud secrets versions add gemini-api-key --data-file=-

# 3) デプロイ
npm run deploy:cloudrun           # Cloud Build を使う（推奨）
npm run deploy:cloudrun:local     # ローカル docker build + push
```

デプロイ完了後、Cloud Run のサービス URL が表示されます。

## API

| メソッド | パス | 概要 |
|---|---|---|
| GET | `/api/health` | ヘルスチェック / Gemini 接続状況 |
| GET | `/api/services` | 対応サービス一覧 |
| POST | `/api/judge` | 決定的判定エンジンのみ実行（Gemini 不要） |
| POST | `/api/analyze` | 判定エンジン + Gemini 補完分析 |
| POST | `/api/import-receipt` | レセプトPDF → evidence JSON 変換 |

`/api/analyze` / `/api/judge` のリクエストは `multipart/form-data`:

| フィールド | 種別 | 用途 |
|---|---|---|
| `service` | text（必須） | `service_key`（例: `tsusho_kaigo`） |
| `office_code` | text（任意） | 事業所コード（DEMO-XXXX 等） |
| `office_name` / `region` / `staff_summary` / `user_summary` / `current_kasans` / `concerns` | text（任意） | フォーム入力 |
| `pdf` | file（任意） | 介護給付費明細書PDF |
| `tenant_status_json` | file（任意） | 事業所ステータス JSON |
| `staff_json` | file（任意） | 職員集計 JSON（公開デモ用） |
| `user_summary_json` | file（任意） | 利用者集計 JSON（公開デモ用） |
| `attachments` | file × N | その他参考ファイル（最大5件） |

## 設計メモ

- アップロードファイルはサーバー側で一切保存しない（メモリ上で抽出 → 判定エンジン / Gemini プロンプトに供給）
- 判定エンジンは旧 Python 実装を 1:1 で移植（DSL 評価・OR/AND ネスト・代替ルート判定・mapping 保留・staff_summary / user_summary facts）
- Markdown レポートは旧 judge_kasan.py の `render_markdown()` をそのまま再現
- Gemini API キーは `.env` または Cloud Run の Secret Manager で渡す
- 文字サイズは 18px ベース（高齢の事業所職員の方も読みやすい）

