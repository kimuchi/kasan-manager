#!/usr/bin/env bash
# =====================================================
# 加算マネージャー Web版 → Cloud Run デプロイスクリプト
#
# 必要なツール: gcloud (認証済み), docker (cloud build で代替する場合は不要)
# 必要な事前準備:
#   1) `cp .env.example .env` で .env を作成
#   2) GCP_PROJECT_ID / GCP_REGION / CLOUD_RUN_SERVICE_NAME / GCP_ARTIFACT_REPO を設定
#   3) GEMINI_API_KEY を Secret Manager に登録（推奨）
#        gcloud secrets create gemini-api-key --replication-policy=automatic
#        printf '%s' "<api-key>" | gcloud secrets versions add gemini-api-key --data-file=-
#
# 使い方:
#   bash scripts/deploy_cloud_run.sh             # Cloud Build を使ってフルデプロイ
#   bash scripts/deploy_cloud_run.sh local       # ローカル docker build + 手動 push + deploy
# =====================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  echo "❌ .env が見つかりません。.env.example をコピーして作成してください。"
  exit 1
fi

# .env を読み込む（コメント・空行を除外）
set -a
# shellcheck disable=SC1091
source <(grep -v -E '^\s*(#|$)' .env)
set +a

PROJECT_ID="${GCP_PROJECT_ID:?GCP_PROJECT_ID が .env で未設定です}"
REGION="${GCP_REGION:-asia-northeast1}"
SERVICE="${CLOUD_RUN_SERVICE_NAME:-kasan-manager}"
REPO="${GCP_ARTIFACT_REPO:-kasan-manager}"
MEMORY="${CLOUD_RUN_MEMORY:-1Gi}"
CPU="${CLOUD_RUN_CPU:-1}"
MIN="${CLOUD_RUN_MIN_INSTANCES:-0}"
MAX="${CLOUD_RUN_MAX_INSTANCES:-3}"
SECRET_NAME="${CLOUD_RUN_SECRET_NAME:-gemini-api-key}"

mode="${1:-cloudbuild}"

echo "▶ プロジェクト: $PROJECT_ID / リージョン: $REGION / サービス: $SERVICE"
echo "▶ Artifact Registry リポジトリ: $REPO"
gcloud config set project "$PROJECT_ID" >/dev/null

# Artifact Registry リポジトリの存在確認・作成
if ! gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1; then
  echo "▶ Artifact Registry リポジトリを作成: $REPO"
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker --location="$REGION" \
    --description="kasan-manager web container"
fi

# Secret Manager の確認
if ! gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1; then
  echo "⚠ Secret Manager に $SECRET_NAME が見つかりません。"
  echo "   先に下記コマンドで登録してください:"
  echo "     gcloud secrets create $SECRET_NAME --replication-policy=automatic"
  echo "     printf '%s' \"<api-key>\" | gcloud secrets versions add $SECRET_NAME --data-file=-"
  exit 1
fi

if [ "$mode" = "local" ]; then
  IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE:$(date +%Y%m%d-%H%M%S)"
  echo "▶ ローカルで docker build → push → deploy: $IMAGE"
  gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
  docker build -t "$IMAGE" -t "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE:latest" .
  docker push "$IMAGE"
  docker push "$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE:latest"
else
  IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/$SERVICE:latest"
  echo "▶ Cloud Build でビルド & デプロイ"
  gcloud builds submit --config cloudbuild.yaml \
    --substitutions="_REGION=$REGION,_REPO=$REPO,_SERVICE=$SERVICE,_GEMINI_SECRET_NAME=$SECRET_NAME,_MEMORY=$MEMORY,_CPU=$CPU,_MIN_INSTANCES=$MIN,_MAX_INSTANCES=$MAX"
  exit 0
fi

echo "▶ Cloud Run へデプロイ"
gcloud run deploy "$SERVICE" \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --memory="$MEMORY" --cpu="$CPU" \
  --min-instances="$MIN" --max-instances="$MAX" \
  --port=8080 \
  --set-env-vars="NODE_ENV=production,GEMINI_MODEL=${GEMINI_MODEL:-gemini-2.5-flash}" \
  --update-secrets="GEMINI_API_KEY=$SECRET_NAME:latest"

echo "✅ デプロイ完了。サービス URL:"
gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)'
