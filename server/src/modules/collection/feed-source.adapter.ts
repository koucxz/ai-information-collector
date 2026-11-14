import { TimedAdapter } from './public-source.adapter.js';
import { normalizeResult, stripHtml } from './normalize.js';
import { matchesQuery } from './query-terms.js';
import { decodeHtmlEntities as decodeEntities } from './text-match.js';
import type { SearchResult } from './collection.types.js';

/**
 * 通用 RSS / Atom 来源适配器。
 * 这类站点通常一次返回整份最新列表，按关键词在本地筛选即可；
 * 因此每次采集只抓取一次 feed，后续关键词复用同一份结果，避免 18 个关键词把同一份 feed 拉 18 遍。
 */

export type FeedDefinition = { name: string; url: string; siteUrl?: string };
export type FeedSourceConfig = { source: string; sourceName: string; feeds: FeedDefinition[] };
export type FeedEntry = { feedName: string; title: string; url: string; summary: string; publishedAt: string | null };

const pick = (block: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = pattern.exec(block);
    const value = match?.[1]?.trim();
    if (value) return value;
  }
  return '';
};

const resolveLink = (block: string, baseUrl?: string) => {
  const rssLink = pick(block, [/<link\b[^>]*>([\s\S]*?)<\/link>/i]);
  const atomLink = pick(block, [/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i]);
  const guid = pick(block, [/<guid\b[^>]*>([\s\S]*?)<\/guid>/i, /<id\b[^>]*>([\s\S]*?)<\/id>/i]);
  const candidate = decodeEntities(rssLink || atomLink || guid).trim();
  if (!candidate) return '';
  try {
    const url = new URL(candidate, baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
};

/** 解析 RSS 2.0 与 Atom 两种常见条目结构，返回按 URL 去重后的条目。 */
export const parseFeedEntries = (xml: string, limit = 40, baseUrl?: string): Array<Omit<FeedEntry, 'feedName'>> => {
  const blocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  const entries: Array<Omit<FeedEntry, 'feedName'>> = [];
  const source = blocks.length ? blocks : [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
  const seen = new Set<string>();
  for (const block of source) {
    if (entries.length >= limit) break;
    const title = stripHtml(decodeEntities(pick(block, [/<title\b[^>]*>([\s\S]*?)<\/title>/i])));
    const url = resolveLink(block, baseUrl);
    if (!title || !url || seen.has(url)) continue;
    const summary = stripHtml(decodeEntities(pick(block, [
      /<description\b[^>]*>([\s\S]*?)<\/description>/i,
      /<summary\b[^>]*>([\s\S]*?)<\/summary>/i,
      /<content:encoded\b[^>]*>([\s\S]*?)<\/content:encoded>/i,
      /<content\b[^>]*>([\s\S]*?)<\/content>/i
    ]))).slice(0, 320);
    const rawDate = pick(block, [
      /<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i,
      /<published\b[^>]*>([\s\S]*?)<\/published>/i,
      /<updated\b[^>]*>([\s\S]*?)<\/updated>/i,
      /<dc:date\b[^>]*>([\s\S]*?)<\/dc:date>/i
    ]);
    const parsed = rawDate ? new Date(decodeEntities(rawDate)) : null;
    const publishedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
    seen.add(url);
    entries.push({ title, url, summary, publishedAt });
  }
  return entries;
};

export class FeedSourceAdapter extends TimedAdapter {
  source: string;
  sourceName: string;
  private readonly config: FeedSourceConfig;
  private cache?: Promise<FeedEntry[]>;

  constructor(config: FeedSourceConfig, fetcher: typeof fetch = fetch, requestTimeoutMs = 10_000) {
    super(fetcher, requestTimeoutMs);
    this.config = config;
    this.source = config.source;
    this.sourceName = config.sourceName;
  }

  private load(): Promise<FeedEntry[]> {
    this.cache ??= this.fetchFeeds();
    return this.cache;
  }

  private async fetchFeeds(): Promise<FeedEntry[]> {
    const settled = await Promise.allSettled(this.config.feeds.map(async (feed) => {
      const response = await this.request(feed.url);
      const xml = await response.text();
      return parseFeedEntries(xml, 40, feed.siteUrl ?? feed.url).map((entry) => ({ ...entry, feedName: feed.name }));
    }));
    const entries = settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    if (!entries.length) {
      const failure = settled.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    }
    return entries;
  }

  async search(keyword: string): Promise<SearchResult[]> {
    const entries = await this.load();
    return entries
      .filter((entry) => matchesQuery(`${entry.title} ${entry.summary}`, keyword))
      .slice(0, 12)
      .map((entry) => normalizeResult({
        source: this.source,
        sourceName: entry.feedName,
        keyword,
        title: entry.title,
        summary: entry.summary,
        content: entry.summary || entry.title,
        url: entry.url,
        publishedAt: entry.publishedAt
      }));
  }
}

/**
 * 媒体来源一站一个，单独勾选。
 * 打包成「国外科技媒体 / 中文科技媒体」时看不出具体站点，也没法单独取舍；
 * The Verge / MIT 科技评论 / Wired / 钛媒体 实测每轮 0 条命中，直接不再纳入。
 */
export type MediaFeedSource = {
  id: string;
  name: string;
  defaultOn: boolean;
  hint: string;
  feed: FeedDefinition;
};

export const mediaFeedSources: MediaFeedSource[] = [
  { id: 'techcrunch', name: 'TechCrunch', defaultOn: true, hint: '国外科技创投与产品新闻，AI 相关约三成', feed: { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', siteUrl: 'https://techcrunch.com' } },
  { id: 'github-blog', name: 'GitHub 博客', defaultOn: true, hint: '官方工程与 AI 编程实践，量小但信噪比高', feed: { name: 'GitHub 博客', url: 'https://github.blog/feed/', siteUrl: 'https://github.blog' } },
  { id: 'openai', name: 'OpenAI', defaultOn: true, hint: '官方公告与客户案例，产品发布偏少', feed: { name: 'OpenAI', url: 'https://openai.com/news/rss.xml', siteUrl: 'https://openai.com' } },
  { id: 'ithome', name: 'IT之家', defaultOn: true, hint: '国内科技新闻，更新快、AI 相关多', feed: { name: 'IT之家', url: 'https://www.ithome.com/rss/', siteUrl: 'https://www.ithome.com' } },
  { id: 'qbitai', name: '量子位', defaultOn: true, hint: 'AI 垂直媒体，依赖关键词覆盖人名与公司名', feed: { name: '量子位', url: 'https://www.qbitai.com/feed', siteUrl: 'https://www.qbitai.com' } },
  { id: 'sspai', name: '少数派', defaultOn: true, hint: '偏工具与深度体验，AI 内容质量较好', feed: { name: '少数派', url: 'https://sspai.com/feed', siteUrl: 'https://sspai.com' } },
  { id: 'oschina', name: '开源中国', defaultOn: true, hint: '开源项目动态，含较多发版公告', feed: { name: '开源中国', url: 'https://www.oschina.net/news/rss', siteUrl: 'https://www.oschina.net' } },
  { id: 'solidot', name: 'Solidot', defaultOn: true, hint: '奇客资讯，量小但准确', feed: { name: 'Solidot', url: 'https://www.solidot.org/index.rss', siteUrl: 'https://www.solidot.org' } },
  { id: 'leiphone', name: '雷峰网', defaultOn: true, hint: 'AI 与创投报道，掺融资与人事新闻', feed: { name: '雷峰网', url: 'https://www.leiphone.com/feed', siteUrl: 'https://www.leiphone.com' } }
];
