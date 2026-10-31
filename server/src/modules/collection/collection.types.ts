export type SearchResult = {
  source: string;
  sourceName: string;
  keyword: string;
  title: string;
  summary: string;
  content: string;
  url: string;
  publishedAt: string | null;
  collectedAt: string;
  fingerprint: string;
};

export type SourceAdapter = {
  source: string;
  sourceName: string;
  search(keyword: string, options?: { signal?: AbortSignal }): Promise<SearchResult[]>;
};

export type TopicConfig = {
  id: string;
  name: string;
  aliases?: string[];
  excludeWords?: string[];
  enabled: boolean;
  keywords: Array<{ value: string; enabled: boolean }>;
};

export type CollectionError = { source: string; keyword: string; message: string };
export type SourceCollectionStat = { source: string; attempts: number; successes: number; failures: number; durationMs: number; lastError?: string };
