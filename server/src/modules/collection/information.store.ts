import { createHash, randomUUID } from 'node:crypto';
import { db } from '../../db/client.js';
import type { SearchResult } from './collection.types.js';
import { dedupeUrl, normalizeUrl } from './normalize.js';
import { tagsForItems, retagItem, topicRules, type StoredTopicTag } from './topic-tagger.js';

export type FeedbackValue = 'helpful' | 'irrelevant' | 'duplicate';
export type StoredInformation = SearchResult & { id: string; eventKey: string; isRead: boolean; isSaved: boolean; isArchived: boolean; relevanceScore: number; importanceScore: number; aiStatus: string; analysisSummary: string; analysisReason: string; feedback: FeedbackValue | null; personalizedScore: number };
export type FeedOptions = { source?: string; unread?: boolean; saved?: boolean; archived?: boolean; query?: string; minImportance?: number; minRelevance?: number; topicWords?: string[]; topicId?: string; unclassified?: boolean; sort?: 'latest' | 'importance' | 'personalized'; page: number; pageSize: number };
export type FeedOverview = { all: number; unread: number; relevant: number; globalAll: number; globalUnread: number; topicCounts: Record<string, number>; unclassified: number };

/**
 * 主题筛选与「未分类」完全以打标表为准：采集查询词只是打标时的加分项，
 * 不再直接当分类用，避免搜索噪声混进主题、主题计数和列表对不上。
 */
const topicCondition = (_words?: string[], topicId?: string, unclassified?: boolean) => {
  const noTags = 'NOT EXISTS (SELECT 1 FROM information_item_topics t WHERE t.item_id = information_items.id)';
  if (unclassified) return { sql: noTags, params: [] as string[] };
  if (topicId) return {
    sql: 'EXISTS (SELECT 1 FROM information_item_topics t WHERE t.item_id = information_items.id AND t.topic_id = ?)',
    params: [topicId]
  };
  return { sql: '', params: [] as string[] };
};

const canonicalTitle = (title: string) => title.toLocaleLowerCase()
  .replace(/[【\[（(][^】\]）)]*[】\]）)]/g, ' ')
  .replace(/(?:最新|独家|重磅|正式|消息|视频|专访)/g, ' ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const titleTokens = (title: string) => {
  const canonical = canonicalTitle(title);
  const words = canonical.match(/[a-z\d]+|[\p{Script=Han}]/gu) ?? [];
  const tokens = new Set(words.filter((word) => !/^[的了和与及]$/.test(word)));
  const han = words.filter((word) => /[\p{Script=Han}]/u.test(word));
  for (let index = 0; index < han.length - 1; index += 1) tokens.add(`${han[index]}${han[index + 1]}`);
  return tokens;
};
export const titleSimilarity = (left: string, right: string) => {
  const leftTokens = titleTokens(left); const rightTokens = titleTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
};
export const eventKeyFor = (title: string) => createHash('sha256').update(canonicalTitle(title)).digest('hex').slice(0, 24);
const resolveEventKey = (title: string) => {
  const recent = db.prepare('SELECT title, event_key FROM information_items ORDER BY collected_at DESC LIMIT 200').all() as unknown as Array<{ title: string; event_key: string }>;
  let match: { key: string; score: number } | undefined;
  for (const item of recent) {
    const score = titleSimilarity(title, item.title);
    if (score >= 0.68 && (!match || score > match.score)) match = { key: item.event_key, score };
  }
  return match?.key ?? eventKeyFor(title);
};
export const dedupeKeyFor = (item: Pick<SearchResult, 'url' | 'fingerprint'>) => { const normalizedUrl = dedupeUrl(item.url); return normalizedUrl ? `url:${normalizedUrl}` : `fingerprint:${item.fingerprint}`; };
const mapRow = (row: Record<string, unknown>): StoredInformation => ({ source: String(row.source), sourceName: String(row.source_name), keyword: String(row.keyword), title: String(row.title), summary: String(row.summary), content: String(row.content), url: String(row.url), publishedAt: row.published_at ? String(row.published_at) : null, collectedAt: String(row.collected_at), fingerprint: String(row.fingerprint), id: String(row.id), eventKey: String(row.event_key), isRead: Boolean(row.is_read), isSaved: Boolean(row.is_saved), isArchived: Boolean(row.is_archived), relevanceScore: Number(row.relevance_score), importanceScore: Number(row.importance_score), aiStatus: String(row.ai_status), analysisSummary: String(row.analysis_summary), analysisReason: String(row.analysis_reason), feedback: row.feedback ? String(row.feedback) as FeedbackValue : null, personalizedScore: Number(row.personalized_score ?? 0) });

/**
 * 列表只展示标题与摘要，正文 / 指纹等大字段无需下发。
 * 线上单条信息的正文可达 5KB，10 条列表曾返回 500KB+，跨境链路下首屏特别慢。
 */
const FEED_TEXT_LIMIT = 320;
const clip = (value: string, limit = FEED_TEXT_LIMIT) => value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
const mapFeedRow = (row: Record<string, unknown>, tags: StoredTopicTag[] = []) => ({
  id: String(row.id),
  source: String(row.source),
  sourceName: String(row.source_name),
  keyword: String(row.keyword),
  title: String(row.title),
  summary: clip(String(row.summary ?? '')),
  url: String(row.url),
  collectedAt: String(row.collected_at),
  importanceScore: Number(row.importance_score),
  relevanceScore: Number(row.relevance_score),
  isRead: Boolean(row.is_read),
  isSaved: Boolean(row.is_saved),
  topics: tags.map(tag => ({ id: tag.id, name: tag.name, score: tag.score, primary: tag.primary })),
  aiStatus: String(row.ai_status),
  analysisSummary: clip(String(row.analysis_summary ?? '')),
  analysisReason: clip(String(row.analysis_reason ?? ''), 160),
  feedback: row.feedback ? String(row.feedback) as FeedbackValue : null,
  personalizedScore: Number(row.personalized_score ?? 0)
});

const feedbackJoin = 'LEFT JOIN information_feedback feedback_row ON feedback_row.item_id = information_items.id';
const feedbackSelect = `information_items.*, feedback_row.value AS feedback,
  (information_items.importance_score * 0.55 + information_items.relevance_score * 0.45
    + CASE feedback_row.value WHEN 'helpful' THEN 0.4 WHEN 'irrelevant' THEN -0.5 WHEN 'duplicate' THEN -0.7 ELSE 0 END
    + COALESCE((SELECT AVG(CASE source_feedback.value WHEN 'helpful' THEN 0.15 WHEN 'irrelevant' THEN -0.2 WHEN 'duplicate' THEN -0.1 ELSE 0 END) FROM information_feedback source_feedback JOIN information_items source_item ON source_item.id = source_feedback.item_id WHERE source_item.source = information_items.source), 0)
    + COALESCE((SELECT AVG(CASE keyword_feedback.value WHEN 'helpful' THEN 0.15 WHEN 'irrelevant' THEN -0.2 WHEN 'duplicate' THEN -0.1 ELSE 0 END) FROM information_feedback keyword_feedback JOIN information_items keyword_item ON keyword_item.id = keyword_feedback.item_id WHERE keyword_item.keyword = information_items.keyword), 0)
  ) AS personalized_score`;

export const informationStore = {
  indexItem(item: { id: string; title: string; summary: string; content: string; analysisSummary?: string; keyword: string; sourceName: string }) {
    db.prepare('DELETE FROM information_search WHERE item_id = ?').run(item.id);
    db.prepare('INSERT INTO information_search (item_id, title, summary, content, analysis_summary, keyword, source_name) VALUES (?, ?, ?, ?, ?, ?, ?)').run(item.id, item.title, item.summary, item.content, item.analysisSummary ?? '', item.keyword, item.sourceName);
  },
  saveResults(results: SearchResult[]) {
    const insert = db.prepare('INSERT OR IGNORE INTO information_items (id, source, source_name, keyword, title, summary, content, url, published_at, collected_at, fingerprint, dedupe_key, event_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    let saved = 0;
    for (const item of results) {
      const timestamp = new Date().toISOString();
      const normalizedUrl = normalizeUrl(item.url);
      const dedupeKey = dedupeKeyFor(item);
      const eventKey = resolveEventKey(item.title);
      const result = insert.run(randomUUID(), item.source, item.sourceName, item.keyword, item.title, item.summary, item.content, normalizedUrl, item.publishedAt, item.collectedAt, item.fingerprint, dedupeKey, eventKey, timestamp, timestamp);
      saved += Number(result.changes);
      db.prepare('UPDATE information_items SET source_name = ?, keyword = ?, title = ?, summary = ?, content = ?, url = ?, published_at = ?, collected_at = ?, fingerprint = ?, event_key = ?, updated_at = ? WHERE source = ? AND dedupe_key = ?').run(item.sourceName, item.keyword, item.title, item.summary, item.content, normalizedUrl, item.publishedAt, item.collectedAt, item.fingerprint, eventKey, timestamp, item.source, dedupeKey);
      const stored = db.prepare('SELECT id FROM information_items WHERE source = ? AND dedupe_key = ?').get(item.source, dedupeKey) as { id: string } | undefined;
      if (stored) {
        const current = this.findById(stored.id);
        if (current) this.indexItem(current);
        retagItem(stored.id);
      }
    }
    return { saved, duplicates: results.length - saved };
  },
  list() { return (db.prepare(`SELECT ${feedbackSelect} FROM information_items ${feedbackJoin} ORDER BY collected_at DESC`).all() as unknown as Record<string, unknown>[]).map(mapRow); },
  feed(options: FeedOptions) {
    const conditions: string[] = []; const params: Array<string | number> = [];
    const topic = topicCondition(options.topicWords, options.topicId, options.unclassified);
    if (topic.sql) { conditions.push(topic.sql); params.push(...topic.params); }
    if (options.source) { conditions.push('information_items.source = ?'); params.push(options.source); }
    if (options.unread) conditions.push('information_items.is_read = 0');
    if (options.saved) conditions.push('information_items.is_saved = 1');
    if (options.archived === false) conditions.push('information_items.is_archived = 0');
    if (options.archived === true) conditions.push('information_items.is_archived = 1');
    if (options.query?.trim()) {
      conditions.push('(information_items.title LIKE ? OR information_items.summary LIKE ? OR information_items.content LIKE ? OR information_items.analysis_summary LIKE ? OR information_items.keyword LIKE ? OR information_items.source_name LIKE ? OR information_items.id IN (SELECT item_id FROM information_search WHERE information_search MATCH ?))');
      const query = `%${options.query.trim()}%`;
      const ftsQuery = `"${options.query.trim().replaceAll('"', ' ')}"`;
      params.push(query, query, query, query, query, query, ftsQuery);
    }
    if (options.minImportance !== undefined) { conditions.push('information_items.importance_score >= ?'); params.push(options.minImportance); }
    if (options.minRelevance !== undefined) { conditions.push('information_items.relevance_score >= ?'); params.push(options.minRelevance); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = options.sort === 'importance' ? 'information_items.importance_score DESC, information_items.collected_at DESC' : options.sort === 'personalized' ? 'personalized_score DESC, information_items.collected_at DESC' : 'information_items.collected_at DESC';
    const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM information_items ${where}`).get(...params) as { count: number }).count);
    const rows = db.prepare(`SELECT ${feedbackSelect} FROM information_items ${feedbackJoin} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, options.pageSize, (options.page - 1) * options.pageSize) as unknown as Record<string, unknown>[];
    const tagMap = tagsForItems(rows.map((row) => String(row.id)));
    return { data: rows.map((row) => mapFeedRow(row, tagMap.get(String(row.id)))), page: options.page, pageSize: options.pageSize, total, totalPages: Math.ceil(total / options.pageSize) };
  },
  overview(topicWords?: string[], topicId?: string, unclassified?: boolean): FeedOverview {
    const filter = topicCondition(topicWords, topicId, unclassified);
    const where = `WHERE information_items.is_archived = 0${filter.sql ? ` AND ${filter.sql}` : ''}`;
    const row = db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN information_items.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread,
      COALESCE(SUM(CASE WHEN information_items.relevance_score >= 0.8 THEN 1 ELSE 0 END), 0) AS relevant
      FROM information_items ${where}`).get(...filter.params) as { total: number; unread: number; relevant: number };
    const globalRow = db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread
      FROM information_items WHERE is_archived = 0`).get() as { total: number; unread: number };
    // 计数以打标结果为准，同一条信息在多个主题下各算一次，但不会像过去那样被同一主题的多个查询词重复累加
    const rules = topicRules();
    const tagRows = db.prepare(`SELECT t.item_id AS itemId, t.topic_id AS topicId FROM information_item_topics t
      JOIN information_items i ON i.id = t.item_id WHERE i.is_archived = 0`).all() as unknown as Array<{ itemId: string; topicId: string }>;
    const topicCounts: Record<string, number> = Object.fromEntries(rules.map((rule) => [rule.id, 0]));
    const taggedIds = new Set<string>();
    for (const tag of tagRows) {
      if (!(tag.topicId in topicCounts)) continue;
      topicCounts[tag.topicId] += 1;
      taggedIds.add(tag.itemId);
    }
    return { all: Number(row.total), unread: Number(row.unread), relevant: Number(row.relevant), globalAll: Number(globalRow.total), globalUnread: Number(globalRow.unread), topicCounts, unclassified: Math.max(0, Number(globalRow.total) - taggedIds.size) };
  },
  findById(id: string) { const row = db.prepare(`SELECT ${feedbackSelect} FROM information_items ${feedbackJoin} WHERE information_items.id = ?`).get(id) as unknown as Record<string, unknown> | undefined; return row ? mapRow(row) : undefined; },
  findByResult(item: Pick<SearchResult, 'source' | 'url' | 'fingerprint'>) { const row = db.prepare(`SELECT ${feedbackSelect} FROM information_items ${feedbackJoin} WHERE information_items.source = ? AND information_items.dedupe_key = ?`).get(item.source, dedupeKeyFor(item)) as unknown as Record<string, unknown> | undefined; return row ? mapRow(row) : undefined; },
  setRead(id: string, isRead = true) { return db.prepare('UPDATE information_items SET is_read = ?, updated_at = ? WHERE id = ?').run(isRead ? 1 : 0, new Date().toISOString(), id).changes > 0; },
  markRead(id: string) { return this.setRead(id, true); },
  setSaved(id: string, isSaved: boolean) { return db.prepare('UPDATE information_items SET is_saved = ?, updated_at = ? WHERE id = ?').run(isSaved ? 1 : 0, new Date().toISOString(), id).changes > 0; },
  setArchived(id: string, isArchived: boolean) { return db.prepare('UPDATE information_items SET is_archived = ?, updated_at = ? WHERE id = ?').run(isArchived ? 1 : 0, new Date().toISOString(), id).changes > 0; },
  setFeedback(id: string, value: FeedbackValue) {
    if (!db.prepare('SELECT id FROM information_items WHERE id = ?').get(id)) return undefined;
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO information_feedback (item_id, value, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(id, value, timestamp, timestamp);
    return this.findById(id);
  },
  event(id: string) {
    const item = this.findById(id); if (!item) return undefined;
    const sources = (db.prepare('SELECT * FROM information_items WHERE event_key = ? ORDER BY collected_at DESC').all(item.eventKey) as unknown as Record<string, unknown>[]).map(mapRow);
    const timestamps = sources.map((source) => source.collectedAt).sort();
    return { eventKey: item.eventKey, title: item.title, firstSeenAt: timestamps[0], lastSeenAt: timestamps.at(-1), sourceCount: new Set(sources.map((source) => source.source)).size, sources };
  },
  updateAnalysis(id: string, analysis: { relevanceScore: number; importanceScore: number; summary: string; reason: string; provider: string }) { db.prepare('UPDATE information_items SET relevance_score = ?, importance_score = ?, ai_status = ?, analysis_summary = ?, analysis_reason = ?, updated_at = ? WHERE id = ?').run(analysis.relevanceScore, analysis.importanceScore, analysis.provider, analysis.summary, analysis.reason, new Date().toISOString(), id); const item = this.findById(id); if (item) this.indexItem(item); return item; },
  eventKeyFor
};
