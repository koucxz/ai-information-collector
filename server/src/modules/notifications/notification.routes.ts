import { Router } from 'express';
import { buildDigest, sendDigest, type DigestPeriod } from './digest.service.js';

export const notificationRouter = Router();
const periodFrom = (value: unknown): DigestPeriod | undefined => value === 'daily' || value === 'weekly' ? value : undefined;

notificationRouter.get('/digest', (request, response) => {
  const period = periodFrom(request.query.period ?? 'daily');
  return period ? response.json({ data: buildDigest(period) }) : response.status(400).json({ error: '摘要周期无效' });
});

notificationRouter.post('/digest/send', async (request, response) => {
  const period = periodFrom(request.body?.period ?? 'daily');
  if (!period) return response.status(400).json({ error: '摘要周期无效' });
  try { return response.json({ data: await sendDigest(period) }); }
  catch (error) { return response.status(502).json({ error: error instanceof Error ? error.message : '邮件发送失败' }); }
});

