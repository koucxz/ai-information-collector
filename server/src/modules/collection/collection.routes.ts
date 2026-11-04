import { Router } from 'express';
import { collectionRunStore, topicStore } from '../../db/client.js';
import { collectTopics } from './collector.service.js';
import { historyStore } from './history.store.js';
import { informationStore } from './information.store.js';
import { resolveAdapters, SOURCE_CATALOG, knownSources } from './sources.js';

export const collectionRouter = Router();

// 最近一次采集：页面加载时直接读服务端记录，不再依赖浏览器本地存储
collectionRouter.get('/last', (_request, response) => response.json({ data: collectionRunStore.latest() }));

/** 信息源清单 + 自检：?probe=true 时真跑一次，返回每个源的条数与耗时 */
collectionRouter.get('/sources', async (request, response) => {
  if (request.query.probe !== 'true') return response.json({ data: SOURCE_CATALOG });
  const fallbackKeyword = topicStore.list()
    .flatMap((topic) => (topic.enabled ? topic.keywords.filter((keyword) => keyword.enabled) : []))
    .map((keyword) => keyword.value)[0];
  const keyword = typeof request.query.keyword === 'string' && request.query.keyword.trim()
    ? request.query.keyword.trim()
    : fallbackKeyword ?? '人工智能';
  // 不指定 source 时把所有注册的源都探一遍（包括默认集合之外的 360 搜索）
  const keys = typeof request.query.source === 'string' && request.query.source ? request.query.source : knownSources().join(',');
  const adapters = resolveAdapters(keys) ?? [];
  const probe = await Promise.all(
    adapters.map(async (adapter) => {
      const startedAt = Date.now();
      try {
        const items = await adapter.search(keyword);
        // 订阅型源的子源失败不会抛错，单独取出来，否则「0 条」看不出原因
        const health = adapter.health ? await adapter.health().catch(() => null) : null;
        return { key: adapter.source, name: adapter.sourceName, ok: items.length > 0 || !health?.failures?.length, count: items.length, ms: Date.now() - startedAt, sample: items[0]?.title ?? null, error: null, failures: health?.failures ?? [] };
      } catch (error) {
        return { key: adapter.source, name: adapter.sourceName, ok: false, count: 0, ms: Date.now() - startedAt, sample: null, error: error instanceof Error ? error.message : '请求失败', failures: [] };
      }
    })
  );
  return response.json({ data: probe, keyword });
});

collectionRouter.get('/preview', async (request, response) => {
  const source = typeof request.query.source === 'string' && request.query.source ? request.query.source : 'all';
  const adapters = resolveAdapters(source);
  if (!adapters) return response.status(400).json({ error: `不支持的信息源：${source}，可选 ${['all', ...knownSources()].join(' / ')}` });
  const result = await collectTopics(topicStore.list(), adapters);
  const persist = request.query.persist === 'true';
  const persistence = persist ? { ...informationStore.saveResults(result.data), ...historyStore.capture(result.data) } : { saved: 0, duplicates: 0, snapshots: 0, changes: 0 };
  const payload = { ...result, persistence };
  if (persist) collectionRunStore.save(payload);
  return response.json(payload);
});
