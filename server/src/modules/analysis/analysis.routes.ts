import { Router } from 'express';
import { informationStore } from '../collection/information.store.js';
import { analyzeInformation } from './analysis.service.js';

export const analysisRouter = Router();
analysisRouter.post('/:id/analyze', async (request, response) => {
  const item = informationStore.findById(request.params.id);
  if (!item) return response.status(404).json({ error: '信息不存在' });
  const analysis = await analyzeInformation(item);
  const saved = informationStore.updateAnalysis(item.id, analysis);
  return response.json({ data: saved, analysis });
});
