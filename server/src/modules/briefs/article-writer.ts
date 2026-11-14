import { z } from 'zod';
import { env } from '../../config/env.js';
import { withAiBudget } from '../analysis/ai-budget.js';
import { analysisCallStore } from '../../db/client.js';
import { cleanText as cleanMaterialText } from '../collection/normalize.js';
import { readSourcePage } from './source-reader.js';

export type ArticleMaterial = {
  id: string; title: string; sourceName: string; url: string;
  summary: string; content: string; topics: string[]; importance: number; collectedAt: string;
};
export type ArticleDraft = { title: string; content: string; digest?: string; note?: string; provider: 'ai' | 'fallback' };

const SITE_SUFFIX = /(?:hacker news|少数派|sspai|it之家|ithome|量子位|qbitai|开源中国|oschina|solidot|钛媒体|tmtpost|雷峰网|leiphone|techcrunch|the verge|wired|mit technology review|github blog|openai)/i;
const BOILERPLATE: RegExp[] = [
  /\s*(?:阅读全文|阅读原文|点击阅读|点击查看全文|查看全文|详见原文)[\s…。.、]*$/i,
  /\s*continue reading[\s\S]*$/i,
  /\s*read more[\s\S]*$/i,
  /\s*the post .{0,140}? appeared first on .{0,140}$/i,
  /\s*(?:责任编辑|责编|编辑)\s*[:：].{0,60}$/i
];

/** 素材清洗：去实体、去站点尾巴、去「阅读原文」这类模板句。 */
export const cleanArticleText = (raw: string) => {
  let text = cleanMaterialText(raw ?? '');
  for (const pattern of BOILERPLATE) text = text.replace(pattern, '');
  return text.replace(/\s+/g, ' ').trim();
};

export const cleanArticleTitle = (raw: string) => {
  const title = cleanArticleText(raw).replace(/\s*[（(]\s*(?:更新|图|视频|附链接)\s*[）)]\s*$/i, '').trim();
  const trimmed = title.replace(/\s+[-|–—·_]\s+([^-|–—·_]{2,24})$/, (match, suffix: string) => SITE_SUFFIX.test(suffix) ? '' : match);
  return (trimmed || title).slice(0, 120);
};

const splitSentences = (text: string) => text
  .split(/(?<=[。！？；!?;])\s*|(?<=[.!?])\s+(?=[A-Z0-9“"])/u)
  .map((sentence) => sentence.trim())
  .filter(Boolean);

/** 取前几句，尽量在句号处收尾，避免把半句话写进稿子。 */
export const takeSentences = (text: string, limit = 2, maxLength = 280) => {
  const sentences = splitSentences(text);
  const picked: string[] = [];
  for (const sentence of sentences) {
    if (picked.length >= limit) break;
    if (picked.join('').length + sentence.length > maxLength && picked.length) break;
    picked.push(sentence);
  }
  // 中文句子直接相连，英文句子之间补一个空格
  const result = picked.join(/[。！？；]$/.test(picked.at(-1) ?? '') ? '' : ' ').trim();
  if (result) return result;
  const fallback = text.slice(0, maxLength).trim();
  return fallback.length === maxLength ? `${fallback}…` : fallback;
};

const normalizeKey = (text: string) => text.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

/** 摘要和正文经常是同一段话，直接拼起来每句话都会出现两遍。 */
const materialBody = (material: ArticleMaterial) => {
  const summary = cleanArticleText(material.summary);
  const content = cleanArticleText(material.content);
  if (!summary) return content;
  if (!content) return summary;
  const a = normalizeKey(summary);
  const b = normalizeKey(content);
  if (a === b) return summary.length >= content.length ? summary : content;
  if (a.includes(b)) return summary;
  if (b.includes(a)) return content;
  return `${summary} ${content}`;
};

/** 站点模板句会以独立句子的形式出现，按句子过滤比按结尾过滤更稳。 */
const SENTENCE_NOISE: RegExp[] = [
  // 聚合站抓到的「149 分 · 44 条评论 · Hacker News」是列表元数据，写进稿子只会变成噪音
  /^\d+\s*分\s*·/,
  /^\d+\s*points?\b/i,
  /^\d+\s*(?:条)?评论\s*·/,
  /^\d+\s*(?:小时|天|分钟)前\b/,
  /·\s*(?:hacker news|reddit|product hunt)\s*$/i,
  // 门户站的浏览器提示、临时预览链接、作者与时间戳，都不是正文
  /低版浏览器|建议使用.{0,12}浏览器|仅用于文章预览|临时链接/,
  /^\S{0,16}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/,
  /^(?:来源|作者|编辑|责编|发布时间|发私信给)\s*[:：]?\s*\S{0,20}$/,
  /^the post\b.{0,200}appeared first on\b/i,
  /^continue reading\b/i,
  /^read more\b/i,
  /^(?:责任编辑|责编|编辑)\s*[:：]/,
  /^(?:分享到|点击订阅|扫描二维码)\b/
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 「IT之家 11 月 14 日消息，」这类日期电头在加了「据…报道」之后是重复的。 */
const stripDateline = (sentence: string, sourceName: string) => {
  const patterns = [
    new RegExp(`^${escapeRegExp(sourceName)}\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日\\s*(?:消息|报道|电)[，,：:]?\\s*`),
    /^\d{1,2}\s*月\s*\d{1,2}\s*日\s*(?:消息|报道)[，,：:]?\s*/
  ];
  return patterns.reduce((text, pattern) => text.replace(pattern, ''), sentence);
};

/** 公众号页面的「作者 日期 来源：XX 公众号 XX」电头，连同它前面的标题回显一起截掉。 */
const LEADING_META = [
  /公众号\s*[\w-]{2,24}/g,
  /来源\s*[:：]\s*\S{1,16}/g,
  /发自\S{0,10}/g,
  /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?/g
];

const dropLeadingMeta = (sentence: string) => {
  const head = sentence.slice(0, 200);
  let cut = 0;
  for (const pattern of LEADING_META) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(head))) cut = Math.max(cut, match.index + match[0].length);
  }
  return cut >= 6 ? sentence.slice(cut).replace(/^[\s|·:：,，、-]+/, '') : sentence;
};

/** 正文开头常把标题再抄一遍，标题已经在小标题里了。 */
const isTitleEcho = (sentence: string, title: string) => {
  const a = normalizeKey(sentence);
  const b = normalizeKey(title);
  if (!a || !b || a.length < 5) return false;
  return a.length <= b.length + 12 && (a === b || b.includes(a) || a.includes(b));
};

const materialSentences = (material: ArticleMaterial) => {
  const seen = new Set<string>();
  const kept = splitSentences(materialBody(material))
    .map((sentence) => stripDateline(sentence.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim(), material.sourceName))
    .filter((sentence) => sentence.length >= 10 && !SENTENCE_NOISE.some((pattern) => pattern.test(sentence)))
    .filter((sentence) => !isTitleEcho(sentence, material.title));
  // 电头清理放在过滤之后：被标题回显挡掉的那句常常才是带作者和来源的那句
  const cleaned = kept.map((sentence, index) => (index === 0 ? dropLeadingMeta(sentence) : sentence));
  return cleaned
    .filter((sentence) => sentence.length >= 10)
    .filter((sentence) => {
      const key = normalizeKey(sentence);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

/** 中英混排：英文句之间补空格，中文句子直接相连。 */
const needsSpace = (left: string, right: string) => /[A-Za-z0-9)%\]"'’’.]$/.test(left) && /^[A-Za-z0-9(“"']/.test(right);

const tidyCjk = (text: string) => text
  .replace(/\s+([，。；：！？、）】”’])/g, '$1')
  .replace(/([（【“‘])\s+/g, '$1')
  .replace(/([，；：、])\s+/g, '$1')
  .replace(/([。！？])\s+(?=[\u4e00-\u9fa5])/g, '$1')
  .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
  .replace(/\s{2,}/g, ' ');

const joinSentences = (sentences: string[]) => sentences.reduce((output, sentence) => {
  const cleaned = tidyCjk(sentence);
  if (!output) return cleaned;
  return `${output}${needsSpace(output, cleaned) ? ' ' : ''}${cleaned}`;
}, '');

const attribution = (sourceName: string) => (/^[\u4e00-\u9fa5]/.test(sourceName) ? `据${sourceName}报道，` : `据 ${sourceName} 报道，`);

/** 优先中文标题、正文够长、重要度高的一条做头条，避免稿子以一句英文标题开头。 */
const scoreMaterial = (material: ArticleMaterial) => (/[\u4e00-\u9fa5]/.test(material.title) ? 0.45 : 0)
  + Math.min(materialBody(material).length / 1500, 0.25)
  + Math.max(0, Math.min(material.importance ?? 0, 1)) * 0.2;

const pickMaterials = (input: ArticleMaterial[], limit = 5) => {
  const seen = new Set<string>();
  const perSource = new Map<string, number>();
  const picked: ArticleMaterial[] = [];
  for (const material of [...input].sort((a, b) => scoreMaterial(b) - scoreMaterial(a))) {
    const key = normalizeKey(cleanArticleTitle(material.title));
    if (!key || seen.has(key)) continue;
    // 同一家媒体的多条容易是同一件事的连续报道，最多留两条
    if ((perSource.get(material.sourceName) ?? 0) >= 2) continue;
    seen.add(key);
    perSource.set(material.sourceName, (perSource.get(material.sourceName) ?? 0) + 1);
    picked.push(material);
    if (picked.length >= limit) break;
  }
  return picked;
};

const EN_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will', 'its', 'you', 'are', 'was', 'has', 'not', 'but', 'can', 'all', 'new', 'how', 'why', 'what', 'when', 'who', 'more', 'than', 'one', 'two', 'get', 'gets', 'got', 'use', 'uses', 'used', 'using', 'into', 'out', 'off', 'over', 'about', 'after', 'before', 'said', 'says', 'also', 'they', 'their', 'our', 'your', 'it', 'it’s', 'that’s']);

// 中文高频功能词，切成二元组后会大量重复，留着只会让任何两条素材看起来都相关
const CJK_STOP = new Set(['的是', '了一', '我们', '他们', '可以', '已经', '这个', '那个', '以及', '并且', '但是', '因为', '所以', '目前', '表示', '介绍', '支持', '通过', '进行', '相关', '方面', '同时', '此外', '记者', '报道', '消息', '今天', '昨日', '近日', '发布', '一个', '两个', '这些', '那些', '不是', '没有', '就是', '还是', '如果', '需要', '能够', '如何', '什么', '为什', '么样', '一些', '很多', '非常', '正在', '将在', '来说', '之上', '之下', '之间', '其中', '对于', '关于', '根据', '由于', '从而', '进而', '而且', '或者', '不过', '然而', '因此', '于是', '即可', '一下', '一种', '这样', '那样', '怎么', '多少']);

/** 中文取二元组、英文取整词：用来判断两条素材是不是在讲同一件事，而不是同一个大话题。 */
const textKeys = (text: string) => {
  const keys = new Set<string>();
  const cleaned = text.toLowerCase().replace(/[’']/g, '');
  for (const match of cleaned.matchAll(/[a-z][a-z0-9.+-]{1,24}/g)) {
    if (!EN_STOP.has(match[0])) keys.add(match[0]);
  }
  for (const chunk of cleaned.replace(/[^\u4e00-\u9fa5]+/g, ' ').split(/\s+/)) {
    for (let index = 0; index + 2 <= chunk.length; index += 1) {
      const gram = chunk.slice(index, index + 2);
      if (!CJK_STOP.has(gram)) keys.add(gram);
    }
  }
  return keys;
};

/**
 * 按「稀有词共现」算相似度：同一事件的报道会共享公司名、产品名、人名这类低频词，
 * 只是同属一个大话题的素材只会共享「模型」「智能」这种到处都有的词，权重自然被摊薄。
 */
const affinityOf = (materials: ArticleMaterial[]) => {
  const keySets = new Map<string, Set<string>>();
  const docFrequency = new Map<string, number>();
  for (const material of materials) {
    const keys = textKeys(`${cleanArticleTitle(material.title)} ${materialBody(material).slice(0, 900)}`);
    keySets.set(material.id, keys);
    for (const key of keys) docFrequency.set(key, (docFrequency.get(key) ?? 0) + 1);
  }
  const weight = (key: string) => 1 / (docFrequency.get(key) ?? 1);
  const norm = (keys: Set<string>) => Math.sqrt([...keys].reduce((sum, key) => sum + weight(key) ** 2, 0));
  return (left: ArticleMaterial, right: ArticleMaterial) => {
    const a = keySets.get(left.id);
    const b = keySets.get(right.id);
    if (!a?.size || !b?.size) return 0;
    let dot = 0;
    for (const key of a) if (b.has(key)) dot += weight(key);
    return dot / (norm(a) * norm(b) || 1);
  };
};

const CLUSTER_AFFINITY = 0.16;

/**
 * 一篇文章只讲一件事：以头条为基准，把「只是同一个大话题、其实是别的事」的素材挑出去。
 * 挑出去的素材不写进正文，避免成稿变成素材清单。
 */
export const selectCluster = (input: ArticleMaterial[], limit = 4) => {
  const ranked = pickMaterials(input, Math.max(limit, 8));
  if (ranked.length <= 1) return { materials: ranked, dropped: [] as ArticleMaterial[] };
  const affinity = affinityOf(ranked);
  // 以每条素材为中心拉一伙「讲同一件事」的，挑条数最多、总分最高的那组：
  // 只按单条打分选头条，会把两条同事件的稿子拆出去，只剩一条孤证。
  let best: ArticleMaterial[] = [ranked[0]];
  let bestScore = -1;
  for (const seed of ranked) {
    const members = [seed, ...ranked.filter((material) => material !== seed && affinity(seed, material) >= CLUSTER_AFFINITY)].slice(0, limit);
    // 条数优先，同条数时用素材分（中文标题、正文长度、重要度）决胜
    const score = members.length * 10 + members.reduce((sum, material) => sum + scoreMaterial(material), 0);
    if (score > bestScore) { best = members; bestScore = score; }
  }
  const kept = new Set(best.map((material) => material.id));
  return {
    materials: ranked.filter((material) => kept.has(material.id)),
    dropped: ranked.filter((material) => !kept.has(material.id))
  };
};

const MAX_TITLE = 70;

const cutAtWord = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const boundary = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('，'), slice.lastIndexOf('、'));
  const head = boundary > limit * 0.55 ? slice.slice(0, boundary) : slice;
  return `${head.replace(/[\s,，、;；:：]+$/, '')}…`;
};

const buildTitle = (materials: ArticleMaterial[]) => {
  if (!materials.length) return '待补标题';
  const primary = materials[0];
  const raw = cleanArticleTitle(primary.title).replace(/[：:|]+\s*$/, '');
  return cutAtWord(raw, MAX_TITLE);
};

/**
 * 本地成稿：只写同一件事，头条展开成导语，其余句子和同事件来源收进「关键信息」。
 * 所有句子都取自素材原文，不写素材里没有的结论。
 */
export const composeArticle = (input: ArticleMaterial[], label: string) => {
  const cluster = selectCluster(input);
  const materials = cluster.materials;
  const blocks = materials.map((material) => {
    // 摘要只有一两个短句时句子过滤器会全丢掉，这里退回整段原文，别让稿子空着
    const sentences = materialSentences(material);
    const body = materialBody(material);
    return { material, sentences: sentences.length || body.length < 6 ? sentences : [body.slice(0, 280)] };
  });
  const primary = blocks.find((block) => block.sentences.length);
  const lines: string[] = [];

  if (primary) {
    const lead = joinSentences(primary.sentences.slice(0, 4));
    const prefixed = /^据|^[A-Za-z]/.test(primary.sentences[0] ?? '') ? lead : `${attribution(primary.material.sourceName)}${lead}`;
    lines.push(prefixed, '');
  } else if (materials.length) {
    lines.push('这组素材只有标题，没有可引用的正文，发布前需要打开原文补充细节。', '');
  } else {
    lines.push('没有可用的素材，先回到信息流重新挑选。', '');
  }

  // 关键信息优先用头条后面没写进导语的句子，再补同事件的其他来源
  const bullets: string[] = [];
  if (primary) for (const sentence of primary.sentences.slice(4, 9)) bullets.push(joinSentences([sentence]));
  for (const block of blocks) {
    if (block === primary || !block.sentences.length) continue;
    bullets.push(`${joinSentences(block.sentences.slice(0, 2))}（${block.material.sourceName}）`);
  }
  if (bullets.length) lines.push('## 关键信息', '', ...bullets.map((line) => `- ${line}`), '');

  if (materials.length) {
    lines.push('## 来源', '');
    materials.forEach((material, index) => lines.push(`${index + 1}. [${cleanArticleTitle(material.title)}](${material.url}) · ${material.sourceName}`));
    lines.push('', '---', '');
    const hasNumbers = blocks.some((block) => /\d/.test(joinSentences(block.sentences)));
    const dropped = cluster.dropped.length;
    const checked = hasNumbers ? '文中数字与时间均引自原文，发布前建议对照官方口径再核一遍。' : '发布前建议对照原文确认没有转述失真。';
    lines.push(`*编辑备注：本篇围绕「${label}」整理，${checked}${dropped ? `另有 ${dropped} 条素材讲的是别的事，未写入正文。` : ''}*`);
  }

  const lead = primary?.sentences[0] ?? '';
  return { title: buildTitle(materials), content: lines.join('\n'), digest: lead ? joinSentences([lead]).slice(0, 90) : undefined };
};

const aiArticleSchema = z.object({ title: z.string().trim().min(4).max(120), digest: z.string().trim().max(200).optional(), content: z.string().trim().min(200).max(20_000) });

const AI_SYSTEM_PROMPT = [
  '你是中文科技媒体的资深编辑，要把几条素材写成一篇能直接发出去的文章：读者看到标题想点开，读完能带走判断。',
  '',
  '事实纪律：',
  '1. 只用素材里有的事实。数字、日期、版本号、模型名、公司名、引述，必须能对应到某条素材的原句，找不到就不写。',
  '2. 关键事实后面用 [编号] 标注出处，编号是素材下标（从 1 开始）；一句话里有两件事就标两处。',
  '3. 素材之间说法不一致时，把两种说法都写出来并注明各自来源，不要自己下裁决。',
  '',
  '写法：',
  '4. 输出中文 Markdown，不要一级标题，不要用代码块包全文，不要出现「待补充 / TODO / 参考素材」。',
  '5. 结构固定：3-4 句导语（发生了什么、影响谁、为什么是现在）→ 3-5 个「## 」小节，每节先给判断，再用两三条依据撑住 → 结尾「## 结论」给 2-3 条能直接执行的动作，一条一行。',
  '6. 正文 600-900 字，段落不超过 4 行，一句一件事，主谓宾清楚。',
  '7. 观点要挂在事实上：先写「这说明什么」，紧接着给依据，不空喊。',
  '8. 禁用词：赋能、闭环、抓手、生态位、护城河、颠覆式、值得关注的是、总的来说、综上所述、随着……的发展、无疑。',
  '9. 不写「本文」「笔者」这类自我指涉，也不复述标题，第一句就进事实。',
  '',
  '10. 素材是英文的，用中文转述，公司名、产品名、模型名保留英文原名。',
  '',
  '仅返回 JSON：{"title":"不超过28字、含具体主体和动作的标题","digest":"一两句可直接当社媒文案的摘要，不超过80字，不用感叹号","content":"Markdown 正文"}'
].join('\n');

/** 发布前的自检：字数、小节、出处标注、段落长度、空话词，任一项不过就重写一次。 */
export type ArticleQuality = { ok: boolean; words: number; sections: number; citations: number; longestParagraph: number; problems: string[] };

const BANNED_PHRASES = ['赋能', '闭环', '抓手', '生态位', '护城河', '颠覆式', '值得关注的是', '综上所述', '总的来说'];

const countCjk = (text: string) => (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;

export const assessArticle = (content: string): ArticleQuality => {
  const plain = content.replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/[*_`>#-]/g, ' ');
  const words = countCjk(plain);
  const sections = (content.match(/^##\s+\S/gm) ?? []).length;
  const citations = (content.match(/\[\d+\]/g) ?? []).length;
  const paragraphs = plain.split(/\n{2,}/).map((line) => line.trim()).filter(Boolean);
  const longestParagraph = paragraphs.reduce((max, line) => Math.max(max, countCjk(line)), 0);
  const problems: string[] = [];
  if (words < 500) problems.push(`正文只有 ${words} 字，需要 600 字以上`);
  if (sections < 3) problems.push('二级小节少于 3 个');
  if (citations < 3) problems.push('出处标注少于 3 处');
  if (longestParagraph > 340) problems.push(`有段落 ${longestParagraph} 字，需要拆到 4 行以内`);
  const banned = BANNED_PHRASES.filter((word) => content.includes(word));
  if (banned.length) problems.push(`出现空话词：${banned.join('、')}`);
  return { ok: problems.length === 0, words, sections, citations, longestParagraph, problems };
};

const stripJsonFence = (content: string) => content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

export const parseAiArticle = (raw: string) => {
  const parsed = aiArticleSchema.parse(JSON.parse(stripJsonFence(raw)));
  const content = parsed.content.replace(/^#\s+/m, '## ');
  if (!/^##\s/m.test(content)) throw new Error('AI 正文缺少小节结构');
  if (/待补充|TODO|占位内容/i.test(content)) throw new Error('AI 正文包含占位内容');
  return { title: parsed.title, content, digest: parsed.digest?.trim() || undefined };
};

const requestArticle = async (materials: ArticleMaterial[], label: string, options: { temperature: number; notes: string }) => {
  const payload = await withAiBudget(async () => {
    const response = await fetch(`${env.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(env.AI_WRITER_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AI_API_KEY}` },
      body: JSON.stringify({
        model: env.AI_MODEL, temperature: options.temperature, max_tokens: env.AI_WRITER_MAX_TOKENS,
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          {
            role: 'user', content: JSON.stringify({
              topic: label,
              materials: materials.map((material, index) => ({
                index: index + 1,
                title: cleanArticleTitle(material.title),
                source: material.sourceName,
                publishedAt: material.collectedAt,
                text: takeSentences(materialBody(material), 8, 1500)
              })),
              ...(options.notes ? { revision: options.notes } : {})
            })
          }
        ]
      })
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 240).replace(/\s+/g, ' ');
      throw new Error(`AI HTTP ${response.status}：${detail}`);
    }
    return await response.json() as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  });
  const choice = payload.choices?.[0];
  // 推理 token 也算在 max_tokens 里，撞上限时 JSON 会被切断，直接判失败让上层重写
  if (choice?.finish_reason === 'length') throw new Error('AI 输出被 token 上限截断');
  const content = choice?.message?.content ?? '';
  if (!content.trim()) throw new Error('AI 返回空正文');
  return parseAiArticle(content);
};

/** 文章能发出去的最低线：有结构、有话可说。低于这条线才重写，避免把能用的稿子丢掉。 */
const MIN_USABLE_WORDS = 260;

/** 写稿：先出一版，明显不够才带着问题清单重写一次；不可恢复的失败才回落到本地成稿。 */
const writeWithAi = async (materials: ArticleMaterial[], label: string) => {
  const startedAt = Date.now();
  let notes = '';
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    // 单次写稿可能要一两分钟，第二轮只在还剩预算时才做，避免任务挂到几分钟
    if (attempt === 2 && Date.now() - startedAt > env.AI_WRITER_RETRY_MS) break;
    try {
      const article = await requestArticle(materials, label, { temperature: attempt === 1 ? 0.5 : 0.3, notes });
      const quality = assessArticle(article.content);
      const usable = quality.words >= MIN_USABLE_WORDS && quality.sections >= 2;
      if (quality.ok || usable) {
        analysisCallStore.record({ provider: 'article-ai', status: 'success', attempts: attempt, durationMs: Date.now() - startedAt });
        return {
          ...article,
          note: quality.ok ? undefined : `这版 ${quality.words} 字、${quality.sections} 个小节，比目标短；素材本身没更多事实，可以补两条或手动扩一段`
        };
      }
      lastError = quality.problems.join('；');
      notes = `上一版没达标：${lastError}。请按事实纪律和结构要求重写整篇，不要只改局部措辞。`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'AI 写稿失败';
      notes = `上一版生成失败：${lastError}。请严格按「仅返回 JSON」的格式重写。`;
    }
    analysisCallStore.record({ provider: 'article-ai', status: 'failure', attempts: attempt, durationMs: Date.now() - startedAt, error: lastError });
  }
  analysisCallStore.record({ provider: 'article-fallback', status: 'fallback', attempts: 2, durationMs: Date.now() - startedAt, error: lastError });
  return null;
};

/** 素材太薄（只有标题或一句摘要）时，补一次原文正文，最多 4 条、每条 5 秒。 */
const enrichMaterials = async (materials: ArticleMaterial[]) => {
  if (env.NODE_ENV === 'test') return;
  const thin = materials.filter((material) => materialBody(material).length < 320 && material.url).slice(0, 4);
  if (!thin.length) return;
  const texts = await Promise.all(thin.map((material) => readSourcePage(material.url)));
  thin.forEach((material, index) => {
    if (!texts[index]) return;
    material.summary = texts[index].slice(0, 1800);
  });
};

export const buildArticle = async (materials: ArticleMaterial[], label: string): Promise<ArticleDraft> => {
  await enrichMaterials(materials);
  // 送给模型和列在文末的必须是同一批、同一个顺序，否则正文里的 [编号] 会指错来源
  const cluster = selectCluster(materials);
  const used = cluster.materials;
  if (env.AI_API_KEY) {
    // 主题名太泛（「人工智能」「部署运维」）会让稿子飘，改用头条标题当前提
    const topic = cleanArticleTitle(used[0]?.title ?? '').slice(0, 24) || label;
    const ai = await writeWithAi(used, topic);
    if (ai) {
      const sources = used.map((material, index) => `${index + 1}. [${cleanArticleTitle(material.title)}](${material.url}) · ${material.sourceName}`);
      const content = sources.length ? `${ai.content}\n\n## 来源\n\n${sources.join('\n')}` : ai.content;
      // 告诉作者这次只用了哪几条：选了一堆素材但只写一件事时，别让人以为全写进去了
      const droppedNote = cluster.dropped.length ? `另有 ${cluster.dropped.length} 条素材讲的是别的事，没写进这篇` : '';
      const note = [ai.note, droppedNote].filter(Boolean).join('；') || undefined;
      return { title: ai.title, content, digest: ai.digest, note, provider: 'ai' };
    }
  }
  return { ...composeArticle(materials, label), provider: 'fallback' };
};
