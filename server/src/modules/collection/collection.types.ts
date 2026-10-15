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
  enabled: boolean;
  keywords: Array<{ value: string; enabled: boolean }>;
};

export type CollectionError = { source: string; keyword: string; message: string };
