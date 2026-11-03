import { Router } from 'express';
import { collectionRunStore, topicStore } from '../../db/client.js';
import { BaiduAdapter } from './baidu.adapter.js';
import { collectTopics } from './collector.service.js';
import { FixtureAdapter } from './fixture.adapter.js';
import { informationStore } from './information.store.js';
import { historyStore } from './history.store.js';

export const collectionRouter = Router();

// 最近一次采集：页面加载时直接读服务端记录，不再依赖浏览器本地存储
collectionRouter.get('/last', (_request, response) => response.json({ data: collectionRunStore.latest() }));

collectionRouter.get('/preview', async (request, response) => {
  const source = typeof request.query.source === 'string' ? request.query.source : 'fixture';
  const adapters = source === 'fixture' ? [new FixtureAdapter()] : source === 'baidu' ? [new BaiduAdapter()] : null;
  if (!adapters) return response.status(400).json({ error: '不支持的信息源' });
  const result = await collectTopics(topicStore.list(), adapters);
  const persist = request.query.persist === 'true';
  const persistence = persist ? { ...informationStore.saveResults(result.data), ...historyStore.capture(result.data) } : { saved: 0, duplicates: 0, snapshots: 0, changes: 0 };
  const payload = { ...result, persistence };
  if (persist) collectionRunStore.save(payload);
  return response.json(payload);
});
