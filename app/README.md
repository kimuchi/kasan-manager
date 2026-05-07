# 加算マネージャー Web版

介護保険・障害福祉サービスの加算（報酬加算）取得を AI（Gemini）で支援する Web アプリです。
事業所の情報やレセプト PDF・職員一覧 CSV などをブラウザからアップロードすると、
取り漏れている可能性が高い加算とその取り方を JSON 構造化レポートで返します。

- フロント: バニラ HTML/CSS/JS（フレームワーク非依存・大きめ文字の読みやすい UI）
- バック: Node.js 20 + Express
- AI: Google Gemini（`@google/generative-ai`）
- マスタ: リポジトリの `regulatory_master/` を読み込み
- デプロイ: Cloud Run（Dockerfile + Cloud Build 経由 / または gcloud 直）

## 構成

```
app/
├── src/
│   ├── server.js               # Express エントリ
│   ├── services/
│   │   ├── gemini.js           # Gemini クライアント
│   │   ├── regulator.js        # regulatory_master/ を読み込む
│   │   ├── extractor.js        # PDF/CSV 等のテキスト抽出
│   │   └── analyzer.js         # 分析プロンプト生成 + 構造化出力
│   └── routes/                 # （拡張用）
└── public/
    ├── index.html              # アップロード UI
    ├── styles.css              # 文字を大きめにした読みやすいスタイル
    └── app.js                  # クライアントロジック
```

リポジトリ直下の以下も使用します:

- `regulatory_master/` — 介護・医療・障害福祉の加算マスタ JSON
- `Dockerfile` — Cloud Run 用イメージ
- `cloudbuild.yaml` — Cloud Build パイプライン
- `scripts/deploy_cloud_run.sh` — デプロイ補助スクリプト
- `.env.example` — 環境変数のサンプル（実体 `.env` は Git 管理外）

## ローカルで動かす

```bash
# 1) 環境変数を準備
cp .env.example .env
# .env に GEMINI_API_KEY を設定

# 2) 依存をインストール
cd app
npm install

# 3) サーバー起動
npm start
# → http://localhost:8080
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
bash scripts/deploy_cloud_run.sh           # Cloud Build を使う（推奨）
bash scripts/deploy_cloud_run.sh local     # ローカル docker build + push
```

デプロイ完了後、Cloud Run のサービス URL が表示されます。

## 対応サービス

`regulatory_master/service_registry.json` で管理されています。

- 介護保険: 通所介護 / 訪問介護 / 居宅介護支援 / 訪問看護 / 小規模多機能（draft） / 特養（planned）
- 医療保険: 訪問看護（医療保険）（draft）
- 障害福祉: 居宅介護 / 就労継続支援A型 / 就労継続支援B型（いずれも draft、代表的な加算データ済み）

`status` が `draft` のサービスでも、Gemini が一般的な制度知識を併用して提案します。

## API

| メソッド | パス | 概要 |
|---|---|---|
| GET | `/api/health` | ヘルスチェック / Gemini 接続状況 |
| GET | `/api/services` | 対応サービス一覧 |
| POST | `/api/analyze` | フォーム + 添付を受け取り Gemini で分析 |

`/api/analyze` のリクエストは `multipart/form-data`:

| フィールド | 種別 | 用途 |
|---|---|---|
| `service` | text（必須） | `service_key`（例: `tsusho_kaigo`） |
| `office_name` 他 | text（任意） | 事業所情報 |
| `attachments` | file × N | PDF / CSV / TXT / JSON（最大5件・1件20MB） |

## 設計メモ

- アップロードファイルはサーバー側で一切保存しない（メモリ上で抽出 → Gemini プロンプトに圧縮要約）
- 出力は JSON Schema で固定し、UI 側は構造化レンダリング
- Gemini API キーは `.env` または Cloud Run の Secret Manager 連携で渡す
- 文字サイズを 18px ベースに設定（高齢の事業所職員の方も読みやすいよう調整）
