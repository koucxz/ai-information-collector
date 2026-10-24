import type { SearchResult, SourceAdapter } from './collection.types.js';
import { normalizeResult, stripHtml } from './normalize.js';

const defaultTimeoutMs = 8_000;
export type BaiduHeading = { title: string; url: string };

export const browserHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json',
  'Accept-Language': 'zh-CN,zh;q=0.9'
};

export const parseBaiduHeadings = (html: string): BaiduHeading[] => {
  const results: BaiduHeading[] = [];
  const seen = new Set<string>();
  for (const heading of html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
    const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(heading[1]);
    if (!anchor) continue;
    const title = stripHtml(anchor[2]);
    const url = anchor[1].replace(/&amp;/gi, '&');
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url });
  }
  return results.slice(0, 10);
};

const parseResults = (html: string, keyword: string): SearchResult[] => parseBaiduHeadings(html).map(({ title, url }) =>
  normalizeResult({ source: 'baidu', sourceName: '百度', keyword, title, summary: '', content: title, url, publishedAt: null })
);

export class BaiduAdapter implements SourceAdapter {
  source = 'baidu';
  sourceName = '百度';
  constructor(private readonly timeoutMs = defaultTimeoutMs, private readonly fetcher: typeof fetch = fetch) {}

  async search(keyword: string, options: { signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    try {
      const response = await this.fetcher(`https://www.baidu.com/s?wd=${encodeURIComponent(keyword)}`, { signal, headers: browserHeaders });
      if (!response.ok) throw new Error(`百度返回 HTTP ${response.status}`);
      return parseResults(await response.text(), keyword);
    } finally { clearTimeout(timeout); }
  }
}

export const parseBaiduResults = parseResults;
