import type { SearchResult, SourceAdapter } from './collection.types.js';
import { fetchText } from './http.js';
import { normalizeResult } from './normalize.js';
import { parseFeed } from './rss.js';

const HOSTS = ['https://cn.bing.com', 'https://www.bing.com'];
const PER_QUERY = 8;

/** 必应新闻 RSS：按关键词搜索，返回标题 / 摘要 / 发布时间，是主力的“搜索型”信息源 */
export class BingNewsAdapter implements SourceAdapter {
  source = 'bing';
  sourceName = '必应新闻';

  async search(keyword: string): Promise<SearchResult[]> {
    const failures: string[] = [];
    for (const host of HOSTS) {
      const url = `${host}/news/search?q=${encodeURIComponent(keyword)}&format=RSS&mkt=zh-CN&setlang=zh-cn`;
      try {
        const xml = await fetchText(url, { accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8', timeoutMs: 9_000 });
        const items = parseFeed(xml).slice(0, PER_QUERY);
        if (items.length > 0) {
          return items.map((item) =>
            normalizeResult({
              source: this.source,
              sourceName: this.sourceName,
              keyword,
              title: item.title,
              summary: item.summary,
              content: item.summary || item.title,
              url: item.link,
              publishedAt: item.publishedAt
            })
          );
        }
        failures.push(`${host} 返回 0 条`);
      } catch (error) {
        failures.push(`${host} ${error instanceof Error ? error.message : '请求失败'}`);
      }
    }
    throw new Error(failures.join('；') || '必应新闻不可用');
  }
}
