# 综合选题与鉴权 Implementation Plan

> **For agentic workers:** 按本计划在当前会话逐项实施并验收；不部署。

**Goal:** 按已确认设计实现多条信息综合生成选题、编辑提纲、执行行动及可撤销管理员会话。

**Architecture:** 延用 React/Express/SQLite。独立 editorial_briefs 表保存选题及来源快照，版本号阻止并发覆盖；auth_sessions 保存会话撤销状态。AI 只综合批量来源，失败明确回退本地模板；重复输入复用草稿，限流及持久额度控制成本。

**Tech Stack:** TypeScript、React 19、Ant Design、Express 5、node:sqlite、Vitest。

---

### 1. 服务端工作流

- [x] 修改 `server/src/db/client.ts` 添加选题、会话及生成额度表（启动时增量建表，不重建历史数据）。
- [x] 新建 `server/src/modules/briefs/{brief.schemas,brief.store,brief.service,brief.routes}.ts`；2–20 条已存来源综合生成最多三个选题；验证 AI 引用仅来自输入；缺少密钥或失败时使用模板，标明待核验。
- [x] `GET /api/briefs` 列表；`POST /generate` 生成；`PATCH /:id` 版本校验更新标题、读者、角度、提纲、任务和归档状态。归档须全部行动完成，重复生成保留用户修改。
- [x] 修改 `server/src/app.ts` 注册受鉴权路由；修改 `server/src/modules/data/data.service.ts` 支持选题备份恢复（不导出会话和成本计数）。

### 2. 鉴权及原文

- [x] 修改 `server/src/auth.ts`、`modules/auth/auth.routes.ts`：登记随机会话、退出撤销、严格令牌解析、所有环境启用鉴权。
- [x] 修改 `server/src/realtime.ts`：握手拒绝匿名，退出立即断开，过期定时断开，清理订阅和计时器。
- [x] 修改 `server/src/config/env.ts`：生产显式密码和至少32字符随机 SESSION_SECRET；不改变用户指定密码。
- [x] 修改 `client/src/shared/api.ts`、`App.tsx`：401 回登录，退出入口，断开的实时连接重新检查身份。
- [x] 信息卡片标题和“查看原文”使用经过 HTTP(S) 校验的链接，不显示单条展开分析操作；修复服务端来源筛选参数遗漏。

### 3. 前端三步流程

- [x] 新建 `client/src/features/editorial/EditorialWorkspace.tsx` 及样式；发现页复选多条，按钮综合提炼，采集完成提供后续入口。
- [x] 工作台显示持久选题列表、可编辑标题/读者/角度/提纲、参考原文、待核验项、明确保存状态、复制和 Markdown 导出。
- [x] 行动清单编辑/添加/勾选/日期、关联选题、进度、全部完成后归档/恢复。请求中禁用重复操作；保存冲突保留本地编辑。
- [x] 主导航使用发现信息/选题工作台/行动清单，原运维入口保留在管理菜单。搜索使用服务端全库查询。

### 4. 验收与部署说明

- [x] 新增真实匿名/错误密码/篡改/退出重放/过期及 Socket 鉴权测试；业务测试通过测试助手显式附会话 Cookie，不绕过中间件。
- [x] 新增批量生成、AI 非法引用回退、幂等复用、编辑和版本冲突、行动归档、备份恢复、额度测试。
- [x] `cd server; npm test; npm run build`；`cd client; npm run build`；`git diff --check`。按需真实浏览器验证。
- [x] 修改 `.env.example`、`docker-compose.yml`、新增 `DEPLOYMENT.md`：HTTPS 同域代理 `/api` 与 `/socket.io`、CLIENT_URL、管理员凭据、随机会话密钥、持久卷备份及自动建表；不运行部署。
- [x] 仅提交本轮明确修改的文件，不带入原有 `client/public/` 和旧计划文件。

## 验收记录

- 79项服务端测试通过，包括真实REST/Socket鉴权、退出重放、自动过期、AI结构化引用、失败回退、生成幂等与备份恢复。
- 前后端生产构建通过；生产依赖 npm audit 均为0项已知漏洞。
- 使用独立验收SQLite验证登录、三条信息综合生成、标题保存、行动勾选保存、刷新保留、退出回登录；390px窄屏选题与行动页无水平溢出。
- AI外部调用使用模拟响应验证，未消耗线上API额度；未执行线上部署。
- 来源快照独立于采集记录保存，来源被删除后旧选题仍可恢复和导出；会话和成本计数不进入便携备份。
- 现有 client/public/ 与旧计划文件保留在工作区，不纳入本次提交。
