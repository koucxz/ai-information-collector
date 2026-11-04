import { stripHtml } from './normalize.js';

export type FeedItem = {
  title: string;
  link: string;
  summary: string;
  publishedAt: string | null;
};

const cdata = (value: string) =>
  value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

const decodeEntities = (value: string) =>
  value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const text = (value: string | undefined) => (value ? stripHtml(decodeEntities(cdata(value))) : '');

const tag = (block: string, names: string[]) => {
  for (const name of names) {
    const matched = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    if (matched?.[1]) return matched[1];
  }
  return '';
};

const atomLink = (block: string) => {
  const alternate = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alternate?.[1]) return alternate[1];
  const plain = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (plain?.[1]) return plain[1];
  return text(tag(block, ['link']));
};

const toIso = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

/** 极简 RSS / Atom 解析：不引第三方依赖，只取标题、链接、摘要、时间 */
export const parseFeed = (xml: string): FeedItem[] => {
  const blocks = [
    ...(xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []),
    ...(xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [])
  ];
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = text(tag(block, ['title']));
    const link = text(atomLink(block));
    if (!title || !link) continue;
    items.push({
      title,
      link,
      summary: text(tag(block, ['description', 'summary', 'content:encoded', 'content'])),
      publishedAt: toIso(text(tag(block, ['pubDate', 'published', 'updated', 'dc:date'])) ?? '')
    });
  }
  return items;
};
