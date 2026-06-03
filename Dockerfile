# =====================================================
# 加算マネージャー Web版 — Cloud Run 用 Dockerfile
# Node.js 20-alpine + 加算マスタ JSON。Python 一切不要。
# =====================================================
FROM node:20-alpine AS deps

WORKDIR /workspace/app
COPY app/package.json app/package-lock.json* ./
RUN npm ci --omit=dev


FROM node:20-alpine AS runtime

WORKDIR /workspace

# regulatory_master / schemas / config はマスタとして読み込む。docs は /docs/* で配信。
COPY --chown=node:node regulatory_master ./regulatory_master
COPY --chown=node:node schemas ./schemas
COPY --chown=node:node config ./config
COPY --chown=node:node docs ./docs

WORKDIR /workspace/app
COPY --chown=node:node --from=deps /workspace/app/node_modules ./node_modules
COPY --chown=node:node app/package.json ./package.json
COPY --chown=node:node app/src ./src
COPY --chown=node:node app/public ./public
COPY --chown=node:node app/bin ./bin

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

# Cloud Run は Dockerfile HEALTHCHECK を無視するが、ローカル docker run / Compose 互換のため残す
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

USER node
CMD ["node", "src/server.js"]
