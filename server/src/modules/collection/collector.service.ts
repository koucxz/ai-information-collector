import type { CollectionError, SearchResult, SourceAdapter, TopicConfig } from './collection.types.js';

export type CollectionResponse = { data: SearchResult[]; errors: CollectionError[]; stats: { topics: number; keywords: number; results: number } };

export const collectTopics = async (topics: TopicConfig[], adapters: SourceAdapter[]): Promise<CollectionResponse> => {
  const activeTopics = topics.filter((topic) => topic.enabled);
  const queries = activeTopics.flatMap((topic) => topic.keywords.filter((keyword) => keyword.enabled).map((keyword) => keyword.value));
  const data: SearchResult[] = [];
  const errors: CollectionError[] = [];
  for (const adapter of adapters) {
    for (const keyword of queries) {
      try { data.push(...await adapter.search(keyword)); }
      catch (error) { errors.push({ source: adapter.source, keyword, message: error instanceof Error ? error.message : '来源请求失败' }); }
    }
  }
  const unique = new Map(data.map((item) => [item.fingerprint, item]));
  return { data: [...unique.values()], errors, stats: { topics: activeTopics.length, keywords: queries.length, results: unique.size } };
};
