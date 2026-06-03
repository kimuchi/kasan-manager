# CLI マニュアル

加算マネージャー Node.js 版に同梱されているコマンドラインツール一覧と使い方。
すべて `npm run <script> -- <args>` の形でリポジトリルートから呼び出せます。

---

## 前提

- Node.js 20 以上
- リポジトリルートで `npm run install:app` 実行済（`app/node_modules/` が存在）
- リポジトリルートに `.env` が存在（`.env.example` をコピーして編集）

---

## 1. 加算判定 — `npm run judge`

旧 `python scripts/judge_kasan.py` 互換。マスタ + 事業所データから加算別判定 + Markdown レポートを生成します。

### 基本

```bash
npm run judge -- --service tsusho_kaigo --office DEMO-0004
```

### 全オプション

| 引数 | 種別 | 説明 |
|---|---|---|
| `--service` | 必須 | サービスキー（例: `tsusho_kaigo`） |
| `--office` | 任意 | 事業所コード。`tenant_data/status/<office>.json` を自動読み込み |
| `--domain` | 任意 | `kaigo` / `medical` / `disability` でフィルタ |
| `--status-filter` | 任意 | `implemented` / `draft` / `planned` でフィルタ |
| `--status` | 任意 | 事業所ステータス JSON のフルパス（office と排他） |
| `--evidence` | 任意 | 既に生成済の receipt evidence JSON のパス |
| `--apply-evidence` | flag | evidence を判定に反映する |
| `--receipt-pdf` | 任意 | レセプト PDF のパス（指定すると自動で抽出 → 反映） |
| `--evidence-out` | 任意 | `--receipt-pdf` 抽出結果の保存先（フォルダ or ファイル） |
| `--tenant-status` | 任意 | DEMO 用 tenant_status JSON のパス |
| `--staff-data` | 任意 | DEMO 用 staff.json のパス |
| `--user-summary` | 任意 | DEMO 用 user_summary.json のパス |
| `--json` | 任意 | 結果を JSON ファイルに書き出す先 |
| `--report-md` | 任意 | Markdown レポートを書き出す先 |

### 例 1: フル機能を使う

```bash
npm run judge -- \
  --service tsusho_kaigo \
  --office DEMO-0004 \
  --tenant-status tenant_data/demo_status/DEMO-0004/tenant_status.json \
  --staff-data    tenant_data/demo_staff/DEMO-0004/staff.json \
  --user-summary  tenant_data/demo_user_summary/DEMO-0004/user_summary.json \
  --report-md out/DEMO-0004_report.md \
  --json       out/DEMO-0004_result.json
```

### 例 2: PDF を含めて分析

```bash
npm run judge -- \
  --service tsusho_kaigo \
  --office DEMO-0004 \
  --receipt-pdf path/to/receipt.pdf \
  --evidence-out tenant_data/evidence/DEMO-0004/ \
  --report-md out/DEMO-0004_report.md
```

### 出力フォーマット

`--report-md` 指定時は Markdown ファイル、`--json` 指定時は JSON ファイル、両方指定なしの場合はコンソールにサマリのみ出力されます。

```
=== CareLinker 加算チェッカー判定 ===
サービス: 通所介護 (tsusho_kaigo)
事業所: DEMO-0004

--- 加算判定サマリ（全13加算）---
  ✅ clear     : 0 件
  ⏸ waiting   : 0 件
  ❌ not_clear : 0 件
  ❔ unknown   : 13 件
```

---

## 2. レセプト PDF 取込 — `npm run import-receipt`

旧 `python scripts/import_receipt_pdf.py` 互換。レセプト PDF を解析して `evidence` JSON を生成します。

### 基本

```bash
npm run import-receipt -- \
  --service tsusho_kaigo \
  --office DEMO-0004 \
  --pdf path/to/receipt.pdf \
  --evidence-out tenant_data/evidence/DEMO-0004/
```

### 全オプション

| 引数 | 種別 | 説明 |
|---|---|---|
| `--service` | 必須 | サービスキー（`tsusho_kaigo` / `houmon_kaigo` / `kyotaku_shien` / `houmon_kango_kaigo`） |
| `--office` | 必須 | 事業所コード |
| `--tenant` | 任意 | テナント ID（省略時は `unknown`） |
| `--pdf` | 任意 | PDF ファイルのパス（`--sample-text` と排他） |
| `--sample-text` | 任意 | テスト用にテキストファイルから読み込む |
| `--evidence-out` | 必須 | evidence JSON 出力先（フォルダ or ファイル名） |

### 出力例

```
evidence書き出し: tenant_data/evidence/DEMO-0004/receipt_pdf_20260507103045.json
  service_key: tsusho_kaigo
  office_code: DEMO-0004
  total_users_estimated: 5
  yokaigo_3plus_ratio: 0.6
  current_kasan_counts: 6件検出
  extraction_confidence: high
```

### 個人情報の取り扱い

被保険者番号・氏名・住所・電話番号・生年月日は意図的に抽出 / 保存しません。`evidence` JSON には集計値（要介護度分布・サービスコード件数）のみが記録されます。

---

## 3. GCP プロビジョニング — `npm run setup:gcp`

Cloud Run へ初めてデプロイする際の API 有効化・Artifact Registry 作成・IAM 付与を冪等に実行します。

```bash
npm run setup:gcp                       # 標準（.env 運用）
npm run setup:gcp -- --use-secret       # Secret Manager 連携を opt-in
```

実行内容（冪等・標準モード）:

1. 必須 API の有効化（`run` / `cloudbuild` / `artifactregistry` / `iamcredentials` / `compute`）
2. Artifact Registry リポジトリの作成
3. Cloud Build SA に `roles/run.admin` / `roles/iam.serviceAccountUser` / `roles/artifactregistry.writer` を付与

`--use-secret` を指定すると追加で:

4. `secretmanager.googleapis.com` の有効化
5. Secret Manager に `gemini-api-key` を作成
6. Compute Engine デフォルト SA に `roles/secretmanager.secretAccessor` を付与

> ℹ️ **標準モードでは `GEMINI_API_KEY` は `.env` から Cloud Run の環境変数として直接渡されます。**
> Secret Manager は不要です。

詳細: [DEPLOYMENT.md](./DEPLOYMENT.md)

---

## 4. Cloud Run デプロイ — `npm run deploy:cloudrun`

```bash
npm run deploy:cloudrun                  # Cloud Build でビルド & push → ローカルから deploy
npm run deploy:cloudrun:local            # ローカルで docker build → push → deploy
npm run deploy:cloudrun -- --skip-build  # ビルドせず最新イメージで env 更新だけ実行
```

`.env` の値を読み、`gcloud run deploy --set-env-vars=...` で Cloud Run の環境変数として渡します:

| 環境変数 | 値の出所 |
|---|---|
| `GEMINI_API_KEY` | `.env` の `GEMINI_API_KEY` |
| `GEMINI_MODEL` | `.env` の `GEMINI_MODEL`（デフォルト `gemini-2.5-flash`） |
| `NODE_ENV` | `production` 固定 |

> 💡 `.env` の値だけを更新したい場合は `--skip-build` が高速です（ビルドせず env 更新のみ実行）。

---

## 5. カスタムドメイン設定 — `npm run setup:domain`

```bash
# 簡易: Cloud Run Domain Mappings
npm run setup:domain -- --domain=kasan.example.jp

# 本番推奨: External HTTPS LB + Serverless NEG
npm run setup:domain -- --domain=kasan.example.jp --mode=loadbalancer
```

詳細: [DEPLOYMENT.md](./DEPLOYMENT.md#カスタムドメイン)

---

## 6. ログ閲覧 — `npm run logs`

Cloud Run のログを CLI で閲覧します。

```bash
npm run logs                           # 直近 10 分
npm run logs -- --since=1h             # 直近 1 時間
npm run logs -- --severity=ERROR       # ERROR 以上のみ
```

---

## 7. スモークテスト — `npm run test:smoke`

ポート済みコアロジック（DSL 評価・PDF 抽出・判定エンジン・Markdown レンダラ）を 24 件のテストで検証します。

```bash
npm run test:smoke
```

CI / リリース前の確認用。デモデータ（`tenant_data/demo_*/DEMO-0004/`）を読み込んで実 API と同等の経路で動作確認します。

---

## 8. ローカル開発（参考）

```bash
npm run install:app    # 依存パッケージ install（初回のみ）
npm start              # http://localhost:8080 で起動
npm run dev            # node --watch で自動リロード
```

> ⚠️ 本リポジトリは Cloud Run 運用を主目的としているため、ローカル起動は CLI / 開発用です。本番アクセスはカスタムドメイン経由でお願いします。
