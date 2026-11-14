/**
 * 文本匹配的公共实现：主题打标与来源关键词筛选共用一套规则，
 * 避免「打标能命中、来源筛不到」这类前后不一致的问题。
 */

/** 归一化：NFKC 折叠全角、去标签、压缩空白，便于中英文统一比较。 */
export const cleanForMatch = (value: string) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/<[^>]*>/g, ' ')
  .replace(/[\s\u200b-\u200d\ufeff]+/gu, ' ')
  .trim();

/** 去掉标点与空格后的紧凑文本：让「AI 编程」也能命中「AI编程」「AI-编程」。 */
export const compactForMatch = (value: string) => cleanForMatch(value).replace(/[^a-z0-9\u3400-\u9fff]+/gu, '');

const hasHan = (value: string) => /[\u3400-\u9fff]/u.test(value);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 中文按连续词匹配，英文按词边界匹配（AI 不会命中 maintain，Go 不会命中 Google）；允许紧跟版本号，Qwen3 / GPT-4 也算命中。 */
export const containsTerm = (text: string, dense: string, term: string) => {
  if (!term) return false;
  if (hasHan(term)) return dense.includes(compactForMatch(term));
  const pattern = term.split(/\s+/).map(escapeRegExp).join('[\\s\\-_/]*');
  return new RegExp(`(?<![a-z0-9])${pattern}(?![a-z])`, 'i').test(text);
};

export const matchesAnyTerm = (text: string, terms: string[]) => {
  const value = cleanForMatch(text);
  const dense = compactForMatch(text);
  return terms.some((term) => containsTerm(value, dense, term));
};

/** 解码 XML / HTML 实体，RSS 的 CDATA 与转义正文都依赖它。 */
export const decodeHtmlEntities = (value: string) => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&apos;/gi, "'");
