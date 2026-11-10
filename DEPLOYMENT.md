# 本次升级部署

本次升级新增“多条信息 → 选题工作台 → 行动清单”，并启用所有业务 API 和实时连接的会话校验。无需新数据库、外部登录服务或手工导入数据。现有 SQLite 启动时会自动增量建表，保留采集记录和主题。旧版 `collection_runs(id, created_at, payload_json)` 会自动转换，完整原始采集结果继续保存在 `legacy_payload_json` 中。

部署目标为远端 **`main`**。以下命令检出远端 main 的确切版本，不要求服务器上已有的本地分支与其历史一致。

## 部署前准备

1. 先从“数据与设置 → 下载备份”保存 JSON；再按现有运维方式备份 SQLite 文件或整个数据卷。不要运行 `docker compose down -v`。
2. 切换前另存当前的 `server/.env`、HTTPS 代理配置和部署脚本，尤其是旧版仓库里的 `deploy/Caddyfile`。新版 Compose 和旧版编排不同，不沿用旧脚本直接启动。Docker Compose 从**仓库根目录的 `.env`**读取变量；直接运行后端则使用 `server/.env`。
3. 检查以下配置：

| 变量 | 配置 |
| --- | --- |
| `NODE_ENV` | `production`（Compose 已设置） |
| `CLIENT_URL` | 浏览器实际访问的 HTTPS **源**，例如 `https://notes.example.com`；不含尾斜杠和 `/sd` 路径 |
| `ADMIN_USERNAME` | `admin` 或当前管理员名称 |
| `ADMIN_PASSWORD` | 显式填写之前指定的完整密码；末尾英文句号必须保留 |
| `SESSION_SECRET` | 至少32字符的随机值，不能使用示例文本；不同后端进程必须一致 |
| `DATABASE_URL` | 保持当前数据库路径，Compose 中为 `file:/data/signaldock.db` |
| `SIGNALDOCK_DATA_PATH` | 旧 main 使用仓库的 `./data` 目录时必须设为 `./data`；可填实际宿主机目录；已有默认命名卷则不设置此项，并沿用相同 Compose 项目名 |
| `TRUST_PROXY` | 使用本仓库同域代理时为 `true`；后端不要直接暴露公网 |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | 沿用现有 AI 配置；密钥仅放后端 |
| `AI_DAILY_LIMIT` | 全部 AI 外部请求每日上限，默认300，含失败和重试 |
| `BRIEF_DAILY_LIMIT` | 每日新批次选题生成上限，默认30；复用已有草稿不计数 |

两个每日额度均按 UTC 日期计数，重启服务不会重置；次数限制不等同于供应商的金额上限。

在服务器上生成会话密钥，再将输出填入 `.env`：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

生产环境缺少显式密码、使用示例会话密钥或密钥长度不足时，服务会拒绝启动。此次升级会让旧版无登记令牌失效，需要重新登录。密码不会被本次代码自动更换。

## 域名、HTTPS 与代理

建议前后端同域：HTTPS 入口将 `/` 转发至前端，将 `/api/` 和 `/socket.io/` 交给同一后端。仓库自带的前端 Nginx 已转发这两条路径；外层 HTTPS 代理转发到 `127.0.0.1:8080`，必须支持 WebSocket Upgrade。

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120s;
}
```

此片段放入已经配置证书的 HTTPS server 块。Compose 仅将前端端口绑定本机回环地址；不要公开后端3001端口。生产 Cookie 为 `HttpOnly; Secure; SameSite=Strict`，因此不能通过普通 HTTP 或跨站直连云服务器 IP 登录。`CLIENT_URL` 必须与浏览器 Origin 完全匹配。

若前端仍部署在 Vercel：浏览器请求必须走前端同源 `/api/` 代理，并为实时通道配置可用的同站 WebSocket 入口；仅有 Vercel HTTP rewrite 不能保证 WebSocket 工作。最省配置的部署方式是把该前端也放到同一 HTTPS 反向代理后。

若现有站点使用 `/sd/` 子路径，请沿用现有完整代理规则并确认请求的 `/api/`、`/socket.io/` 实际也转发到该应用。前端 API 使用根路径；不要只代理 `/sd/api/` 而漏掉 `/api/`。本仓库默认根路径部署。

## 更新

先停止使用相同数据库的旧后端；如果旧容器名为 `signaldock-api`，执行 `docker stop signaldock-api`，并在新服务验收后删除旧容器/关闭公网3001端口，防止旧匿名 API 继续暴露。保留现有数据库与证书卷。

使用现有持久卷、同一 Compose 项目名和同一数据库路径。若使用旧版 `./data` 目录，确保目录和数据库对容器 UID 1000 可写；不要把原库误换成一个新空卷。

若数据在自定义名称的 Docker volume 中，需要使用 Compose override 将 `signaldock-data` 映射到那个 external volume；不要将未声明的卷名直接填入 `SIGNALDOCK_DATA_PATH`。

```sh
git fetch origin
git switch --detach origin/main
docker compose up -d --build
docker compose logs --tail=100 server
```

以上部署检出会处于 detached HEAD，后续更新继续执行 `git fetch origin` 和 `git switch --detach origin/main`。旧 Caddy 容器若仍代理 `api:8080`，需要改为新前端 `client:80`（同一 Docker 网络），或改用前述宿主机 HTTPS 代理到 `127.0.0.1:8080`。旧公网/API直连方式不能直接照搬。

如直接运行源码，使用 Node.js 24+：后端 `npm ci && npm run build && npm start`，前端 `npm ci && npm run build` 并发布 `client/dist`；重启后端以执行增量建表。不需要 Prisma migration。备份恢复上传支持最大20MB。

## 上线验收

1. 未登录访问 `/api/health` 返回200；`/api/information`、`/api/briefs`、采集接口返回401。
2. 管理员登录后标题及“查看原文”能新标签打开；缺失或非法链接显示提示。
   旧采集记录若已丢失原始域名，请重新采集一次以更新地址；仍沿用原有去重键，不会仅因恢复 `www` 就新增重复记录。
3. 采集后跨分页选择2–20条信息，提炼选题；AI不可用时明确显示本地模板。
4. 修改提纲并保存，刷新仍保留；重复生成相同来源保留已有草稿。
5. 编辑并勾选行动、保存；全部完成后可归档/恢复；导出包含来源与行动。
6. 退出后旧 Cookie 的读写请求返回401，已有 Socket 断开；会话过期后回登录。

新增选题、行动与来源快照包含在 JSON 备份中；会话和额度计数不进入便携备份。恢复旧备份会清空其中没有的选题表，应提前另存新版备份。恢复到旧代码前保留新数据库备份，避免丢失新增功能数据。
