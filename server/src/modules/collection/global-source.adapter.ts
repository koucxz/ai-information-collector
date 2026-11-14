import { TimedAdapter } from './public-source.adapter.js';
import { normalizeResult, stripHtml } from './normalize.js';
import { primaryQuery, matchesQuery } from './query-terms.js';
import { decodeHtmlEntities } from './text-match.js';
import { parseFeedEntries } from './feed-source.adapter.js';
import type { SearchResult } from './collection.types.js';

/**
 * 免密钥的国外高质量来源：
 * Hacker News（技术社区）、arXiv（论文）、Stack Overflow（工程问答）、DEV（开发者博客）、Lobsters（技术社区）。
 * 这些接口都带速率限制或配额，所以每个适配器在单次采集里限制使用的关键词数量。
 */

const clean = (value?: string | null) => stripHtml(decodeHtmlEntities(value ?? '')).slice(0, 320);

/** 搜索接口的相关性并不严格（HN / arXiv 常返回只沾边的结果），再用关键词洗一遍。 */
const keepRelevant = (results: SearchResult[], keyword: string) => results.filter((result) => matchesQuery(`${result.title} ${result.summary}`, keyword));

type HnStory = {
  objectID?: string;
  title?: string | null;
  url?: string | null;
  story_text?: string | null;
  created_at?: string;
  points?: number;
  num_comments?: number;
};

export const mapHackerNews = (stories: HnStory[], keyword: string): SearchResult[] => stories.flatMap((story) => {
  const title = clean(story.title);
  if (!title) return [];
  const discussion = story.objectID ? `https://news.ycombinator.com/item?id=${story.objectID}` : '';
  const url = story.url || discussion;
  if (!url) return [];
  const summary = clean(story.story_text) || `${story.points ?? 0} 分 · ${story.num_comments ?? 0} 条评论 · Hacker News`;
  return [normalizeResult({
    source: 'hackernews', sourceName: 'Hacker News', keyword, title, summary,
    content: summary, url, publishedAt: story.created_at ?? null
  })];
});

export class HackerNewsAdapter extends TimedAdapter {
  source = 'hackernews';
  sourceName = 'Hacker News';
  maxQueries = 12;
  constructor(fetcher: typeof fetch = fetch, requestTimeoutMs = 10_000) { super(fetcher, requestTimeoutMs); }

  async search(keyword: string): Promise<SearchResult[]> {
    const since = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const query = encodeURIComponent(primaryQuery(keyword));
    const filters = encodeURIComponent(`created_at_i>${since}`);
    const response = await this.request(`https://hn.algolia.com/api/v1/search_by_date?query=${query}&tags=story&hitsPerPage=15&numericFilters=${filters}`);
    const payload = await response.json() as { hits?: HnStory[] };
    return keepRelevant(mapHackerNews(payload.hits ?? [], keyword), keyword);
  }
}

export class ArxivAdapter extends TimedAdapter {
  source = 'arxiv';
  sourceName = 'arXiv';
  maxQueries = 6;
  constructor(fetcher: typeof fetch = fetch, requestTimeoutMs = 12_000) { super(fetcher, requestTimeoutMs); }

  async search(keyword: string): Promise<SearchResult[]> {
    const term = encodeURIComponent(`all:"${primaryQuery(keyword)}"`);
    const response = await this.request(`https://export.arxiv.org/api/query?search_query=${term}&start=0&max_results=12&sortBy=submittedDate&sortOrder=descending`);
    const results = parseFeedEntries(await response.text(), 12, 'https://arxiv.org').map((entry) => normalizeResult({
      source: 'arxiv', sourceName: 'arXiv', keyword, title: entry.title,
      summary: entry.summary, content: entry.summary || entry.title, url: entry.url, publishedAt: entry.publishedAt
    }));
    return keepRelevant(results, keyword);
  }
}

type StackExchangeItem = {
  title?: string;
  link?: string;
  body?: string;
  creation_date?: number;
  score?: number;
  answer_count?: number;
  tags?: string[];
};

export const mapStackExchange = (items: StackExchangeItem[], keyword: string): SearchResult[] => items.flatMap((item) => {
  const title = clean(item.title);
  if (!title || !item.link) return [];
  const body = clean(item.body);
  const summary = body || `${item.score ?? 0} 分 · ${item.answer_count ?? 0} 个回答 · Stack Overflow`;
  return [normalizeResult({
    source: 'stackoverflow', sourceName: 'Stack Overflow', keyword, title, summary, content: summary,
    url: item.link, publishedAt: item.creation_date ? new Date(item.creation_date * 1000).toISOString() : null
  })];
});

export class StackExchangeAdapter extends TimedAdapter {
  source = 'stackoverflow';
  sourceName = 'Stack Overflow';
  maxQueries = 8;
  constructor(fetcher: typeof fetch = fetch, requestTimeoutMs = 10_000) { super(fetcher, requestTimeoutMs); }

  async search(keyword: string): Promise<SearchResult[]> {
    const query = encodeURIComponent(primaryQuery(keyword));
    const response = await this.request(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${query}&site=stackoverflow&pagesize=12&filter=withbody`);
    const payload = await response.json() as { items?: StackExchangeItem[] };
    return keepRelevant(mapStackExchange(payload.items ?? [], keyword), keyword);
  }
}

type DevtoArticle = {
  title?: string;
  description?: string;
  url?: string;
  published_at?: string;
  tag_list?: string[];
  positive_reactions_count?: number;
  comments_count?: number;
};

export class DevtoAdapter extends TimedAdapter {
  source = 'devto';
  sourceName = 'DEV Community';
  private cache?: Promise<DevtoArticle[]>;
  constructor(fetcher: typeof fetch = fetch, requestTimeoutMs = 10_000) { super(fetcher, requestTimeoutMs); }

  private load(): Promise<DevtoArticle[]> {
    this.cache ??= this.request('https://dev.to/api/articles?per_page=40&top=7').then((response) => response.json() as Promise<DevtoArticle[]>);
    return this.cache;
  }

  async search(keyword: string): Promise<SearchResult[]> {
    const articles = await this.load();
    return articles
      .filter((article) => matchesQuery(`${article.title ?? ''} ${article.description ?? ''} ${(article.tag_list ?? []).join(' ')}`, keyword))
      .slice(0, 10)
      .flatMap((article) => {
        const title = clean(article.title);
        if (!title || !article.url) return [];
        const summary = clean(article.description) || `${article.positive_reactions_count ?? 0} 赞 · ${article.comments_count ?? 0} 条评论 · DEV Community`;
        return [normalizeResult({
          source: 'devto', sourceName: 'DEV Community', keyword, title, summary, content: summary,
          url: article.url, publishedAt: article.published_at ?? null
        })];
      });
  }
}

type LobsterStory = {
  short_id?: string;
  title?: string;
  url?: string;
  description?: string;
  created_at?: string;
  score?: string | number;
  comment_count?: string | number;
  tags?: string[];
};

const LOBSTERS_TAGS = ['ai', 'programming', 'devops'];

export class LobstersAdapter extends TimedAdapter {
  source = 'lobsters';
  sourceName = 'Lobsters';
  private cache?: Promise<LobsterStory[]>;
  constructor(fetcher: typeof fetch = fetch, requestTimeoutMs = 10_000) { super(fetcher, requestTimeoutMs); }

  private load(): Promise<LobsterStory[]> {
    this.cache ??= Promise.allSettled(LOBSTERS_TAGS.map(async (tag) => {
      const response = await this.request(`https://lobste.rs/t/${tag}.json`);
      return await response.json() as LobsterStory[];
    })).then((results) => results.flatMap((result) => result.status === 'fulfilled' ? result.value : []));
    return this.cache;
  }

  async search(keyword: string): Promise<SearchResult[]> {
    const stories = await this.load();
    return stories
      .filter((story) => matchesQuery(`${story.title ?? ''} ${story.description ?? ''} ${(story.tags ?? []).join(' ')}`, keyword))
      .slice(0, 10)
      .flatMap((story) => {
        const title = clean(story.title);
        const url = story.url || (story.short_id ? `https://lobste.rs/s/${story.short_id}` : '');
        if (!title || !url) return [];
        const summary = clean(story.description) || `${story.score ?? 0} 分 · ${story.comment_count ?? 0} 条评论 · Lobsters`;
        return [normalizeResult({
          source: 'lobsters', sourceName: 'Lobsters', keyword, title, summary, content: summary,
          url, publishedAt: story.created_at ?? null
        })];
      });
  }
}
