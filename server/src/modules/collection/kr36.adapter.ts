import type { SearchResult, SourceAdapter } from './collection.types.js';
import { fetchJson } from './http.js';
import { normalizeResult } from './normalize.js';

type NewsflashItem = {
  itemId?: number;
  itemType?: number;
  templateMaterial?: {
    widgetTitle?: string;
    widgetContent?: string;
    publishTime?: number;
    authorName?: string;
  };
};

type NewsflashResponse = {
  code?: number;
  msg?: string;
  data?: { itemList?: NewsflashItem[]; pageCallback?: string; hasNextPage?: number };
};

const PAGES = 3;
const PAGE_SIZE = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_AGE_DAYS = 10;
const PER_KEYWORD = 6;

type CachedItem = { title: string; summary: string; url: string; publishedAt: string | null; author: string };

let cache: { at: number; items: CachedItem[] } | null = null;
let inflight: Promise<CachedItem[]> | null = null;

const articleUrl = (item: NewsflashItem) =>
  item.itemType === 20 || item.itemType === 0
    ? `https://36kr.com/newsflashes/${item.itemId}`
    : `https://36kr.com/p/${item.itemId}`;

/** 网关返回结构 → 内部结构；快讯走 newsflashes，长文走 /p/，时间戳是毫秒 */
export const mapNewsflashItems = (list: NewsflashItem[]): CachedItem[] =>
  list.flatMap((item) => {
    const title = item.templateMaterial?.widgetTitle?.trim();
    if (!title || !item.itemId) return [];
    const publishTime = item.templateMaterial?.publishTime;
    return [{
      title,
      summary: (item.templateMaterial?.widgetContent ?? '').trim(),
      url: articleUrl(item),
      publishedAt: publishTime ? new Date(publishTime).toISOString() : null,
      author: item.templateMaterial?.authorName ?? '36氪'
    }];
  });

/**
 * 36氪：官网 feed 已改成 HTML 空壳，搜索接口需要签名，
 * 但移动端网关的「快讯流」接口免签名可用，翻页靠上一条返回的 pageCallback。
 */
const fetchPage = async (pageEvent: number, pageCallback: string): Promise<NewsflashResponse> =>
  fetchJson<NewsflashResponse>('https://gateway.36kr.com/api/mis/nav/newsflash/flow', {
    timeoutMs: 9_000,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://36kr.com', Referer: 'https://36kr.com/' },
    body: JSON.stringify({ partner_id: 'wap', param: { siteId: 1, platformId: 2, pageEvent, pageSize: PAGE_SIZE, pageCallback }, timestamp: Date.now() })
  });

type HotRankResponse = { code?: number; msg?: string; data?: { hotRankList?: NewsflashItem[] } };

/** 热榜（50 条）：同一网关，POST 免签名 */
const fetchHotRank = async (): Promise<CachedItem[]> => {
  const payload = await fetchJson<HotRankResponse>('https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot', {
    timeoutMs: 9_000,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://36kr.com', Referer: 'https://36kr.com/' },
    body: JSON.stringify({ partner_id: 'wap', param: { siteId: 1, platformId: 2 }, timestamp: Date.now() })
  });
  if (payload.code !== 0) throw new Error(payload.msg || `36氪热榜返回错误码 ${payload.code}`);
  return mapNewsflashItems(payload.data?.hotRankList ?? []);
};

const loadNewsflash = async (): Promise<CachedItem[]> => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.items;
  if (inflight) return inflight;
  inflight = (async () => {
    const items: CachedItem[] = [];
    let pageCallback = '';
    for (let page = 0; page < PAGES; page += 1) {
      const payload = await fetchPage(page, pageCallback);
      if (payload.code !== 0) throw new Error(payload.msg || `36氪返回错误码 ${payload.code}`);
      const list = payload.data?.itemList ?? [];
      items.push(...mapNewsflashItems(list));
      if (!payload.data?.hasNextPage || !payload.data?.pageCallback || list.length === 0) break;
      pageCallback = payload.data.pageCallback;
    }
    // 快讯偏公司动态，热榜偏行业深度，两份合并后关键词命中率明显更高
    const hot = await fetchHotRank().catch(() => [] as CachedItem[]);
    const merged = new Map<string, CachedItem>();
    [...items, ...hot].forEach((item) => merged.set(item.url, item));
    const fresh = [...merged.values()].filter((item) => !item.publishedAt || Date.now() - new Date(item.publishedAt).getTime() <= MAX_AGE_DAYS * 86_400_000);
    cache = { at: Date.now(), items: fresh };
    return fresh;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
};

/** 36氪快讯：一次抓取 60 条，按关键词在标题/正文里过滤，与其他关键词共用同一份缓存 */
export class Kr36Adapter implements SourceAdapter {
  source = 'kr36';
  sourceName = '36氪';

  async search(keyword: string): Promise<SearchResult[]> {
    const items = await loadNewsflash();
    const query = keyword.toLocaleLowerCase();
    return items
      .filter((item) => `${item.title} ${item.summary}`.toLocaleLowerCase().includes(query))
      .slice(0, PER_KEYWORD)
      .map((item) =>
        normalizeResult({
          source: this.source,
          sourceName: this.sourceName,
          keyword,
          title: item.title,
          summary: item.summary,
          content: item.summary || item.title,
          url: item.url,
          publishedAt: item.publishedAt
        })
      );
  }
}

export const kr36CacheStats = () => (cache ? { at: cache.at, items: cache.items.length } : null);
