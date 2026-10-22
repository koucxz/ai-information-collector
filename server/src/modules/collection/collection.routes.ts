import { Router } from 'express';
import { topicStore } from '../../db/client.js';
import { collectTopics } from './collector.service.js';
import { informationStore } from './information.store.js';
import { historyStore } from './history.store.js';
import { createSourceAdapters, sourceCatalog } from './source.registry.js';
import { collectionRunner } from '../automation/collection.scheduler.js';

export const collectionRouter = Router();

collectionRouter.get('/preview', async (request, response) => {
  const requested = typeof request.query.sources === 'string'
    ? request.query.sources.split(',').map((source) => source.trim()).filter(Boolean)
    : [typeof request.query.source === 'string' ? request.query.source : 'fixture'];
  const { adapters, unknown } = createSourceAdapters(requested);
  if (unknown.length) return response.status(400).json({ error: `不支持的信息源：${unknown.join('、')}` });
  const result = await collectTopics(topicStore.list(), adapters);
  const persist = request.query.persist === 'true';
  const persistence = persist ? { ...informationStore.saveResults(result.data), ...historyStore.capture(result.data) } : { saved: 0, duplicates: 0, snapshots: 0, changes: 0 };
  return response.json({ ...result, persistence });
});

collectionRouter.get('/sources', (_request, response) => response.json({ data: sourceCatalog }));

collectionRouter.post('/run', async (request, response) => {
  const sources = Array.isArray(request.body?.sources) ? request.body.sources.filter((source: unknown): source is string => typeof source === 'string') : sourceCatalog.filter((source) => source.id !== 'fixture').map((source) => source.id);
  if (!sources.length) return response.status(400).json({ error: '至少选择一个信息源' });
  try {
    const outcome = await collectionRunner.trigger(sources);
    if (outcome.status === 'skipped') return response.status(409).json({ error: outcome.reason });
    return response.json(outcome.result);
  }
  catch (error) { return response.status(400).json({ error: error instanceof Error ? error.message : '采集任务失败' }); }
});

