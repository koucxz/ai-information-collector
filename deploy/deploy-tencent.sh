#!/usr/bin/env bash
# 后端 → 腾讯云
#
# 方式 A：已有服务器（轻量应用服务器 / CVM / 任意 Linux，推荐）
#   SSH_HOST=1.2.3.4 SSH_USER=root ./deploy/deploy-tencent.sh server
#   SSH_HOST=1.2.3.4 SSH_USER=ubuntu SSH_KEY=~/.ssh/id_ed25519 \
#     CLIENT_URL=https://signaldock.vercel.app ./deploy/deploy-tencent.sh server
#
#   可选变量：
#     SSH_PORT=22            SSH 端口
#     SSH_KEY=~/.ssh/id_rsa  私钥路径（不填用 ssh-agent / 默认密钥）
#     DEPLOY_DIR=/opt/signaldock  远端目录
#     SUDO=auto|1|0         远端是否用 sudo（auto=自动探测）
#     CLIENT_URL=...         写进远端 server/.env 的允许来源
#
# 方式 B：云托管 CloudBase Run（容器，自带 HTTPS 域名，需挂载 CFS 持久化 /data）
#   TENCENT_REGISTRY=ccr.ccs.tencentyun.com TENCENT_NAMESPACE=xxx \
#   TENCENT_USER=xxx TENCENT_PASSWORD=xxx ./deploy/deploy-tencent.sh cloudrun
set -euo pipefail

MODE="${1:-server}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${TENCENT_IMAGE:-signaldock-api}"
TAG="${TENCENT_TAG:-latest}"

case "${MODE}" in
  server | lighthouse)
    HOST="${SSH_HOST:-${LIGHTHOUSE_HOST:-}}"
    TARGET_USER="${SSH_USER:-${LIGHTHOUSE_USER:-root}}"
    PORT="${SSH_PORT:-${LIGHTHOUSE_PORT:-22}}"
    DEPLOY_DIR="${DEPLOY_DIR:-${LIGHTHOUSE_PATH:-/opt/signaldock}}"
    SSH_KEY="${SSH_KEY:-${LIGHTHOUSE_SSH_KEY:-}}"
    SUDO_MODE="${SUDO:-${LIGHTHOUSE_SUDO:-auto}}"

    [[ -n "${HOST}" ]] || { echo "缺少 SSH_HOST（服务器公网 IP）" >&2; exit 1; }

    SSH_CMD=(ssh -p "${PORT}" -o StrictHostKeyChecking=accept-new)
    [[ -n "${SSH_KEY}" ]] && SSH_CMD+=(-i "${SSH_KEY}")
    TARGET="${TARGET_USER}@${HOST}"

    remote() { "${SSH_CMD[@]}" "${TARGET}" "$@"; }

    echo "→ 预检 ${TARGET}"
    command -v rsync >/dev/null || { echo "本地缺少 rsync" >&2; exit 1; }
    remote "true" || { echo "SSH 连不上 ${TARGET}:${PORT}" >&2; exit 1; }

    if ! remote "command -v docker >/dev/null 2>&1"; then
      cat >&2 <<'EOF'
远端没有 Docker。请在服务器上执行：
  curl -fsSL https://get.docker.com | sh && systemctl enable --now docker
装好后重新运行本脚本。
EOF
      exit 2
    fi

    # 判断是否需要 sudo 才能用 docker
    if [[ "${SUDO_MODE}" == "auto" ]]; then
      if remote "docker info >/dev/null 2>&1"; then
        SUDO=""
      elif remote "sudo -n docker info >/dev/null 2>&1"; then
        SUDO="sudo -n"
      else
        echo "当前用户既不能直接用 docker，也无法免密 sudo。"
        echo "任选其一：把用户加入 docker 组（usermod -aG docker ${TARGET_USER} && 重新登录），或给该用户配置免密 sudo。"
        exit 3
      fi
    elif [[ "${SUDO_MODE}" == "1" ]]; then
      SUDO="sudo -n"
    else
      SUDO=""
    fi
    echo "   docker 权限方式: ${SUDO:-直连}"

    echo "→ 同步代码到 ${TARGET}:${DEPLOY_DIR}"
    remote "${SUDO} mkdir -p ${DEPLOY_DIR}"
    RSYNC_SSH="ssh -p ${PORT} -o StrictHostKeyChecking=accept-new"
    [[ -n "${SSH_KEY}" ]] && RSYNC_SSH="${RSYNC_SSH} -i ${SSH_KEY}"
    rsync -az --delete \
      --exclude '.git' --exclude 'node_modules' --exclude 'dist' \
      --exclude 'data' --exclude 'client' --exclude '.env' \
      --rsync-path="${SUDO:+${SUDO} }rsync" \
      -e "${RSYNC_SSH}" \
      "${ROOT_DIR}/" "${TARGET}:${DEPLOY_DIR}/"

    echo "→ 初始化远端配置"
    remote "${SUDO} bash -lc $(printf '%q' "cd ${DEPLOY_DIR} && mkdir -p data && { [ -f server/.env ] || cp server/.env.production.example server/.env; }")"

    if [[ -n "${CLIENT_URL:-}" ]]; then
      echo "→ 写入 CLIENT_URL=${CLIENT_URL}"
      remote "${SUDO} bash -lc $(printf '%q' "cd ${DEPLOY_DIR} && sed -i 's|^CLIENT_URL=.*|CLIENT_URL=${CLIENT_URL}|' server/.env")"
    fi

    echo "→ 远端构建并启动容器"
    remote "${SUDO} bash -lc $(printf '%q' "cd ${DEPLOY_DIR} && docker compose up -d --build api && docker compose ps")"

    echo "→ 等待健康检查（从本机访问公网地址，等价于 Vercel 的视角）"
    for _ in $(seq 1 30); do
      if curl -fsS -m 3 "http://${HOST}:3001/api/health" >/dev/null 2>&1; then
        echo "✅ 后端已就绪：http://${HOST}:3001/api/health"
        curl -s "http://${HOST}:3001/api/health"
        echo
        echo "下一步：./deploy/deploy-vercel.sh http://${HOST}:3001"
        exit 0
      fi
      sleep 2
    done
    echo "⚠️  公网健康检查未通过。排查顺序：" >&2
    echo "   1) 云厂商防火墙/安全组是否放行 3001" >&2
    echo "   2) 容器日志: ${SSH_CMD[*]} ${TARGET} '${SUDO} docker compose -f ${DEPLOY_DIR}/docker-compose.yml logs --tail=50'" >&2
    exit 4
    ;;

  cloudrun)
    : "${TENCENT_REGISTRY:?缺少 TENCENT_REGISTRY，例如 ccr.ccs.tencentyun.com}"
    : "${TENCENT_NAMESPACE:?缺少 TENCENT_NAMESPACE}"
    REMOTE_TAG="${TENCENT_REGISTRY}/${TENCENT_NAMESPACE}/${IMAGE}:${TAG}"

    if [[ -n "${TENCENT_USER:-}" && -n "${TENCENT_PASSWORD:-}" ]]; then
      echo "→ 登录镜像仓库 ${TENCENT_REGISTRY}"
      echo "${TENCENT_PASSWORD}" | docker login "${TENCENT_REGISTRY}" -u "${TENCENT_USER}" --password-stdin
    fi

    echo "→ 构建镜像 ${REMOTE_TAG}（linux/amd64）"
    docker build --platform linux/amd64 -f "${ROOT_DIR}/server/Dockerfile" -t "${REMOTE_TAG}" "${ROOT_DIR}"
    docker push "${REMOTE_TAG}"

    echo "→ 镜像已推送。请在腾讯云「云托管」控制台创建/更新服务："
    echo "   镜像: ${REMOTE_TAG}"
    echo "   端口: 8080"
    echo "   环境变量: DATABASE_URL=file:/data/signaldock.db, CLIENT_URL=https://<你的前端域名>"
    echo "   存储挂载: CFS 挂载到 /data（否则 SQLite 数据随实例回收丢失）"
    ;;

  *)
    echo "未知模式: ${MODE}（可选 server | cloudrun）" >&2
    exit 1
    ;;
esac
