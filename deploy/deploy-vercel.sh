#!/usr/bin/env bash
# 前端 → Vercel
#
#   VERCEL_TOKEN=xxx ./deploy/deploy-vercel.sh https://api.example.com
#
# 参数：腾讯云后端访问地址（Vercel 会把 /api/* 反代到这里）
# 可选环境变量：
#   VERCEL_SCOPE     团队/用户名，默认个人
#   VERCEL_PROJECT   项目名，默认 signaldock
set -euo pipefail

API_HOST="${1:-}"
if [[ -z "${API_HOST}" ]]; then
  echo "用法: VERCEL_TOKEN=xxx $0 https://api.example.com" >&2
  exit 1
fi
if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "缺少 VERCEL_TOKEN（Vercel → Account Settings → Tokens 创建）" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${VERCEL_PROJECT:-signaldock}"

cd "${ROOT_DIR}"
node deploy/gen-vercel-config.mjs "${API_HOST}"

cd "${ROOT_DIR}/client"
SCOPE_ARGS=()
if [[ -n "${VERCEL_SCOPE:-}" ]]; then
  SCOPE_ARGS=(--scope "${VERCEL_SCOPE}")
fi

echo "→ 开始部署前端到 Vercel（项目：${PROJECT}）"
npx --yes vercel@latest deploy --prod --yes \
  --token "${VERCEL_TOKEN}" \
  --name "${PROJECT}" \
  "${SCOPE_ARGS[@]}"
