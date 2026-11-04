import type { SearchResult, SourceAdapter } from './collection.types.js';
import { fetchText } from './http.js';
import { normalizeResult } from './normalize.js';
import { parseFeed, type FeedItem } from './rss.js';

type FeedConfig = { name: string; url: string };

// 只保留实测能稳定返回 RSS 的站点：36氪 feed 已变成 HTML、虎嗅 504、机器之心返回空
const FEEDS: FeedConfig[] = [
  { name: 'IT之家', url: 'https://www.ithome.com/rss/' },
  { name: '极客公园', url: 'https://www.geekpark.net/rss' },
  { name: '爱范儿', url: 'https://www.ifanr.com/feed' },
  { name: '量子位', url: 'https://www.qbitai.com/feed' },
  { name: 'InfoQ', url: 'https://www.infoq.cn/feed' },
  { name: '开源中国', url: 'https://www.oschina.net/news/rss' },
  { name: '少数派', url: 'https://sspai.com/feed' },
  { name: 'Solidot', url: 'https://www.solidot.org/index.rss' }
];

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_AGE_DAYS = 21;
const PER_KEYWORD = 6;

type CachedItem = FeedItem & { feed: string };
type FeedSnapshot = { at: number; items: CachedItem[]; failures: string[] };

// 缓存放在模块级：一次采集里 10 多个关键词共用同一份抓取结果，不重复打站点
let cache: FeedSnapshot | null = null;
let inflight: Promise<FeedSnapshot> | null = null;

const withinAge = (item: CachedItem) => {
  if (!item.publishedAt) return true;
  return Date.now() - new Date(item.publishedAt).getTime() <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
};

const loadFeeds = async (): Promise<FeedSnapshot> => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const settled = await Promise.allSettled(
      FEEDS.map(async (feed) => ({ feed: feed.name, items: parseFeed(await fetchText(feed.url, { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8' })) }))
    );
    const items: CachedItem[] = [];
    const failures: string[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        result.value.items.forEach((item) => items.push({ ...item, feed: result.value.feed }));
      } else {
        failures.push(`${FEEDS[index].name}：${result.reason instanceof Error ? result.reason.message : '抓取失败'}`);
      }
    });
    cache = { at: Date.now(), items: items.filter(withinAge), failures };
    return cache;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
};

/** 站点 RSS：订阅型来源，按关键词在标题/摘要里做过滤，补中文科技媒体的一手报道 */
export class RssFeedAdapter implements SourceAdapter {
  source = 'rss';
  sourceName = '站点 RSS';

  async search(keyword: string): Promise<SearchResult[]> {
    const { items } = await loadFeeds();
    const query = keyword.toLocaleLowerCase();
    return items
      .filter((item) => `${item.title} ${item.summary}`.toLocaleLowerCase().includes(query))
      .slice(0, PER_KEYWORD)
      .map((item) =>
        normalizeResult({
          source: this.source,
          sourceName: item.feed,
          keyword,
          title: item.title,
          summary: item.summary,
          content: item.summary || item.title,
          url: item.link,
          publishedAt: item.publishedAt
        })
      );
  }

  /** 采集中途不报错：站点抓不到时只记录失败，不让整轮采集失败 */
  async health() {
    const { items, failures } = await loadFeeds();
    return { items: items.length, failures };
  }
}

export const feedCacheStats = () => (cache ? { at: cache.at, items: cache.items.length, failures: cache.failures } : null);
