import type { CollectionError, SearchResult, SourceAdapter, TopicConfig } from './collection.types.js';

export type CollectionResponse = {
  data: SearchResult[];
  errors: CollectionError[];
  stats: { topics: number; keywords: number; results: number; bySource: Record<string, number> };
};

const DEFAULT_CONCURRENCY = 6;

/** 源 × 关键词并发抓取；串行时 12 个关键词 × 3 个源会拖到几分钟 */
export const collectTopics = async (
  topics: TopicConfig[],
  adapters: SourceAdapter[],
  options: { concurrency?: number } = {}
): Promise<CollectionResponse> => {
  const activeTopics = topics.filter((topic) => topic.enabled);
  const queries = [
    ...new Set(
      activeTopics
        .flatMap((topic) => topic.keywords.filter((keyword) => keyword.enabled).map((keyword) => keyword.value.trim()))
        .filter(Boolean)
    )
  ];
  const tasks: Array<{ adapter: SourceAdapter; keyword: string }> = [];
  for (const adapter of adapters) for (const keyword of queries) tasks.push({ adapter, keyword });

  const data: SearchResult[] = [];
  const errors: CollectionError[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      if (!task) break;
      try {
        data.push(...(await task.adapter.search(task.keyword)));
      } catch (error) {
        errors.push({
          source: task.adapter.source,
          keyword: task.keyword,
          message: error instanceof Error ? error.message : '来源请求失败'
        });
      }
    }
  });
  await Promise.all(runners);

  const unique = new Map(data.map((item) => [item.fingerprint, item]));
  const items = [...unique.values()].sort((left, right) => {
    const leftAt = new Date(left.publishedAt ?? left.collectedAt).getTime();
    const rightAt = new Date(right.publishedAt ?? right.collectedAt).getTime();
    return rightAt - leftAt;
  });
  const bySource: Record<string, number> = {};
  items.forEach((item) => { bySource[item.source] = (bySource[item.source] ?? 0) + 1; });

  return { data: items, errors, stats: { topics: activeTopics.length, keywords: queries.length, results: items.length, bySource } };
};
