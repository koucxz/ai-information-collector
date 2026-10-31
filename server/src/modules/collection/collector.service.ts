import type { CollectionError, SearchResult, SourceAdapter, SourceCollectionStat, TopicConfig } from './collection.types.js';
import { expandTopicQueries, matchesExcludedWord } from './query-expansion.js';

export type CollectionResponse = { data: SearchResult[]; errors: CollectionError[]; stats: { topics: number; keywords: number; results: number }; sourceStats: SourceCollectionStat[] };

export const collectTopics = async (topics: TopicConfig[], adapters: SourceAdapter[]): Promise<CollectionResponse> => {
  const activeTopics = topics.filter((topic) => topic.enabled);
  const queries = expandTopicQueries(activeTopics);
  const data: SearchResult[] = [];
  const errors: CollectionError[] = [];
  const sourceStats: SourceCollectionStat[] = [];
  for (const adapter of adapters) {
    const scopedTopics = activeTopics.filter((topic) => !topic.sourceIds?.length || topic.sourceIds.includes(adapter.source));
    const scopedQueries = expandTopicQueries(scopedTopics);
    const startedAt = Date.now();
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
    sourceStats.push({ source: adapter.source, attempts: scopedQueries.length, successes, failures, durationMs: Date.now() - startedAt, ...(lastError ? { lastError } : {}) });
  }
  const unique = new Map(data.map((item) => [item.fingerprint, item]));
  return { data: [...unique.values()], errors, stats: { topics: activeTopics.length, keywords: queries.length, results: unique.size }, sourceStats };
};
