import type { SearchResult, SourceAdapter } from './collection.types.js';
import { createLimiter, fetchText } from './http.js';
import { normalizeResult, stripHtml } from './normalize.js';

const PER_QUERY = 10;
const PAGES = 2;

// 360 的结果标题最终都挂在 <a data-mdurl="真实地址"> 上，href 是 so.com 的跳转链接
// （需 cookie 才解得开，不能直接用），因此按锚点解析比按 h3 更稳：有些模板没有 h3
const ANCHOR_PATTERN = /<a\b[^>]*data-mdurl="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const DESC_PATTERN = /<p[^>]*class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i;
const INTERNAL_HOST = /(^|\.)(so|360|360kan|360tres|360kuai)\.com$/i;
const NOISE_TITLE = /^(查看更多|更多|广告|相关搜索|其他人还搜了)$/;

// 标题里的 <em> 是关键词高亮，直接删掉这些行内标签，别让 stripHtml 把它变成空格
const stripInline = (value: string) => stripHtml(value.replace(/<\/?(em|b|strong|i|span|font)\b[^>]*>/gi, ''));

export const parseSo360Results = (html: string, keyword: string): SearchResult[] => {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(ANCHOR_PATTERN)) {
    const url = match[1].replace(/&amp;/g, '&');
    try {
      // 站内栏目（导航、视频、百科聚合页）不是信息源
      if (INTERNAL_HOST.test(new URL(url).hostname)) continue;
    } catch {
      continue;
    }
    const title = stripInline(match[2]);
    if (title.length < 6 || NOISE_TITLE.test(title)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    // 摘要紧跟在标题后面
    const tail = html.slice(match.index ?? 0, (match.index ?? 0) + 900);
    const summary = stripInline(tail.match(DESC_PATTERN)?.[1] ?? '');
    results.push(
      normalizeResult({
        source: 'so360',
        sourceName: '360 搜索',
        keyword,
        title,
        summary,
        content: summary || title,
        url,
        publishedAt: null
      })
    );
    if (results.length >= PER_QUERY) break;
  }
  return results;
};

/** 360 搜索：百度对机房 IP 强制验证码后，改用它做中文网页检索（结果页含真实外链） */
export class So360Adapter implements SourceAdapter {
  source = 'so360';
  sourceName = '360 搜索';
  // 搜索站点对同 IP 并发敏感，同一适配器内串行并留间隔
  private readonly limit = createLimiter(350);

  async search(keyword: string): Promise<SearchResult[]> {
    return this.limit(async () => {
      const results: SearchResult[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= PAGES; page += 1) {
        const html = await fetchText(`https://www.so.com/s?q=${encodeURIComponent(keyword)}&pn=${page}`, {
          timeoutMs: 9_000,
          accept: 'text/html,application/xhtml+xml'
        });
        if (/安全验证|请输入验证码/.test(html)) {
          if (results.length > 0) break;
          throw new Error('360 触发安全验证');
        }
        for (const item of parseSo360Results(html, keyword)) {
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          results.push(item);
          if (results.length >= PER_QUERY) return results;
        }
      }
      return results;
    });
  }
}
