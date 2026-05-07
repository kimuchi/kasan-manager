# デプロイマニュアル（Cloud Run + カスタムドメイン）

加算マネージャー Web 版を Google Cloud Run にカスタムドメインで運用するための手順書です。
**初めての GCP プロジェクトでも、コマンド数本で本番運用に到達できる**ように設計しています。

---

## ゴール

```
ユーザー → https://kasan.example.jp → Cloud Run（asia-northeast1）→ Gemini API
                ↑                          ↑
        Google マネージド証明書    Secret Manager の GEMINI_API_KEY
```

---

## 前提

- Google Cloud アカウントと請求先アカウント設定済
- 利用可能な GCP プロジェクト（無ければ新規作成）
- 独自ドメイン（例: `example.jp`）の DNS をコントロールできる
- Gemini API キー（[Google AI Studio](https://aistudio.google.com/app/apikey) で発行）
- ローカルマシンに Node.js 20 以上、Git、`gcloud` CLI がインストール済み

---

## 0. 一気通貫の流れ（チェックリスト）

| # | 作業 | コマンド |
|---|---|---|
| 1 | リポジトリを clone | `git clone <repo>` |
| 2 | `.env` を作成 | `cp .env.example .env` を編集 |
| 3 | 依存をインストール | `npm run install:app` |
| 4 | gcloud にログイン | `gcloud auth login` |
| 5 | プロビジョニング | `npm run setup:gcp -- --gemini-key=<APIキー>` |
| 6 | デプロイ | `npm run deploy:cloudrun` |
| 7 | カスタムドメイン | `npm run setup:domain -- --domain=kasan.example.jp` |
| 8 | DNS 設定 | 表示された CNAME / A レコードを DNS に登録 |
| 9 | 証明書発行待ち | 5〜60 分（自動） |
| 10 | アクセス確認 | `https://kasan.example.jp` |

---

## 1. プロジェクト準備

### 1-1. GCP プロジェクトの作成（既存プロジェクトを使う場合はスキップ）

```bash
gcloud projects create kasan-manager-prod --name="加算マネージャー本番"
gcloud config set project kasan-manager-prod
gcloud beta billing projects link kasan-manager-prod \
    --billing-account=<請求先アカウント ID>
```

### 1-2. ローカル準備

```bash
git clone <repository-url>
cd kasan-manager

# .env を作成して値を入れる
cp .env.example .env
# 編集して下記を埋める:
#   GEMINI_API_KEY (ローカル CLI 用、本番は Secret Manager)
#   GCP_PROJECT_ID
#   GCP_REGION (デフォルト asia-northeast1)
#   CLOUD_RUN_SERVICE_NAME (デフォルト kasan-manager)
#   CLOUD_RUN_CUSTOM_DOMAIN

npm run install:app
gcloud auth login
gcloud auth application-default login   # ADC を設定（一部 SDK が参照）
```

---

## 2. プロビジョニング — `npm run setup:gcp`

このコマンドが冪等に下記を実行します:

1. 必須 API の有効化（`run` / `cloudbuild` / `artifactregistry` / `secretmanager` / `iamcredentials` / `compute`）
2. Artifact Registry リポジトリ（`kasan-manager`）の作成
3. Secret Manager に `gemini-api-key` を作成し、API キーを保存
4. Cloud Build SA に Cloud Run デプロイに必要な IAM ロール 3 つを付与
5. Compute Engine デフォルト SA（Cloud Run の実行 SA）に Secret 読み取り権限を付与

```bash
# Gemini API キーをまとめて Secret に保存する場合
npm run setup:gcp -- --gemini-key=AIzaSyXXXXXXXXXXXXXXXXX

# Secret 登録は別途手動で行う場合
npm run setup:gcp -- --skip-secret
gcloud secrets create gemini-api-key --replication-policy=automatic
printf '%s' 'AIzaSyXXXXXXXXXXXXXXXXX' | gcloud secrets versions add gemini-api-key --data-file=-
```

実行後の確認:

```bash
gcloud services list --enabled | grep -E "run|cloudbuild|artifactregistry|secretmanager"
gcloud artifacts repositories list --location=asia-northeast1
gcloud secrets list
gcloud projects get-iam-policy $GCP_PROJECT_ID --format=json | jq '.bindings[]|select(.role|test("run|secret"))'
```

---

## 3. 初回デプロイ — `npm run deploy:cloudrun`

`cloudbuild.yaml` 経由で Cloud Build を起動し、Docker イメージをビルド → Artifact Registry へ push → Cloud Run へ deploy します。

```bash
npm run deploy:cloudrun
```

実行内容:

1. Cloud Build がリポジトリをコンテナ環境で `docker build`
2. ビルドされたイメージを Artifact Registry に push（`SHORT_SHA` と `latest` の 2 タグ）
3. Cloud Run にデプロイ（`asia-northeast1`、`allow-unauthenticated`、Secret Manager から API キー読込）
4. デプロイ後の URL（`https://kasan-manager-xxxxx-an.a.run.app`）を表示

完了後の確認:

```bash
gcloud run services describe kasan-manager --region=asia-northeast1
curl -s "$(gcloud run services describe kasan-manager --region=asia-northeast1 --format='value(status.url)')/api/health"
```

ローカルで Docker ビルドからやりたい場合:

```bash
npm run deploy:cloudrun:local
```

---

## 4. カスタムドメイン — `npm run setup:domain`

2 つのモードを提供します。**用途に応じてどちらかを選択**してください。

### 4-A. シンプル方式（Cloud Run Domain Mappings）

Cloud Run が自動で証明書を発行・更新します。CDN や IP 固定が不要なら最短経路です。

```bash
npm run setup:domain -- --domain=kasan.example.jp
```

実行後に表示されるレコードを DNS に登録:

| レコード種別 | 名前 | 値 |
|---|---|---|
| **サブドメイン**（`kasan.example.jp` 等） | `kasan` | `CNAME ghs.googlehosted.com.` |
| **ルートドメイン**（`example.jp`） | `@` | `A 216.239.32.21` 他 4 IP / `AAAA 2001:4860:4802:32::15` 他 4 IPv6 |

DNS 反映後、Google マネージド証明書の発行は **5〜60 分** かかります。

ステータス確認:

```bash
gcloud beta run domain-mappings describe \
  --domain=kasan.example.jp \
  --region=asia-northeast1 \
  --format='value(status.conditions[0].type,status.conditions[0].status,status.conditions[0].message)'
```

`CertificateProvisioned: True` になればアクセス可能です。

> ⚠️ **注意**: Cloud Run Domain Mappings は一部リージョンで `preview` 状態です。`asia-northeast1` は GA。利用可能リージョンは [公式ドキュメント](https://cloud.google.com/run/docs/mapping-custom-domains) を確認してください。

### 4-B. 本番推奨（External HTTPS LB + Serverless NEG）

固定 IP / Cloud CDN / WAF（Cloud Armor）/ 複数バックエンドが必要な場合は、グローバル ロードバランサ経由で運用します。

```bash
npm run setup:domain -- --domain=kasan.example.jp --mode=loadbalancer
```

このコマンドが下記を冪等に作成します:

1. **Serverless NEG** （`kasan-manager-neg`）— Cloud Run サービスへのバックエンド参照
2. **Backend Service** （`kasan-manager-lb-backend`）— EXTERNAL_MANAGED モード
3. **URL Map** （`kasan-manager-lb-urlmap`）
4. **Google マネージド証明書** （`kasan-manager-lb-cert`）— 対象ドメインで発行
5. **HTTPS Target Proxy** （`kasan-manager-lb-https-proxy`）
6. **静的グローバル IP** （`kasan-manager-lb-ip`）
7. **Forwarding Rule** （`kasan-manager-lb-fw-https`）— ポート 443

実行後に表示される IP を DNS に登録:

```
kasan.example.jp   A   <表示された IP>
```

証明書プロビジョニングのステータス:

```bash
gcloud compute ssl-certificates describe kasan-manager-lb-cert \
  --global --format='value(managed.status,managed.domainStatus)'
# 期待: ACTIVE / kasan.example.jp=ACTIVE
```

LB IP の確認:

```bash
gcloud compute addresses describe kasan-manager-lb-ip --global --format='value(address)'
```

---

## 5. 運用

### 5-1. 再デプロイ（コードを更新したとき）

```bash
git pull
npm run deploy:cloudrun
```

新しい `SHORT_SHA` でイメージがビルドされ、Cloud Run が新リビジョンを 100 % トラフィックで起動します（古いリビジョンは自動的に削除されません）。

### 5-2. 環境変数 / Secret の更新

```bash
# Gemini モデルを切り替えたい
gcloud run services update kasan-manager \
  --region=asia-northeast1 \
  --set-env-vars=GEMINI_MODEL=gemini-2.5-pro

# Gemini API キーを更新（Secret に新バージョンを追加）
printf '%s' '<新しい API キー>' | gcloud secrets versions add gemini-api-key --data-file=-
gcloud run services update kasan-manager \
  --region=asia-northeast1 \
  --update-secrets=GEMINI_API_KEY=gemini-api-key:latest
```

### 5-3. ロールバック

```bash
# 直近のリビジョン一覧
gcloud run revisions list --service=kasan-manager --region=asia-northeast1

# 特定リビジョンに 100 % 切り替え
gcloud run services update-traffic kasan-manager \
  --region=asia-northeast1 \
  --to-revisions=kasan-manager-00007-abc=100
```

### 5-4. ログ監視

```bash
npm run logs                              # 直近 10 分
npm run logs -- --since=1h                # 直近 1 時間
npm run logs -- --severity=ERROR          # ERROR 以上のみ

# Cloud Logging のリアルタイムビューを開く
gcloud logging tail "resource.type=cloud_run_revision AND resource.labels.service_name=kasan-manager"
```

### 5-5. メトリクス

Cloud Run コンソール → サービス → メトリクス で下記を監視:

- **リクエスト数** / **5xx エラー率** / **レイテンシ p50/p95/p99**
- **コンテナインスタンス数** / **CPU・メモリ使用率**
- **コンカレンシー利用率**

`SLA: p95 < 30s, error rate < 1%` を目安に運用してください。

---

## 6. セキュリティ

### 6-1. アクセス制御

デフォルトは `--allow-unauthenticated`（公開）です。事業所限定で運用する場合は IAP（Identity-Aware Proxy）で守ります:

```bash
# 1. Cloud Run の認証を ON
gcloud run services update kasan-manager --region=asia-northeast1 --no-allow-unauthenticated

# 2. LB 経由の場合は IAP を有効化
gcloud iap web enable --resource-type=backend-services \
  --service=kasan-manager-lb-backend

# 3. アクセス可能ユーザー / グループを許可
gcloud iap web add-iam-policy-binding \
  --resource-type=backend-services --service=kasan-manager-lb-backend \
  --member='user:operator@example.com' --role='roles/iap.httpsResourceAccessor'
```

### 6-2. アップロードファイル

サーバ側ではメモリ上で処理し、永続化しません。ただし Gemini API へ送信されるため、**個人情報（被保険者番号・氏名・住所等）はマスキング**してください。

### 6-3. 監査ログ

Cloud Audit Logs は標準で `Admin Activity` が有効です。データアクセス監査を追加する場合:

```bash
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member='user:auditor@example.com' --role='roles/logging.viewer'
```

---

## 7. コスト目安

| 項目 | 目安（月次） | 備考 |
|---|---|---|
| Cloud Run | 0〜数千円 | 無料枠 200 万リクエスト/月、cpu only-during-request 設定 |
| Artifact Registry | 数十円 | 1 GB 以下の格納 |
| Secret Manager | 数十円 | secret 1 件、月数千アクセス |
| Cloud Build | 0 円 | 無料枠 120 ビルド分/日 |
| External HTTPS LB（4-B のみ） | 約 2,500 円 | 静的 IP + 転送ルール 0.025 USD/h |
| Gemini API | 利用量に応じて | flash $0.075 / 1M input, $0.30 / 1M output |
| **合計（ライト運用）** | **約 1,000 円〜** | LB 利用なし・月 1,000 リクエスト想定 |
| **合計（本番LB運用）** | **約 4,000 円〜** | LB あり・月 10,000 リクエスト想定 |

---

## 8. トラブルシュート

### Q. デプロイ時に `Permission denied`

Cloud Build SA に IAM が付与されていない可能性。`npm run setup:gcp` を再実行してください。

### Q. Cloud Run が起動して 0.5 秒で再起動を繰り返す

`PORT` 環境変数で listen していない可能性。`src/server.js` で `process.env.PORT` を読んでいることを確認。本リポジトリは標準で対応済みです。

### Q. Gemini 接続 OK ステータスにならない

```bash
# Cloud Run の Secret 取得を確認
gcloud run services describe kasan-manager --region=asia-northeast1 \
  --format=json | jq '.spec.template.spec.containers[0].env'
```

`GEMINI_API_KEY` が `valueFrom.secretKeyRef` で設定されているか確認。Compute Engine デフォルト SA に `roles/secretmanager.secretAccessor` が付いているかも要確認。

### Q. 証明書がいつまでも `PROVISIONING`

DNS が反映されているか確認:

```bash
dig kasan.example.jp +short
nslookup kasan.example.jp 8.8.8.8
```

DNS が正しい場合は最大 60 分待つ。それでも `PROVISIONING_FAILED` ならドメイン所有者確認が必要な場合があります。

### Q. ロードバランサ経由で 502

Backend service と NEG の紐付けを確認:

```bash
gcloud compute backend-services describe kasan-manager-lb-backend --global \
  --format='value(backends[].group)'
```

NEG が正しく作成されていない場合、`npm run setup:domain -- --mode=loadbalancer` を再実行（冪等に修復）。

### Q. Cold start が遅い

```bash
# 最小インスタンスを 1 に上げる（料金増あり）
gcloud run services update kasan-manager --region=asia-northeast1 --min-instances=1
```

または `.env` の `CLOUD_RUN_MIN_INSTANCES=1` を設定して再デプロイ。

---

## 9. 削除（クリーンアップ）

```bash
gcloud run services delete kasan-manager --region=asia-northeast1
gcloud beta run domain-mappings delete --domain=kasan.example.jp --region=asia-northeast1   # 4-A の場合
gcloud compute forwarding-rules delete kasan-manager-lb-fw-https --global                   # 4-B
gcloud compute target-https-proxies delete kasan-manager-lb-https-proxy
gcloud compute url-maps delete kasan-manager-lb-urlmap
gcloud compute backend-services delete kasan-manager-lb-backend --global
gcloud compute network-endpoint-groups delete kasan-manager-neg --region=asia-northeast1
gcloud compute ssl-certificates delete kasan-manager-lb-cert --global
gcloud compute addresses delete kasan-manager-lb-ip --global
gcloud secrets delete gemini-api-key
gcloud artifacts repositories delete kasan-manager --location=asia-northeast1
```

---

## 関連ドキュメント

- [USER_GUIDE.md](./USER_GUIDE.md) — Web UI の使い方（事業所スタッフ向け）
- [TECHNICAL.md](./TECHNICAL.md) — アーキテクチャ・API・カスタマイズ
- [CLI.md](./CLI.md) — コマンドラインツールの使い方
