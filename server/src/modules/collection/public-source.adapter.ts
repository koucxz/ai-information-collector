import type { SearchResult, SourceAdapter } from './collection.types.js';
import { normalizeResult, stripHtml } from './normalize.js';
import { browserHeaders, parseBaiduHeadings } from './baidu.adapter.js';
import { parsePublicHttpUrl } from '../../security/url.js';

type Fetcher = typeof fetch;
type BilibiliPayload = {
  data?: { result?: Array<{ title?: string; description?: string; arcurl?: string; pubdate?: number }> };
};
type JuejinPayload = {
  data?: Array<{ result_type?: number; result_model?: { article_id?: string; article_info?: { article_id?: string; title?: string; brief_content?: string; ctime?: string } } }>;
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

export const parseBilibiliHtmlResults = (html: string, keyword: string): SearchResult[] => {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const pattern = /<a\b[^>]*href=["']([^"']*\/video\/(BV[\dA-Za-z]{10})[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const videoId = match[2];
    if (seen.has(videoId)) continue;
    const titleMatch = /<h3\b([^>]*)>([\s\S]*?)<\/h3>/i.exec(match[3]);
    if (!titleMatch) continue;
    const title = stripHtml(/\btitle=["']([^"']+)["']/i.exec(titleMatch[1])?.[1] ?? titleMatch[2]);
    if (!title) continue;
    seen.add(videoId);
    results.push(normalizeResult({ source: 'bilibili', sourceName: 'B 站', keyword, title, summary: '', content: title, url: `https://www.bilibili.com/video/${videoId}`, publishedAt: null }));
  }
  return results.slice(0, 10);
};

export const parseJuejinResults = (payload: JuejinPayload, keyword: string): SearchResult[] =>
  (payload.data ?? []).flatMap((item) => {
    const article = item.result_model?.article_info;
    const id = article?.article_id ?? item.result_model?.article_id;
    if (item.result_type !== 2 || !id || !article?.title) return [];
    const summary = stripHtml(article.brief_content ?? '');
    return [normalizeResult({
      source: 'juejin', sourceName: '掘金', keyword, title: article.title,
      summary, content: summary || article.title, url: `https://juejin.cn/post/${id}`,
      publishedAt: article.ctime ? new Date(Number(article.ctime) * 1000).toISOString() : null
    })];
  }).slice(0, 10);

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

export abstract class TimedAdapter implements SourceAdapter {
  abstract source: string;
  abstract sourceName: string;
  constructor(protected readonly fetcher: Fetcher = fetch, protected readonly requestTimeoutMs = timeoutMs) {}
  protected async request(url: string, options: RequestInit = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const combinedSignal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const headers = new Headers(browserHeaders);
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    try {
      const response = await this.fetcher(url, { ...options, signal: combinedSignal, headers });
      const manualRedirect = options.redirect === 'manual' && response.status >= 300 && response.status < 400;
      if (!response.ok && !manualRedirect) throw new Error(`${this.sourceName}返回 HTTP ${response.status}`);
      return response;
    } finally { clearTimeout(timer); }
  }
  abstract search(keyword: string, options?: { signal?: AbortSignal }): Promise<SearchResult[]>;
}

export class BilibiliAdapter extends TimedAdapter {
  source = 'bilibili';
  sourceName = 'B 站';
  async search(keyword: string, options: { signal?: AbortSignal } = {}) {
    const response = await this.request(`https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`, { signal: options.signal, headers: { Referer: 'https://www.bilibili.com/' } });
    return parseBilibiliHtmlResults(await response.text(), keyword);
  }
}

export class JuejinAdapter extends TimedAdapter {
  source = 'juejin';
  sourceName = '掘金';
  async search(keyword: string, options: { signal?: AbortSignal } = {}) {
    const response = await this.request('https://api.juejin.cn/search_api/v1/search', {
      method: 'POST', signal: options.signal,
      headers: { 'Content-Type': 'application/json', Referer: 'https://juejin.cn/search' },
      body: JSON.stringify({ key_word: keyword, id_type: 0, cursor: '0', limit: 10, search_type: 0, sort_type: 0, version: 1 })
    });
    return parseJuejinResults(await response.json() as JuejinPayload, keyword);
  }
}

const indexedSources = {
  weibo: { source: 'weibo', sourceName: '微博', domain: 'weibo.com' },
  zhihu: { source: 'zhihu', sourceName: '知乎', domain: 'zhihu.com' }
} as const;

export class BaiduIndexedAdapter extends TimedAdapter {
  source: string;
  sourceName: string;
  private readonly config: typeof indexedSources[keyof typeof indexedSources];
  constructor(source: keyof typeof indexedSources, fetcher: Fetcher = fetch, requestTimeoutMs = timeoutMs) {
    super(fetcher, requestTimeoutMs);
    this.config = indexedSources[source];
    this.source = this.config.source;
    this.sourceName = this.config.sourceName;
  }
  async search(keyword: string, options: { signal?: AbortSignal } = {}) {
    const query = `site:${this.config.domain} ${keyword}`;
    const response = await this.request(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}`, { signal: options.signal });
    const headings = parseBaiduHeadings(await response.text());
    const resolved = await Promise.all(headings.map(async (heading) => {
      try {
        if (!parsePublicHttpUrl(heading.url)) return heading;
        const redirect = await this.request(heading.url, { signal: options.signal, redirect: 'manual' });
        const location = redirect.headers.get('location');
        return { ...heading, url: location && parsePublicHttpUrl(location) ? location : heading.url };
      } catch { return heading; }
    }));
    return resolved.map(({ title, url }) => normalizeResult({
      source: this.source, sourceName: this.sourceName, keyword, title,
      summary: '通过百度公开索引发现', content: title, url, publishedAt: null
    }));
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
    const response = await this.request(this.config.search(keyword), { signal: options.signal });
    return parsePublicHtmlResults(await response.text(), keyword, this.config);
  }
}

