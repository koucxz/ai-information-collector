import type { SearchResult, SourceAdapter } from './collection.types.js';
import { fetchJson } from './http.js';
import { normalizeResult } from './normalize.js';

type Sov2exHit = {
  _source?: {
    id?: number;
    title?: string;
    content?: string;
    created?: string;
    replies?: number;
    member?: string;
  };
};

type Sov2exResponse = { hits?: Sov2exHit[] };

const PER_QUERY = 6;

/** V2EX 社区搜索（sov2ex 接口）：看开发者真实讨论，补“人”的视角 */
export class V2exAdapter implements SourceAdapter {
  source = 'v2ex';
  sourceName = 'V2EX';

  async search(keyword: string): Promise<SearchResult[]> {
    const payload = await fetchJson<Sov2exResponse>(
      `https://www.sov2ex.com/api/search?q=${encodeURIComponent(keyword)}&size=20`,
      { timeoutMs: 9_000 }
    );
    const topics = (payload.hits ?? [])
      .map((hit) => hit._source)
      .filter((topic): topic is NonNullable<Sov2exHit['_source']> => Boolean(topic?.id && topic.title));
    return topics
      .sort((left, right) => new Date(right.created ?? 0).getTime() - new Date(left.created ?? 0).getTime())
      .slice(0, PER_QUERY)
      .map((topic) =>
        normalizeResult({
          source: this.source,
          sourceName: this.sourceName,
          keyword,
          title: topic.title ?? '',
          summary: [topic.member, topic.replies ? `${topic.replies} 条回复` : ''].filter(Boolean).join(' · '),
          content: [topic.title, topic.content].filter(Boolean).join('\n'),
          url: `https://www.v2ex.com/t/${topic.id}`,
          publishedAt: topic.created ?? null
        })
      );
  }
}
