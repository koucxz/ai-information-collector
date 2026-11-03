FROM node:24-bookworm-slim AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./dist
COPY skills /app/skills
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3001
CMD ["npm", "start"]

