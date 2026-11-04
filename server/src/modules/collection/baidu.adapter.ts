import type { SearchResult, SourceAdapter } from './collection.types.js';
import { BROWSER_UA } from './http.js';
import { normalizeResult, stripHtml } from './normalize.js';

const defaultTimeoutMs = 8_000;
const parseResults = (html: string, keyword: string): SearchResult[] => {
  const results: SearchResult[] = [];
  const pattern = /<h3[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h3>/gi;
  for (const match of html.matchAll(pattern)) {
    const title = stripHtml(match[2]);
    if (!title || !match[1]) continue;
    results.push(normalizeResult({ source: 'baidu', sourceName: '百度', keyword, title, summary: '', content: title, url: match[1], publishedAt: null }));
  }
  return results;
};

export class BaiduAdapter implements SourceAdapter {
  source = 'baidu';
  sourceName = '百度';
  constructor(private readonly timeoutMs = defaultTimeoutMs, private readonly fetcher: typeof fetch = fetch) {}

  async search(keyword: string, options: { signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    try {
      // 用浏览器 UA 才拿得到结果页；自定义 UA 会被跳到风控页，解析出 0 条
      const response = await this.fetcher(`https://www.baidu.com/s?wd=${encodeURIComponent(keyword)}&rn=20`, { signal, redirect: 'follow', headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
      if (!response.ok) throw new Error(`百度返回 HTTP ${response.status}`);
      return parseResults(await response.text(), keyword);
    } finally { clearTimeout(timeout); }
  }
}

export const parseBaiduResults = parseResults;
