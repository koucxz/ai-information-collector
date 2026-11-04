import type { SearchResult, SourceAdapter } from './collection.types.js';
import { fetchJson } from './http.js';
import { normalizeResult } from './normalize.js';

type AlgoliaHit = {
  objectID: string;
  title: string | null;
  url: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string | null;
  _tags?: string[];
};

type AlgoliaResponse = { hits?: AlgoliaHit[] };

const PER_QUERY = 8;
const WINDOW_SECONDS = 45 * 24 * 60 * 60;

/** Hacker News（Algolia 搜索 API）：免密钥、JSON、稳定，用来补英文技术圈的同类信息 */
export class HackerNewsAdapter implements SourceAdapter {
  source = 'hackernews';
  sourceName = 'Hacker News';

  async search(keyword: string): Promise<SearchResult[]> {
    const since = Math.floor(Date.now() / 1000) - WINDOW_SECONDS;
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(keyword)}&tags=story&hitsPerPage=${PER_QUERY}&numericFilters=created_at_i%3E${since}`;
    const payload = await fetchJson<AlgoliaResponse>(url, { timeoutMs: 9_000 });
    const hits = payload.hits ?? [];
    return hits
      .filter((hit) => hit.title)
      .map((hit) =>
        normalizeResult({
          source: this.source,
          sourceName: this.sourceName,
          keyword,
          title: hit.title ?? '',
          summary: [hit.points ? `${hit.points} 热度` : '', hit.num_comments ? `${hit.num_comments} 条讨论` : ''].filter(Boolean).join(' · '),
          content: [hit.title, hit.story_text].filter(Boolean).join('\n'),
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          publishedAt: hit.created_at ?? null
        })
      );
  }
}
