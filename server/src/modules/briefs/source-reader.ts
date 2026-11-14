/**
 * 从原文页面抽取正文段落，供「自动写稿」使用。
 * 采集到的 RSS 摘要经常只有一句话（Hacker News 甚至只有「3 分 · 0 条评论」），
 * 直接用这些素材写出来的稿子会很空，所以在素材太薄时补一次原文正文。
 */
const BLOCKED_HOST = /^(?:localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[::1\])/i;
const BLOCKED_EXT = /\.(?:pdf|zip|rar|7z|png|jpe?g|gif|webp|svg|mp4|mp3|m4a|exe|dmg|apk)$/i;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–', middot: '·', copy: '©'
};

export const decodeEntities = (value: string) => value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
  if (code.startsWith('#')) {
    const num = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(num) && num > 0 && num < 0x10ffff ? String.fromCodePoint(num) : match;
  }
  return ENTITIES[code.toLowerCase()] ?? match;
});

/** 优先只看 <article> / <main>，避免把整站的导航和侧栏当正文。 */
const pickMainRegion = (html: string) => {
  for (const tag of ['article', 'main']) {
    const match = new RegExp(`<${tag}\\b[\\s\\S]*<\\/${tag}>`, 'i').exec(html);
    if (match && match[0].length > 800) return match[0];
  }
  return html;
};

/** 导航菜单、标签墙这类块没有句子标点、几乎全是大写词头，正文不会长这样。 */
const isMenuBlock = (text: string) => {
  if (text.length < 80) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 8) return false;
  if (!/[。！？!?]|\.\s/.test(text) && text.length > 120) return true;
  const upper = words.filter((word) => /^[A-Z]/.test(word)).length;
  const lower = words.filter((word) => /^[a-z]/.test(word)).length;
  return upper / words.length > 0.6 && lower / words.length < 0.35;
};

/** 作者简介通常长这样：「X is a Senior Developer Advocate at GitHub…」，不是正文。 */
const isAuthorBio = (text: string) => /\b(?:is|was)\s+an?\s+[\p{Lu}][\p{L}\s-]{2,40}\s+at\s+[\p{Lu}]/u.test(text);

/** 有些页面把标题、作者、分享按钮和正文塞进同一个块，截掉正文之前的样板文字。 */
const stripLeadingMeta = (text: string) => text.replace(/^[\s\S]{0,320}?\bShare:\s*/i, '').trim();

/** 去掉脚本、导航、注释这些读不出信息的块，再按段落抽文字。 */
export const extractArticleText = (html: string) => {
  let body = pickMainRegion(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of ['nav', 'header', 'footer', 'aside', 'form', 'template']) {
    body = body.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  }
  const blocks: string[] = [];
  for (const match of body.matchAll(/<(p|h2|h3|li|blockquote|pre)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    // 一级标题就是文章标题，正文里不需要再抄一遍
    const text = stripLeadingMeta(decodeEntities(match[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim());
    if (text.length < 30 || isMenuBlock(text) || isAuthorBio(text) || blocks.includes(text)) continue;
    blocks.push(text);
  }
  const text = blocks.join('\n').trim();
  return text.length >= 240 ? text.slice(0, 3000) : '';
};

/** 抓一页原文正文；失败、非 HTML、内网地址一律返回空串，不影响建稿流程。 */
export const readSourcePage = async (url: string, timeoutMs = 8000): Promise<string> => {
  let target: URL;
  try { target = new URL(url); } catch { return ''; }
  if (!['http:', 'https:'].includes(target.protocol) || BLOCKED_HOST.test(target.hostname) || BLOCKED_EXT.test(target.pathname)) return '';
  try {
    const response = await fetch(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SignalDockReader/1.0; +https://signaldock-five.vercel.app)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    if (!response.ok) return '';
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) return '';
    return extractArticleText((await response.text()).slice(0, 400_000));
  } catch { return ''; }
};
