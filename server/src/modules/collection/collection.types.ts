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
  /** 订阅型适配器可以报告本次抓取里哪些子源失败，自检接口会带上 */
  health?(): Promise<{ items?: number; failures?: string[] }>;
};

export type TopicConfig = {
  id: string;
  name: string;
  enabled: boolean;
  keywords: Array<{ value: string; enabled: boolean }>;
};

export type CollectionError = { source: string; keyword: string; message: string };
