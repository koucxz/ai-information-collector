import type { SearchResult, SourceAdapter } from './collection.types.js';
import { normalizeResult, stripHtml } from './normalize.js';

type Fetcher = typeof fetch;
type BilibiliPayload = {
  data?: { result?: Array<{ title?: string; description?: string; arcurl?: string; pubdate?: number }> };
};

const timeoutMs = 8_000;
const decodeUrl = (value: string) => value.startsWith('//') ? `https:${value}` : value;

export const parseBilibiliResults = (payload: BilibiliPayload, keyword: string): SearchResult[] =>
  (payload.data?.result ?? []).flatMap((item) => {
    const title = stripHtml(item.title ?? '');
    if (!title || !item.arcurl) return [];
    return [normalizeResult({
      source: 'bilibili', sourceName: 'B 站', keyword, title,
      summary: stripHtml(item.description ?? ''), content: stripHtml(item.description ?? title),
      url: decodeUrl(item.arcurl), publishedAt: item.pubdate ? new Date(item.pubdate * 1000).toISOString() : null
    })];
  });

export const parsePublicHtmlResults = (
  html: string,
  keyword: string,
  config: { source: string; sourceName: string; baseUrl: string; includePath: RegExp }
): SearchResult[] => {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const attributes = `${match[1]} ${match[3]}`;
    const rawTitle = /\btitle=["']([^"']+)["']/i.exec(attributes)?.[1] ?? match[4];
    const title = stripHtml(rawTitle);
    if (!title) continue;
    let url: URL;
    try { url = new URL(decodeUrl(match[2]), config.baseUrl); } catch { continue; }
    if (!config.includePath.test(`${url.hostname}${url.pathname}`) || seen.has(url.href)) continue;
    seen.add(url.href);
    results.push(normalizeResult({ source: config.source, sourceName: config.sourceName, keyword, title, summary: '', content: title, url: url.href, publishedAt: null }));
  }
  return results.slice(0, 20);
};

abstract class TimedAdapter implements SourceAdapter {
  abstract source: string;
  abstract sourceName: string;
  constructor(protected readonly fetcher: Fetcher = fetch, protected readonly requestTimeoutMs = timeoutMs) {}
  protected async request(url: string, signal?: AbortSignal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const response = await this.fetcher(url, { signal: combinedSignal, headers: { 'User-Agent': 'Mozilla/5.0 SignalDock/1.0', Accept: 'text/html,application/json' } });
      if (!response.ok) throw new Error(`${this.sourceName}返回 HTTP ${response.status}`);
      return response;
    } finally { clearTimeout(timer); }
  }
  abstract search(keyword: string, options?: { signal?: AbortSignal }): Promise<SearchResult[]>;
}

export class BilibiliAdapter extends TimedAdapter {
  source = 'bilibili';
  sourceName = 'B 站';
  async search(keyword: string, options: { signal?: AbortSignal } = {}) {
    const response = await this.request(`https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&keyword=${encodeURIComponent(keyword)}`, options.signal);
    return parseBilibiliResults(await response.json() as BilibiliPayload, keyword);
  }
}

const htmlSources = {
  weibo: { source: 'weibo', sourceName: '微博', baseUrl: 'https://s.weibo.com', search: (keyword: string) => `https://s.weibo.com/weibo?q=${encodeURIComponent(keyword)}`, includePath: /(^|\.)weibo\.com\/(?:\d+|detail)\//i },
  zhihu: { source: 'zhihu', sourceName: '知乎', baseUrl: 'https://www.zhihu.com', search: (keyword: string) => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(keyword)}`, includePath: /(^|\.)zhihu\.com\/(?:question|answer|p)\//i },
  juejin: { source: 'juejin', sourceName: '掘金', baseUrl: 'https://juejin.cn', search: (keyword: string) => `https://juejin.cn/search?query=${encodeURIComponent(keyword)}`, includePath: /(^|\.)juejin\.cn\/post\//i }
} as const;

export class PublicHtmlAdapter extends TimedAdapter {
  source: string;
  sourceName: string;
  private readonly config: typeof htmlSources[keyof typeof htmlSources];
  constructor(source: keyof typeof htmlSources, fetcher: Fetcher = fetch, requestTimeoutMs = timeoutMs) {
    super(fetcher, requestTimeoutMs);
    this.config = htmlSources[source];
    this.source = this.config.source;
    this.sourceName = this.config.sourceName;
  }
  async search(keyword: string, options: { signal?: AbortSignal } = {}) {
    const response = await this.request(this.config.search(keyword), options.signal);
    return parsePublicHtmlResults(await response.text(), keyword, this.config);
  }
}

