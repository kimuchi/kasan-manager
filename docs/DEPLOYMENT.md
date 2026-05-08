# デプロイマニュアル（Cloud Run + カスタムドメイン）

加算マネージャー Web 版を Google Cloud Run にカスタムドメインで運用するための手順書です。
**初めての GCP プロジェクトでも、コマンド数本で本番運用に到達できる**ように設計しています。

> ℹ **本構成のポリシー**: `GEMINI_API_KEY` を含む全ての設定値は **`.env` ファイル** に集約し、
> `npm run deploy:cloudrun` がデプロイ時に Cloud Run の環境変数として直接渡します。
> Secret Manager は使いません（必要なら opt-in で利用可能）。

---

## ゴール

```
ユーザー → https://kasan.example.jp → Cloud Run（asia-northeast1）→ Gemini API
                ↑                          ↑
        Google マネージド証明書     .env から渡された GEMINI_API_KEY
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
| 2 | `.env` を作成 | `cp .env.example .env` を編集（GEMINI_API_KEY 等） |
| 3 | 依存をインストール | `npm run install:app` |
| 4 | gcloud にログイン | `gcloud auth login` |
| 5 | プロビジョニング | `npm run setup:gcp` |
| 6 | デプロイ | `npm run deploy:cloudrun` |
| 7 | カスタムドメイン | `npm run setup:domain -- --domain=kasan.example.jp` |
| 8 | DNS 設定 | 表示された CNAME / A レコードを DNS に登録 |
| 9 | 証明書発行待ち | 5〜60 分（自動） |
| 10 | アクセス確認 | `https://kasan.example.jp` |
| 11 | （任意）reCAPTCHA キー発行 | [Admin Console](https://www.google.com/recaptcha/admin) で v3 を発行 → `.env` に設定 → `npm run deploy:cloudrun -- --skip-build` |

> ℹ **公開サイトとして運用する場合は §8（不正利用対策）** を必ず確認してください。
> レート制限はデフォルトでオン、reCAPTCHA は `.env` にキーを設定するだけで有効化されます。

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
```

`.env` 編集ポイント:

```ini
# ▼ 必須 ▼
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXX
GCP_PROJECT_ID=kasan-manager-prod

# ▼ デフォルトのままで良い項目 ▼
GCP_REGION=asia-northeast1
CLOUD_RUN_SERVICE_NAME=kasan-manager
GEMINI_MODEL=gemini-2.5-flash
NODE_ENV=production

# ▼ カスタムドメインを使う場合 ▼
CLOUD_RUN_CUSTOM_DOMAIN=kasan.example.jp
```

```bash
npm run install:app
gcloud auth login
gcloud auth application-default login   # ADC を設定（一部 SDK が参照）
```

> ⚠️ **`.env` は機密ファイルです。** `.gitignore` で除外されていますが、Slack やメールに添付しないでください。共有する場合は鍵管理ツール（1Password / GCP Secret Manager / Vault 等）経由でお願いします。

---

## 2. プロビジョニング — `npm run setup:gcp`

このコマンドが冪等に下記を実行します:

1. 必須 API の有効化（`run` / `cloudbuild` / `artifactregistry` / `iamcredentials` / `compute`）
2. Artifact Registry リポジトリ（`kasan-manager`）の作成
3. Cloud Build SA に Cloud Run デプロイに必要な IAM ロール 3 つを付与
   - `roles/run.admin`
   - `roles/iam.serviceAccountUser`
   - `roles/artifactregistry.writer`

```bash
npm run setup:gcp
```

実行後の確認:

```bash
gcloud services list --enabled | grep -E "run|cloudbuild|artifactregistry"
gcloud artifacts repositories list --location=asia-northeast1
gcloud projects get-iam-policy $GCP_PROJECT_ID --format=json | jq '.bindings[]|select(.role|test("run|artifact"))'
```

> ℹ️ `GEMINI_API_KEY` は `.env` で管理し、`deploy:cloudrun` 時に Cloud Run へ渡します。**Secret Manager は不要**です。
> Secret Manager で運用したい場合は `npm run setup:gcp -- --use-secret` を使ってください（[8. Secret Manager 連携（opt-in）](#8-secret-manager-連携opt-in) 参照）。

---

## 3. 初回デプロイ — `npm run deploy:cloudrun`

実行内容:

1. `cloudbuild.yaml` で Docker イメージをビルド & Artifact Registry へ push（タグ = タイムスタンプ）
2. `gcloud run deploy` でローカルから直接デプロイし、`.env` の値を `--env-vars-file` で一時 YAML 経由で渡す
   - `NODE_ENV=production`（固定）
   - `GEMINI_*` / `KASAN_*` / `CPOS_*` / `RECAPTCHA_*` / `RATE_LIMIT_*` / `TRUST_PROXY` / `MAX_UPLOAD_BYTES` / `HOST` を全て自動転送
   - GCP デプロイ専用の値（`GCP_PROJECT_ID` / `CLOUD_RUN_*` 等）と `your-...` のような placeholder 値は除外
   - 一時 YAML ファイルはデプロイ完了直後に削除（機密漏えい防止）
3. デプロイ後の URL（`https://kasan-manager-xxxxx-an.a.run.app`）を表示

```bash
npm run deploy:cloudrun
```

完了後の確認:

```bash
gcloud run services describe kasan-manager --region=asia-northeast1
curl -s "$(gcloud run services describe kasan-manager --region=asia-northeast1 --format='value(status.url)')/api/health"
```

`/api/health` が `{"ok":true,"gemini_configured":true,"model":"gemini-2.5-flash",...}` を返せば成功です。

### バリエーション

```bash
# ローカルで Docker ビルドしたい
npm run deploy:cloudrun:local

# .env だけ更新して再デプロイ（イメージは既存の最新を再利用）
npm run deploy:cloudrun -- --skip-build
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

> ⚠️ Cloud Run Domain Mappings は一部リージョンで `preview` 状態です。`asia-northeast1` は GA。利用可能リージョンは [公式ドキュメント](https://cloud.google.com/run/docs/mapping-custom-domains) を確認してください。

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

新しいイメージ（タグ = 新タイムスタンプ）でビルド & push し、Cloud Run が新リビジョンを 100 % トラフィックで起動します。

### 5-2. `.env` の値を更新したい（API キー / モデル / 設定値）

`.env` を編集してから:

```bash
# ビルドせず env だけ更新（最速・推奨）
npm run deploy:cloudrun -- --skip-build
```

`--skip-build` を付けると、Artifact Registry にある最新イメージをそのまま再デプロイし、`.env` の最新値を `--env-vars-file` 経由で全て適用します。

例えば CPOS 連携を有効化したい場合:

```bash
# .env に追加
echo "KASAN_SESSION_SECRET=$(openssl rand -hex 32)" >> .env
echo "KASAN_DEFAULT_CPOS_BASE_URL=https://cpos.example.jp" >> .env

# 反映（30 秒）
npm run deploy:cloudrun -- --skip-build
```

デプロイログに「`Cloud Run に転送する環境変数（機密値はマスク）`」のリストが出るので、意図した値が転送されたか確認できます。

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

### 6-2. `.env` ファイルと `GEMINI_API_KEY` の取り扱い

本構成は `.env` の値を Cloud Run の環境変数として直接設定するため、以下の点に注意してください。

- **Cloud Run の管理者** （`roles/run.viewer` 以上）は環境変数を読み取れます。最小権限の原則で IAM を運用してください
- **Cloud Build のログ** には API キーは出ません（cloudbuild.yaml はビルドのみ・デプロイは別コマンド）
- `.env` をコミットしない（`.gitignore` 済）
- ローカル PC が紛失・侵害された場合の影響を最小化するため、定期的にキーをローテーション
- 共有時は鍵管理ツール（1Password / GCP Secret Manager / Vault）経由でやり取り

より高いセキュリティが必要な場合は [8. Secret Manager 連携（opt-in）](#8-secret-manager-連携opt-in) を参照してください。

### 6-3. アップロードファイル

サーバ側ではメモリ上で処理し、永続化しません。ただし Gemini API へ送信されるため、**個人情報（被保険者番号・氏名・住所等）はマスキング**してください。

### 6-4. 監査ログ

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
| Cloud Build | 0 円 | 無料枠 120 ビルド分/日 |
| External HTTPS LB（4-B のみ） | 約 2,500 円 | 静的 IP + 転送ルール 0.025 USD/h |
| Gemini API | 利用量に応じて | flash $0.075 / 1M input, $0.30 / 1M output |
| **合計（ライト運用）** | **約 1,000 円〜** | LB 利用なし・月 1,000 リクエスト想定 |
| **合計（本番LB運用）** | **約 4,000 円〜** | LB あり・月 10,000 リクエスト想定 |

---

## 8. 不正利用対策（レート制限 + reCAPTCHA）

ログイン無しの公開サイトでも、**IP 単位のレート制限**と **Google reCAPTCHA v3** で
連打 / Bot アクセスから守れます。本リポジトリには両方の仕組みが組み込まれており、
`.env` の値で動的にオン / オフ・閾値を切り替えられます。

### 8-1. レート制限

`.env` 設定:

```ini
RATE_LIMIT_ENABLED=true            # オン/オフ
RATE_LIMIT_GENERAL_MAX=60          # 一般 API（/api/health, /api/services 等）の窓内上限
RATE_LIMIT_GENERAL_WINDOW_MS=600000  # 10 分窓（ミリ秒）
RATE_LIMIT_HEAVY_MAX=10            # 高コスト API（/api/analyze, /api/judge, /api/import-receipt）
RATE_LIMIT_HEAVY_WINDOW_MS=600000  # 10 分窓
TRUST_PROXY=1                      # Cloud Run 直は 1、外部 LB 経由なら 2
```

仕様:

- IP ごとに独立してカウント（X-Forwarded-For を `trust proxy` で読む）
- 上限を超えると `429 Too Many Requests` を返却。レスポンス JSON に `retry_after_seconds` を含める
- `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` ヘッダ（draft-7）を全レスポンスに付与
- フロントは 429 を受け取ると「アクセス回数の上限に達しました」と人間向けに表示

設定を変更したいときは `.env` を編集して `npm run deploy:cloudrun -- --skip-build` で即時反映。

### 8-2. reCAPTCHA v3

[Google reCAPTCHA Admin Console](https://www.google.com/recaptcha/admin) で **v3** 用キーを発行（`reCAPTCHA v3` を選択）し、ドメインに `kasan.example.jp` を登録。

`.env` 設定:

```ini
RECAPTCHA_ENABLED=true             # 任意（site_key/secret 両方が空なら自動的に false）
RECAPTCHA_SITE_KEY=6LcXXXXXXXXXXXXXXXXXXXXXXX    # 公開鍵
RECAPTCHA_SECRET_KEY=6LcXXXXXXXXXXXXXXXXXXXXXXX  # 秘密鍵
RECAPTCHA_MIN_SCORE=0.5            # 0.0〜1.0、これ未満は bot とみなして 403
```

仕様:

- フロントは `/api/health` から `site_key` を受け取り、`grecaptcha.execute(siteKey, { action })` でトークンを取得
- バックエンドは `/api/analyze` `/api/judge` `/api/import-receipt` で
  `recaptcha_token` フィールド（または `X-Recaptcha-Token` ヘッダ）を検証
- Google の siteverify に `secret` + `token` + `remoteip` を渡し、`success: true` && `score >= MIN_SCORE` && `action` 一致を確認
- 失敗時は `403 recaptcha_*` 系のエラーを返却
- フッターに reCAPTCHA バッジと利用規約リンクを自動表示（Google の利用規約で必須）

#### 閾値の目安

| `MIN_SCORE` | 用途 |
|---|---|
| `0.3` | 緩め（誤検知少なめ・bot は通る可能性あり） |
| `0.5`（デフォルト） | 標準 |
| `0.7` | 厳しめ（一般ユーザーも稀にブロックされる） |

最初は `0.3` で運用開始 → Cloud Logging で `recaptcha_low_score` を観察 → 徐々に絞ることを推奨します。

#### reCAPTCHA をオフにする

`.env` の `RECAPTCHA_SITE_KEY` と `RECAPTCHA_SECRET_KEY` を空にして再デプロイすれば即座に無効化されます（フロントは `/api/health` の `recaptcha.enabled=false` を見て、トークン取得をスキップします）。

### 8-3. Cloud Run 側で確認

`/api/health` のレスポンスで現在の設定が確認できます:

```bash
curl -s https://kasan.example.jp/api/health | jq '{ rate_limit, recaptcha }'
# {
#   "rate_limit": { "enabled": true, "general_max": 60, ... },
#   "recaptcha":  { "enabled": true, "site_key": "6Lc...", "min_score": 0.5 }
# }
```

### 8-4. ログ監視

```bash
# レート制限がよく発動している IP を抽出
gcloud logging read 'resource.type=cloud_run_revision AND
  resource.labels.service_name=kasan-manager AND
  jsonPayload.error="rate_limit_exceeded"' \
  --format='value(httpRequest.remoteIp)' --limit=200 | sort | uniq -c | sort -rn

# reCAPTCHA 低スコアで弾かれたリクエスト
gcloud logging read 'resource.type=cloud_run_revision AND
  resource.labels.service_name=kasan-manager AND
  jsonPayload.error="recaptcha_low_score"' --limit=50
```

### 8-5. これでも守りきれないとき

- Cloud Armor でグローバル WAF（IP/国/UA で deny ルール）を追加
- IAP（Identity-Aware Proxy）で社内 Google アカウント限定に切り替え（[§6-1](#6-1-アクセス制御) 参照）

---

## 9. Secret Manager 連携（opt-in）

`.env` 経由ではなく Secret Manager で API キーを管理したい場合は、以下の手順で切り替えられます。

### 8-1. 初期セットアップ

```bash
# Secret Manager API を有効化 + Secret 作成 + IAM 付与
npm run setup:gcp -- --use-secret

# Gemini API キーを登録
printf '%s' 'AIzaSyXXXXXXXXXXXXXXXXX' | gcloud secrets versions add gemini-api-key --data-file=-
```

### 8-2. デプロイ時に手動で `--update-secrets` を使う

`npm run deploy:cloudrun` のあとに、Secret 参照に上書きする:

```bash
gcloud run services update kasan-manager \
  --region=asia-northeast1 \
  --update-secrets=GEMINI_API_KEY=gemini-api-key:latest \
  --remove-env-vars=GEMINI_API_KEY
```

> 注意: 通常の `npm run deploy:cloudrun` は `.env` の値で `--set-env-vars` を上書きするため、Secret Manager 連携後は `--skip-build` を付けて実行する場合も `.env` の `GEMINI_API_KEY` が空の状態にしてから実行してください。
> 安定運用するなら、独自のデプロイラッパーを書く（`scripts/deploy-with-secret.js` 等）ことを推奨します。

---

## 10. トラブルシュート

### Q. Windows で `spawn gcloud ENOENT` が出る

Google Cloud SDK のインストールが PATH に通っているか確認してください。Windows では `gcloud` の実体が `gcloud.cmd` ですが、本リポジトリの bin スクリプトは内部で自動的に `.cmd` を付与して解決します。それでも ENOENT が出る場合:

1. PowerShell / コマンドプロンプトを再起動（インストール後の PATH 反映待ち）
2. 直接実行できるか確認: `gcloud --version`
3. `where.exe gcloud` で PATH を確認
4. インストール時に「Run gcloud init」「Add to PATH」にチェックを入れたか
5. それでも駄目なら `gcloud` のフルパス（例: `C:\Program Files (x86)\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd`）を含むディレクトリを `PATH` 環境変数に手動追加

### Q. デプロイ時に `Permission denied`

Cloud Build SA に IAM が付与されていない可能性。`npm run setup:gcp` を再実行してください。

### Q. Cloud Run が起動して 0.5 秒で再起動を繰り返す

`PORT` 環境変数で listen していない可能性。`src/server.js` で `process.env.PORT` を読んでいることを確認。本リポジトリは標準で対応済みです。

### Q. Gemini 接続 OK ステータスにならない

```bash
# Cloud Run の環境変数を確認
gcloud run services describe kasan-manager --region=asia-northeast1 \
  --format=json | jq '.spec.template.spec.containers[0].env'
```

`GEMINI_API_KEY` の `value` が `your-gemini-api-key-here` になっていないか確認してください。`.env` を直して `npm run deploy:cloudrun -- --skip-build` で再適用します。

### Q. `.env` を直したのに反映されない

`npm run deploy:cloudrun -- --skip-build` を実行してください。実行ログに「Cloud Run に転送する環境変数」一覧が出るので、目的の値が含まれているか確認できます。

それでも反映されない場合は、Cloud Run 側の現在値を直接確認してください:

```bash
gcloud run services describe kasan-manager --region=asia-northeast1 \
  --format='value(spec.template.spec.containers[0].env)'
```

`KASAN_SESSION_SECRET` などが見えなければ転送されていません。

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

## 11. 削除（クリーンアップ）

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
gcloud artifacts repositories delete kasan-manager --location=asia-northeast1
# Secret Manager を使った場合のみ
gcloud secrets delete gemini-api-key
```

---

## 関連ドキュメント

- [USER_GUIDE.md](./USER_GUIDE.md) — Web UI の使い方（事業所スタッフ向け）
- [TECHNICAL.md](./TECHNICAL.md) — アーキテクチャ・API・カスタマイズ
- [CLI.md](./CLI.md) — コマンドラインツールの使い方
