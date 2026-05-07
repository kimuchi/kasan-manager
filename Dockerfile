# =====================================================
# 加算マネージャー Web版 — Cloud Run 用 Dockerfile
# Node.js 20-alpine ベース。/regulatory_master を取り込んで起動。
# =====================================================
FROM node:20-alpine AS base

WORKDIR /workspace

# regulatory_master / schemas / config はマスタとして読み込む
COPY regulatory_master ./regulatory_master
COPY schemas ./schemas
COPY config ./config

# アプリ
WORKDIR /workspace/app
COPY app/package.json app/package-lock.json* ./
RUN npm ci --omit=dev

COPY app ./

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

# Cloud Run は起動コマンドを CMD に従って呼び出す
CMD ["node", "src/server.js"]
