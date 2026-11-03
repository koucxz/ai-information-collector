import cors from 'cors';
import type { CorsOptions } from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { allowedOrigins, env } from './config/env.js';
import { topicRouter } from './modules/topics/topic.routes.js';
import { collectionRouter } from './modules/collection/collection.routes.js';
import { informationRouter } from './modules/collection/information.routes.js';
import { historyRouter } from './modules/collection/history.routes.js';
import { analysisRouter } from './modules/analysis/analysis.routes.js';

export const app = express();

// 部署在腾讯云云托管 / Nginx 之后时，需信任一层代理才能拿到真实客户端 IP
app.set('trust proxy', 1);

const vercelPreviewPattern = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

const corsOrigin: CorsOptions['origin'] = (origin, callback) => {
  // 无 Origin：同源请求、服务端调用、健康检查
  if (!origin) return callback(null, true);
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
  if (env.ALLOW_VERCEL_PREVIEW && vercelPreviewPattern.test(origin)) return callback(null, true);
  // 不放行但不抛错：浏览器侧拿不到 CORS 头，自然会拦截，且不会泄露堆栈
  return callback(null, false);
};

app.use(cors({ origin: corsOrigin, credentials: false }));
app.use(express.json({ limit: '256kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true }));

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'signaldock-server',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/topics', topicRouter);
app.use('/api/collect', collectionRouter);
app.use('/api/information', informationRouter);
app.use('/api/history', historyRouter);
app.use('/api/information', analysisRouter);

app.use((_request, response) => {
  response.status(404).json({ error: '接口不存在' });
});
