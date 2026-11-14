import type { CollectionError, SearchResult, SourceAdapter, SourceCollectionStat, TopicConfig } from './collection.types.js';
import { expandTopicQueries, matchesExcludedWord } from './query-expansion.js';

export type CollectionResponse = { data: SearchResult[]; errors: CollectionError[]; stats: { topics: number; keywords: number; results: number }; sourceStats: SourceCollectionStat[] };

/** 限制并发的地图函数：来源变多后按来源并行，单个来源内部仍然串行，避免把同一站点打爆。 */
const mapWithConcurrency = async <T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
};

export const collectTopics = async (topics: TopicConfig[], adapters: SourceAdapter[]): Promise<CollectionResponse> => {
  const activeTopics = topics.filter((topic) => topic.enabled);
  const queries = expandTopicQueries(activeTopics);
  const collected = await mapWithConcurrency(adapters, 4, async (adapter) => {
    const scopedTopics = activeTopics.filter((topic) => !topic.sourceIds?.length || topic.sourceIds.includes(adapter.source));
    const allQueries = expandTopicQueries(scopedTopics);
    const scopedQueries = adapter.maxQueries ? allQueries.slice(0, adapter.maxQueries) : allQueries;
    const startedAt = Date.now();
    const data: SearchResult[] = [];
    const errors: CollectionError[] = [];
    let successes = 0;
    let failures = 0;
    let lastError: string | undefined;
    for (const query of scopedQueries) {
      try {
        data.push(...(await adapter.search(query.value)).filter((item) => !matchesExcludedWord(item, query.excludeWords)));
        successes += 1;
      } catch (error) {
        failures += 1;
        lastError = error instanceof Error ? error.message : '来源请求失败';
        errors.push({ source: adapter.source, keyword: query.value, message: lastError });
      }
    }
    const stat: SourceCollectionStat = { source: adapter.source, attempts: scopedQueries.length, successes, failures, durationMs: Date.now() - startedAt, ...(lastError ? { lastError } : {}) };
    return { data, errors, stat };
  });
  const data = collected.flatMap((entry) => entry.data);
  const errors = collected.flatMap((entry) => entry.errors);
  const sourceStats = collected.map((entry) => entry.stat);
  const unique = new Map(data.map((item) => [item.fingerprint, item]));
  return { data: [...unique.values()], errors, stats: { topics: activeTopics.length, keywords: queries.length, results: unique.size }, sourceStats };
};
