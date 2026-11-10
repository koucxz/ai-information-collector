import { Router } from 'express';
import { informationStore } from '../collection/information.store.js';
import { analyzeInformation } from './analysis.service.js';
import rateLimit from 'express-rate-limit';

export const analysisRouter = Router();
analysisRouter.post('/:id/analyze', rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: '分析请求过于频繁，请稍后再试' } }), async (request: import('express').Request<{ id: string }>, response) => {
  const item = informationStore.findById(request.params.id);
  if (!item) return response.status(404).json({ error: '信息不存在' });
  const analysis = await analyzeInformation(item);
  const saved = informationStore.updateAnalysis(item.id, analysis);
  return response.json({ data: saved, analysis });
});
