import type { SearchResult, SourceAdapter } from './collection.types.js';
import { fetchJson } from './http.js';
import { normalizeResult } from './normalize.js';

type JuejinArticle = {
  article_id?: string;
  title?: string;
  brief_content?: string;
  ctime?: string;
  category?: { category_name?: string };
};

type JuejinItem = { result_model?: { article_info?: JuejinArticle } };
type JuejinResponse = { err_no?: number; data?: JuejinItem[] };

const PER_QUERY = 8;

/** 掘金搜索：中文技术内容命中率最高的搜索型来源（免密钥 JSON 接口） */
export class JuejinAdapter implements SourceAdapter {
  source = 'juejin';
  sourceName = '掘金';

  async search(keyword: string): Promise<SearchResult[]> {
    const payload = await fetchJson<JuejinResponse>('https://api.juejin.cn/search_api/v1/search', {
      timeoutMs: 9_000,
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({ key_word: keyword, id_type: 0, cursor: '0', limit: 20, search_type: 0 })
    });
    if (payload.err_no !== 0 && payload.err_no !== undefined) throw new Error(`掘金返回错误码 ${payload.err_no}`);
    const articles = (payload.data ?? [])
      .map((item) => item.result_model?.article_info)
      .filter((article): article is JuejinArticle => Boolean(article?.article_id && article.title));
    return articles
      .sort((left, right) => Number(right.ctime ?? 0) - Number(left.ctime ?? 0))
      .slice(0, PER_QUERY)
      .map((article) =>
        normalizeResult({
          source: this.source,
          sourceName: this.sourceName,
          keyword,
          title: article.title ?? '',
          summary: article.brief_content ?? '',
          content: article.brief_content || article.title || '',
          url: `https://juejin.cn/post/${article.article_id}`,
          publishedAt: article.ctime ? new Date(Number(article.ctime) * 1000).toISOString() : null
        })
      );
  }
}
