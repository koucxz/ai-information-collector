# syntax=docker/dockerfile:1
# 构建上下文必须是仓库根目录（需要带上 skills/ 里的 fixture 数据）
#   docker build -f server/Dockerfile -t signaldock-api .

# SignalDock server —— Node 24（node:sqlite 需要 >= 22.5，官方建议 24）
FROM node:24-alpine AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS runner
WORKDIR /app
# 不装 tini：Alpine 官方 CDN 在国内服务器上基本拉不动，且本服务无子进程需要回收
RUN mkdir -p /data

ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_URL="file:/data/signaldock.db"

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# FixtureAdapter 默认读 cwd/../skills/hot-monitor/fixtures，故放到 /skills
COPY skills /skills

# 腾讯云云托管默认监听 8080；SQLite 数据文件放 /data（需挂载持久化存储）
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
