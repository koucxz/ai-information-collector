# 部署指南：腾讯云服务器（后端） + Vercel（前端）

## 〇、当前线上状态（2026-11-03 已部署）

| 项 | 值 |
| --- | --- |
| 前端 | https://signaldock-five.vercel.app （Vercel 项目 `signaldock`） |
| 后端 | `http://106.55.19.23:3001`（腾讯云轻量 `lhins-hh42rg97`，广州，与 video-note 同机） |
| 服务器目录 | `/opt/signaldock`（容器 `signaldock-api`，数据 `./data/signaldock.db`） |
| 拓扑 | 浏览器 → Vercel → `/api/*` 服务端反代 → `106.55.19.23:3001` |
| 复用的东西 | video-note 的服务器、Docker、防火墙；**未改动**其 nginx 配置与视频服务 |

已知事项：

1. **本机与服务器都无法直连 `signaldock-five.vercel.app`**：本地 DNS 把它解析到 `198.18.12.224`（代理工具的拦截地址），服务器侧同样不通。所以线上连通性只能由能访问 vercel.app 的网络（如浏览器开代理）确认。
2. **3001 端口对公网开放且接口无鉴权**：上游 SignalDock 本身没有登录体系。这个 IP 长期被扫描，建议尽快加一层 token 中间件或改成内网 + 反代。
3. 该机器 SSH 未配置本机公钥，本次部署是通过**腾讯云命令通道**完成的；日常更新见第七节。

### 2026-11-04 前端按设计稿重做（白色主题）后的配套后端改动

| 改动 | 说明 |
| --- | --- |
| `GET /api/collect/last` | 最近一次采集结果落库（`collection_runs` 表，保留最近 20 条），刷新或换设备也能看到，不再只存浏览器 localStorage |
| 信息流排序 | 改为 `COALESCE(published_at, collected_at) DESC`。同一轮采集的条目入库时间几乎相同，按入库时间排会变成随机顺序 |
| fixture 演示数据 | `skills/hot-monitor/fixtures/hot-topics.json` 增加设计稿用例（知乎/掘金/GitHub/微博 4 条），并支持条目级 `sourceName`（缺省仍是「本地测试数据」） |
| 图标 | `client/public/favicon.svg`、`favicon-32.png`、`apple-touch-icon.png` |

重新构建后端：`cd /opt/signaldock && docker compose up -d --build api`（数据在 `./data` 卷上，重建不影响）。

## 一、为什么必须拆成两半

SignalDock 的后端是 **Express 常驻进程 + `node:sqlite` 本地数据库文件**，这决定了它不能跑在 Vercel 上：

| 约束 | 说明 |
| --- | --- |
| 文件系统 | Vercel Serverless 的磁盘只读且实例随时销毁，SQLite 写入必定失败 |
| 进程模型 | 后端依赖 `node:sqlite` 与常驻内存，Serverless 冷启动会反复重建连接 |
| Node 版本 | `node:sqlite` 需要 Node ≥ 22.5（推荐 24），需要可控运行时 |

所以采用：

```
浏览器
  │  https://<project>.vercel.app
  ▼
Vercel（client/dist 静态产物 + CDN）
  │  /api/* 由 Vercel 服务端反代（rewrites）
  ▼
腾讯云服务器（Docker: Express，监听 3001 → 容器 8080，SQLite 落持久卷）
```

前端的改造是：**只请求同源 `/api/*`**，由 Vercel 在服务端转发到腾讯云。好处有三：

1. 浏览器侧没有跨域，接口路径不用维护域名；
2. 前端 HTTPS、后端只有 HTTP 也不触发混合内容拦截（转发发生在服务端）；
3. 后端地址只对 Vercel 生效，页面源码里看不到。

> 注意一个反直觉点：正因为是**服务端**转发，后端 3001 必须**公网可达**，不能只绑 `127.0.0.1`。

---

## 二、本仓库已做的部署改造

| 文件 | 改动 |
| --- | --- |
| `client/src/App.tsx` | 新增 `API_BASE` / `apiUrl()`，所有请求走统一前缀，支持 `VITE_API_BASE` 直连模式 |
| `client/src/vite-env.d.ts` | 新增，声明 `VITE_API_BASE` 类型 |
| `client/vercel.json` | 新增，Vite 构建配置 + `/api/*` 反代 + SPA 回退 |
| `server/src/config/env.ts` | `CLIENT_URL` 支持逗号分隔多域名；新增 `ALLOW_VERCEL_PREVIEW` |
| `server/src/app.ts` | CORS 改白名单函数（含 `*.vercel.app`）；`trust proxy=1` 修复反代后限流失真 |
| `server/Dockerfile` | 新增，Node 24 多阶段构建 + healthcheck + `/data` 数据卷 |
| `server/Dockerfile.dockerignore` | 新增，构建上下文为仓库根目录时排除无关文件 |
| `docker-compose.yml` | 新增，后端编排 + 可选 Caddy 自动 HTTPS |
| `server/.env.production.example` | 新增，生产环境变量模板 |
| `deploy/gen-vercel-config.mjs` | 把后端地址写进 `client/vercel.json` |
| `deploy/deploy-tencent.sh` | 服务器部署（支持 sudo 探测、ssh key、自定义端口/目录）或云托管镜像推送 |
| `deploy/deploy-vercel.sh` | Vercel 生产部署 |

**已验证**：前后端均可构建；后端 22 个 vitest 全绿；Docker 镜像构建成功，并在容器内（Node v24.22.2）跑通「建主题 → 加关键词 → fixture 采集 → 去重入库 → 生成快照 → 信息流」；反代与直连两种前端产物都验证过。

---

## 三、你需要准备

1. **服务器**：腾讯云轻量应用服务器或 CVM，2C2G 足够；Ubuntu 22.04+。
2. **SSH 方式**：公网 IP + 用户名 + 私钥（推荐）或密码。
3. **Vercel Token**：Vercel → Account Settings → Tokens → Create。
4. 本地需要 `docker`、`node 22+`、`rsync`、`ssh`。

---

## 四、第一步：部署后端

### 前置：服务器装 Docker

```bash
ssh <user>@<IP>
curl -fsSL https://get.docker.com | sh && sudo systemctl enable --now docker
# 非 root 用户还要加入 docker 组，否则脚本会走 sudo
sudo usermod -aG docker $USER && exit   # 退出重登生效
```

### 一键部署

```bash
cd ai-information-collector

SSH_HOST=<公网IP> \
SSH_USER=<用户名> \
SSH_KEY=~/.ssh/id_ed25519 \
CLIENT_URL=https://<你的项目>.vercel.app \
./deploy/deploy-tencent.sh server
```

脚本依次做：SSH 预检 → 探 Docker 权限（直连 / 免密 sudo / 报错提示）→ rsync 代码（排除 client、node_modules、.env）→ 首次从模板生成 `server/.env` → 写入 `CLIENT_URL` → `docker compose up -d --build api` → 从本机访问公网 `/api/health` 验收。

**别忘了在腾讯云控制台的防火墙/安全组放行 3001**，否则最后一步会失败。

跑完输出应该是：

```
{"status":"ok","service":"signaldock-server","timestamp":"..."}
下一步：./deploy/deploy-vercel.sh http://<IP>:3001
```

### 想用 HTTPS 而不是裸 IP + 端口

裸 HTTP 能用（反代发生在服务端，浏览器看不到），但建议加一层：

1. 域名 A 记录指向服务器 IP；
2. 改 `deploy/Caddyfile` 里的域名；
3. 服务器上 `docker compose --profile tls up -d`，Caddy 自动申请 Let's Encrypt 证书；
4. 同时把 compose 里 api 的端口映射改回 `127.0.0.1:3001:8080`，只留 443 对外；
5. 之后 Vercel 反代目标换成 `https://api.example.com`。

---

## 五、第二步：部署前端到 Vercel

```bash
VERCEL_TOKEN=<token> \
./deploy/deploy-vercel.sh http://<服务器IP>:3001
```

脚本做两件事：把后端地址写进 `client/vercel.json` 的 `/api/*` 反代规则 → 在 `client/` 执行 `vercel deploy --prod`（首次会以 `signaldock` 为名创建项目，可用 `VERCEL_PROJECT` 覆盖）。

**直连模式**（后端有正规 HTTPS 域名时可用，省掉反代一跳）：

```bash
cd client
VITE_API_BASE=https://api.example.com npx vercel --prod
```

此时要把该来源加进后端 `server/.env` 的 `CLIENT_URL`。

---

## 六、验收清单

打开 Vercel 给出的域名，逐项确认：

- [ ] 右上角显示「服务已连接」（`/api/health` 反代通了）
- [ ] 添加关注主题 → 列表出现新主题
- [ ] 给主题加关键词，例如 `大模型`
- [ ] 点「试采一轮」→ 出现采集结果（fixture 里有匹配数据）
- [ ] 信息流出现条目，「标为已读」生效
- [ ] `docker compose restart api` 后数据仍在（验证 SQLite 落持久卷）

命令行复核：

```bash
curl -s https://<project>.vercel.app/api/health
```

---

## 七、日常发布与备份

> 前置：下表假设已配好 SSH 公钥。当前这台机器还没配，需要先把本机 `~/.ssh/id_ed25519.pub` 追加到服务器 `/root/.ssh/authorized_keys`（腾讯云控制台 VNC 或命令通道均可）。配好后 `deploy/deploy-tencent.sh` 就能一键同步。

| 场景 | 命令 |
| --- | --- |
| 只改前端 | `VERCEL_TOKEN=... ./deploy/deploy-vercel.sh <后端地址>` |
| 只改后端 | 重跑 `./deploy/deploy-tencent.sh server`（会重建镜像并滚动重启） |
| 前后端都改 | 先后端 → 确认 `/api/health` → 再前端 |
| 看日志 | `ssh <user>@<IP> "cd /opt/signaldock && sudo docker compose logs -f api"` |
| 备份数据库 | `scp <user>@<IP>:/opt/signaldock/data/signaldock.db ./backup-$(date +%F).db` |

数据库就是单个文件 `data/signaldock.db`，拷走即备份。恢复时停容器、覆盖文件、再启动。

---

## 八、常见问题

**Q：页面能开，但一直显示「服务未连接」**
按序排查：① 本机 `curl http://<IP>:3001/api/health` 是否 200（不通就是防火墙/容器问题）→ ② `client/vercel.json` 里的反代域名是否写错（http/https、端口、末尾斜杠）→ ③ Vercel 上重新部署一次让 `vercel.json` 生效。

**Q：反代 502 / 超时**
后端没起来或不可达。`sudo docker compose logs -f api` 看日志；若是 `node:sqlite` 报错，确认镜像基于 Node 24（`docker exec <容器> node -v`）。

**Q：重启容器数据没了**
`DATABASE_URL` 没指到持久卷。容器内必须是 `file:/data/signaldock.db`，且 compose 里 `./data:/data` 生效。检查 `ls -l /opt/signaldock/data/`。

**Q：浏览器报 CORS**
只有直连模式会遇到。把前端完整域名加进 `server/.env` 的 `CLIENT_URL`（逗号分隔），或临时 `CLIENT_URL=*` + `ALLOW_VERCEL_PREVIEW=false`。

**Q：百度采集返回空或报错**
`baidu.adapter.ts` 直接抓百度结果页 HTML，云服务器 IP 很容易撞验证码。生产建议接官方搜索 API，日常用 fixture 验证链路即可。

**Q：3001 直接暴露公网安全吗**
目前接口没有鉴权，等于开放读写。个人使用可接受；要收紧就把 compose 端口改回 `127.0.0.1:3001:8080` 并让 Caddy 只在 443 上暴露，或在 `app.ts` 里加一层 token 中间件。
