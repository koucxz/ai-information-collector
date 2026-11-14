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

/** 国内外科技媒体的 feed 清单：单独一处维护，增删媒体不影响适配器逻辑。 */
export const FOREIGN_TECH_MEDIA: FeedDefinition[] = [
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', siteUrl: 'https://techcrunch.com' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', siteUrl: 'https://www.theverge.com' },
  { name: 'MIT 科技评论', url: 'https://www.technologyreview.com/feed/', siteUrl: 'https://www.technologyreview.com' },
  { name: 'Wired', url: 'https://www.wired.com/feed/rss', siteUrl: 'https://www.wired.com' },
  { name: 'GitHub 博客', url: 'https://github.blog/feed/', siteUrl: 'https://github.blog' },
  { name: 'OpenAI', url: 'https://openai.com/news/rss.xml', siteUrl: 'https://openai.com' }
];

export const CHINESE_TECH_MEDIA: FeedDefinition[] = [
  { name: '少数派', url: 'https://sspai.com/feed', siteUrl: 'https://sspai.com' },
  { name: 'IT之家', url: 'https://www.ithome.com/rss/', siteUrl: 'https://www.ithome.com' },
  { name: '量子位', url: 'https://www.qbitai.com/feed', siteUrl: 'https://www.qbitai.com' },
  { name: '开源中国', url: 'https://www.oschina.net/news/rss', siteUrl: 'https://www.oschina.net' },
  { name: 'Solidot', url: 'https://www.solidot.org/index.rss', siteUrl: 'https://www.solidot.org' },
  { name: '雷峰网', url: 'https://www.leiphone.com/feed', siteUrl: 'https://www.leiphone.com' },
  { name: '钛媒体', url: 'https://www.tmtpost.com/rss', siteUrl: 'https://www.tmtpost.com' }
];
