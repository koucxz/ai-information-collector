import type { TopicConfig } from './collection.types.js';

export type ExpandedQuery = { value: string; excludeWords: string[] };

export const expandTopicQueries = (topics: TopicConfig[]): ExpandedQuery[] => {
  const queries = new Map<string, ExpandedQuery>();
  for (const topic of topics.filter((item) => item.enabled)) {
    const values = [
      ...topic.keywords.filter((keyword) => keyword.enabled).map((keyword) => keyword.value),
      ...(topic.aliases ?? [])
    ];
    if (!topic.keywords.length && !values.length && topic.name.trim()) values.push(topic.name);
    for (const raw of values) {
      const value = raw.trim();
      const key = value.toLocaleLowerCase();
      if (!value || queries.has(key)) continue;
      queries.set(key, { value, excludeWords: [...new Set((topic.excludeWords ?? []).map((word) => word.trim().toLocaleLowerCase()).filter(Boolean))] });
    }
  }
  return [...queries.values()];
};

export const matchesExcludedWord = (item: { title: string; summary: string; content: string }, excludeWords: string[]) => {
  const text = `${item.title} ${item.summary} ${item.content}`.toLocaleLowerCase();
  return excludeWords.some((word) => text.includes(word));
};

