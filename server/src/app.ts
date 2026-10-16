import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { topicRouter } from './modules/topics/topic.routes.js';
import { collectionRouter } from './modules/collection/collection.routes.js';
import { informationRouter } from './modules/collection/information.routes.js';

export const app = express();

app.use(cors({ origin: env.CLIENT_URL }));
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

app.use((_request, response) => {
  response.status(404).json({ error: '接口不存在' });
});
