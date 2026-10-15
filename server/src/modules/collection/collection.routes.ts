import { Router } from 'express';
import { topicStore } from '../../db/client.js';
import { BaiduAdapter } from './baidu.adapter.js';
import { collectTopics } from './collector.service.js';
import { FixtureAdapter } from './fixture.adapter.js';

export const collectionRouter = Router();

collectionRouter.get('/preview', async (request, response) => {
  const source = typeof request.query.source === 'string' ? request.query.source : 'fixture';
  const adapters = source === 'fixture' ? [new FixtureAdapter()] : source === 'baidu' ? [new BaiduAdapter()] : null;
  if (!adapters) return response.status(400).json({ error: '不支持的信息源' });
  const result = await collectTopics(topicStore.list(), adapters);
  return response.json(result);
});
