import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';

export const app = express();

app.use(cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173' }));
app.use(express.json({ limit: '256kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true }));

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    service: 'signaldock-server',
    timestamp: new Date().toISOString()
  });
});

app.use((_request, response) => {
  response.status(404).json({ error: '接口不存在' });
});
