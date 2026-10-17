import { Router } from 'express';
import { topicStore } from '../../db/client.js';
import { collectTopics } from './collector.service.js';
import { informationStore } from './information.store.js';
import { historyStore } from './history.store.js';
import { createSourceAdapters, sourceCatalog } from './source.registry.js';

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

