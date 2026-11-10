import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { topicRouter } from './modules/topics/topic.routes.js';
import { collectionRouter } from './modules/collection/collection.routes.js';
import { informationRouter } from './modules/collection/information.routes.js';
import { historyRouter } from './modules/collection/history.routes.js';
import { analysisRouter } from './modules/analysis/analysis.routes.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { eventRouter } from './modules/events/event.routes.js';
import { dataRouter } from './modules/data/data.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { requireAuth } from './auth.js';
import { briefRouter } from './modules/briefs/brief.routes.js';

export const app = express();

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
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, message: { error: '请求过于频繁，请稍后再试' } }));

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
app.use('/api/briefs', briefRouter);

app.use('/api/topics', topicRouter);
app.use('/api/collect', collectionRouter);
app.use('/api/information', informationRouter);
app.use('/api/history', historyRouter);
app.use('/api/information', analysisRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/events', eventRouter);
app.use('/api/data', dataRouter);

app.use((_request, response) => {
  response.status(404).json({ error: '接口不存在' });
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if ((error as { status?: number })?.status === 413) return response.status(413).json({ error: '请求数据超过大小限制，备份最多20MB' });
  if (error instanceof SyntaxError && (error as { status?: number }).status === 400) return response.status(400).json({ error: 'JSON 格式无效' });
  response.status(500).json({ error: '服务器内部错误' });
});
