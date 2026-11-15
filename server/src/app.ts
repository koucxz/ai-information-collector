import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { topicRouter } from './modules/topics/topic.routes.js';
import { collectionRouter } from './modules/collection/collection.routes.js';
import { informationRouter } from './modules/collection/information.routes.js';
import { historyRouter } from './modules/collection/history.routes.js';
import { analysisRouter } from './modules/analysis/analysis.routes.js';
import { aiTokenUsage } from './modules/analysis/ai-budget.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { eventRouter } from './modules/events/event.routes.js';
import { dataRouter } from './modules/data/data.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { requireAuth } from './auth.js';
import { briefRouter } from './modules/briefs/brief.routes.js';
import { telemetryRouter } from './modules/telemetry/telemetry.routes.js';
import { collectionRunner } from './modules/automation/collection.scheduler.js';
import { resolveCollectionSources } from './modules/collection/source.registry.js';
import { jobQueue } from './modules/jobs/job.queue.js';
import { ensureTopicTags } from './modules/collection/topic-tagger.js';

export const app = express();
// 首次启动或主题配置变化后，把历史信息按最新规则重新打标
ensureTopicTags();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY ? 1 : 0);
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' http://localhost:3001 http://localhost:5173; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'");
  if (env.NODE_ENV === 'production') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(cors({ origin: env.CLIENT_URL, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use((request, response, next) => {
  const origin = request.get('Origin');
  if (origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin !== env.CLIENT_URL) return response.status(403).json({ error: '请求来源不受信任' });
  return next();
});
// Authenticate large backup uploads before reading them; normal requests stay small.
app.use('/api/data/restore', requireAuth, express.json({ limit: '20mb' }));
app.use(express.json({ limit: '256kb' }));
// 连接质量上报必须在鉴权与业务限流之前：未登录和链路故障时的超时也要能记录
app.use('/api/telemetry', telemetryRouter);
// 轻量慢请求计时：只对超过 500ms 的请求打一行 JSON，正常请求不产生日志
app.use((request, response, next) => {
  const startedAt = Date.now();
  response.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    if (durationMs > 500) console.warn(JSON.stringify({ method: request.method, path: request.path, status: response.statusCode, duration_ms: durationMs }));
  });
  next();
});
const isWriteMethod = (method: string) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
const rateLimitMessage = { error: '请求过于频繁，请稍后再试' };
// 读接口放宽到 600/min；健康检查与上报端点豁免，写方法交给下面的写限流器
app.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, skip: (request) => request.path === '/api/health' || request.path.startsWith('/api/telemetry') || isWriteMethod(request.method), message: rateLimitMessage }));
// 写操作单独限流 120/min，放在业务路由之前
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, skip: (request) => !isWriteMethod(request.method), message: rateLimitMessage }));

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'signaldock-server',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
// 后台任务状态与异步采集：与既有采集路由共享同一套鉴权与限流
app.get('/api/jobs/:id', (request, response) => {
  const job = jobQueue.get(request.params.id);
  if (!job) return response.status(404).json({ error: '任务不存在' });
  return response.json({ data: job });
});
app.post('/api/collect/async', (request, response) => {
  const sources = Array.isArray(request.body?.sources)
    ? request.body.sources.filter((source: unknown): source is string => typeof source === 'string')
    : resolveCollectionSources();
  if (!sources.length) return response.status(400).json({ error: '至少选择一个信息源' });
  const job = jobQueue.enqueue(() => collectionRunner.trigger(sources));
  return response.json({ data: { job_id: job.job_id, status: 'queued' } });
});
app.use('/api/briefs', briefRouter);

app.use('/api/topics', topicRouter);
app.use('/api/collect', collectionRouter);
app.use('/api/information', informationRouter);
app.use('/api/history', historyRouter);
app.use('/api/information', analysisRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/events', eventRouter);
app.use('/api/data', dataRouter);

// 今日 AI 用量：请求数和 token 数各有一条上限，页面直接展示，省得去翻数据库
app.get('/api/ai/usage', (_request, response) => {
  const used = aiTokenUsage.used();
  const limit = aiTokenUsage.limit();
  response.json({
    data: {
      day: aiTokenUsage.day(),
      tokens: used,
      tokenLimit: limit,
      remaining: Math.max(0, limit - used),
      requests: aiTokenUsage.requests(),
      requestLimit: env.AI_DAILY_LIMIT,
      model: env.AI_MODEL
    }
  });
});

app.use((_request, response) => {
  response.status(404).json({ error: '接口不存在' });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if ((error as { status?: number })?.status === 413) return response.status(413).json({ error: '请求数据超过大小限制，备份最多20MB' });
  if (error instanceof SyntaxError && (error as { status?: number }).status === 400) return response.status(400).json({ error: 'JSON 格式无效' });
  response.status(500).json({ error: '服务器内部错误' });
});
