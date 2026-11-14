import { createHash } from 'node:crypto';
import { db, topicStore } from '../../db/client.js';
import { cleanForMatch, compactForMatch, containsTerm } from './text-match.js';

/**
 * 主题打标：过去只把采集时写入的 keyword 当分类，一条信息只能属于一个查询词，
 * 主题改名 / 别名调整后历史数据就对不上，且标题里明明写着别的主题也不会被归进去。
 * 这里改成按「主题名 + 别名 + 启用的关键词」对标题 / 摘要 / 正文做规则匹配：
 * - 中文按连续词匹配，英文按词边界匹配（AI 不会命中 maintain，Go 不会命中 Google）
 * - 标题权重高于摘要、摘要高于正文，主题名出现在标题额外加分
 * - 主题排除词命中整条信息时该主题直接不参与打标
 * - 采集查询词仍然作为最强信号保留，保证历史数据不会因为规则升级而消失
 * 结果写入 information_item_topics，一条信息可以带多个主题标签，并标出主标签。
 */

export type TopicRule = {
  id: string;
  name: string;
  terms: string[];
  excludes: string[];
  queryWords: string[];
};
export type TopicTagHit = { id: string; name: string; score: number; matched: string[] };
export type RetagSummary = { changed: boolean; items: number; tagged: number; unclassified: number };

type ItemRow = {
  id: string; title: string; summary: string; content: string;
  analysis_summary: string; keyword: string; source_name: string;
};

const clean = cleanForMatch;
const compact = compactForMatch;
const unique = (values: string[]) => [...new Set(values.map(clean).filter(Boolean))];

/** 模型名的常见写法：GPT 系列在正文里几乎都写成 ChatGPT，词边界匹配不到。 */
const termAliases = (term: string) => clean(term) === 'gpt' ? ['chatgpt'] : [];

export const topicRules = (): TopicRule[] => topicStore.list().map((topic) => ({
  id: topic.id,
  name: topic.name,
  // 停用的关键词只用于兼容历史查询词，不再拿来给新内容打标
  terms: unique([
    ...topic.keywords.filter((keyword) => keyword.enabled).flatMap((keyword) => [keyword.value, ...termAliases(keyword.value)]),
    ...topic.aliases.flatMap((alias) => [alias, ...termAliases(alias)]),
    topic.name,
    ...termAliases(topic.name)
  ]),
  excludes: unique(topic.excludeWords),
  queryWords: unique([
    ...topic.keywords.map((keyword) => keyword.value),
    ...topic.aliases,
    topic.name
  ])
}));

// 标题命中 3 分、摘要 2 分、正文 1 分：正文里偶然出现一个词不足以打标，标题或摘要命中才算
const TAG_THRESHOLD = 2;
const MAX_TAGS = 3;

/** 纯函数，方便单测直接验证打标规则，不依赖数据库。 */
export const tagText = (
  item: { title: string; summary: string; content: string; analysisSummary?: string; keyword: string },
  rules: TopicRule[]
): TopicTagHit[] => {
  const fields = [
    { text: clean(item.title), dense: compact(item.title), weight: 3 },
    { text: clean(item.summary), dense: compact(item.summary), weight: 2 },
    { text: clean(item.analysisSummary ?? ''), dense: compact(item.analysisSummary ?? ''), weight: 1 },
    { text: clean(item.content), dense: compact(item.content), weight: 1 }
  ];
  const wholeText = fields.map((field) => field.text).join(' ');
  const wholeDense = compact(wholeText);
  const keyword = clean(item.keyword);
  const hits: TopicTagHit[] = [];
  for (const rule of rules) {
    if (rule.excludes.some((word) => containsTerm(wholeText, wholeDense, word))) continue;
    let score = 0;
    let strongHit = false;
    const matched = new Set<string>();
    for (const term of rule.terms) {
      let best = 0;
      for (const field of fields) {
        if (containsTerm(field.text, field.dense, term)) {
          best = Math.max(best, field.weight);
          // 正文里偶然出现一次模型名不足以归类，标题或摘要命中才算真正相关
          if (field.weight >= 2) strongHit = true;
        }
      }
      if (best) { score += best; matched.add(term); }
    }
    if (containsTerm(fields[0].text, fields[0].dense, rule.name)) { score += 2; strongHit = true; }
    const queryHit = keyword ? rule.queryWords.includes(keyword) : false;
    if (queryHit) {
      score += 3;
      matched.add(rule.name);
    }
    // 采集查询词只是加分项：搜索结果里常混入 GitHub issue 等无关内容，
    // 标题和摘要都没有主题词时一律不归类，避免把噪声算进主题。
    if (!strongHit || score < TAG_THRESHOLD) continue;
    hits.push({ id: rule.id, name: rule.name, score, matched: [...matched].slice(0, 6) });
  }
  return hits.sort((left, right) => right.score - left.score).slice(0, MAX_TAGS);
};

const writeTags = (itemId: string, tags: TopicTagHit[]) => {
  db.prepare('DELETE FROM information_item_topics WHERE item_id = ?').run(itemId);
  const insert = db.prepare('INSERT INTO information_item_topics (item_id, topic_id, score, matched_json, is_primary) VALUES (?, ?, ?, ?, ?)');
  tags.forEach((tag, index) => insert.run(itemId, tag.id, tag.score, JSON.stringify(tag.matched), index === 0 ? 1 : 0));
};

const ITEM_COLUMNS = 'id, title, summary, content, analysis_summary, keyword, source_name';
const metaSignature = () => (db.prepare("SELECT value FROM topic_tag_meta WHERE id = 'signature'").get() as { value: string } | undefined)?.value;
const saveSignature = (value: string) => {
  db.prepare("INSERT INTO topic_tag_meta (id, value, updated_at) VALUES ('signature', ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(value, new Date().toISOString());
};

/**
 * 主题配置变化（改名 / 增删关键词 / 排除词）后自动全量重打标；
 * 配置没变时是常数级开销，可以放心在请求入口调用。
 */
// 规则本身升级时也要让历史数据重新打标，不能只看主题配置是否变化
const RULES_VERSION = 4;
export const ensureTopicTags = (force = false): RetagSummary => {
  const rules = topicRules();
  const signature = createHash('sha1').update(`${RULES_VERSION}|${JSON.stringify(rules)}`).digest('hex');
  const current = metaSignature();
  if (!force && current === signature) return { changed: false, items: 0, tagged: 0, unclassified: 0 };
  const rows = db.prepare(`SELECT ${ITEM_COLUMNS} FROM information_items`).all() as unknown as ItemRow[];
  db.exec('DELETE FROM information_item_topics');
  let tagged = 0;
  for (const row of rows) {
    const hits = tagText(row, rules);
    if (hits.length) tagged += 1;
    writeTags(row.id, hits);
  }
  saveSignature(signature);
  return { changed: true, items: rows.length, tagged, unclassified: rows.length - tagged };
};

/** 采集写入 / 更新单条信息后立刻打标，避免新数据要等下一次全量重算才出现在主题里。 */
export const retagItem = (itemId: string) => {
  ensureTopicTags();
  const row = db.prepare(`SELECT ${ITEM_COLUMNS} FROM information_items WHERE id = ?`).get(itemId) as unknown as ItemRow | undefined;
  if (row) writeTags(itemId, tagText(row, topicRules()));
};

export type StoredTopicTag = { id: string; name: string; score: number; matched: string[]; primary: boolean };

export const tagsForItems = (itemIds: string[]): Map<string, StoredTopicTag[]> => {
  const result = new Map<string, StoredTopicTag[]>();
  if (!itemIds.length) return result;
  const rows = db.prepare(`SELECT t.item_id AS itemId, t.topic_id AS topicId, t.score, t.matched_json AS matched, t.is_primary AS isPrimary,
    COALESCE(topics.name, '') AS name
    FROM information_item_topics t LEFT JOIN topics ON topics.id = t.topic_id
    WHERE t.item_id IN (${itemIds.map(() => '?').join(',')})
    ORDER BY t.is_primary DESC, t.score DESC`).all(...itemIds) as unknown as Array<{
      itemId: string; topicId: string; name: string; score: number; matched: string; isPrimary: number;
    }>;
  for (const row of rows) {
    if (!row.name) continue;
    let parsed: string[] = [];
    try { parsed = JSON.parse(row.matched) as string[]; } catch { /* 旧数据忽略 */ }
    const list = result.get(row.itemId) ?? [];
    list.push({ id: row.topicId, name: row.name, score: Number(row.score), matched: parsed, primary: Boolean(row.isPrimary) });
    result.set(row.itemId, list);
  }
  return result;
};

export const allTopicQueryWords = () => unique(topicRules().flatMap((rule) => rule.queryWords));
