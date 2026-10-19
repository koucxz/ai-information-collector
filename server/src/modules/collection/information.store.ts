import { createHash, randomUUID } from 'node:crypto';
import { db } from '../../db/client.js';
import type { SearchResult } from './collection.types.js';
import { normalizeUrl } from './normalize.js';

export type StoredInformation = SearchResult & { id: string; eventKey: string; isRead: boolean; relevanceScore: number; importanceScore: number; aiStatus: string; analysisSummary: string; analysisReason: string };
export type FeedOptions = { source?: string; unread?: boolean; minImportance?: number; minRelevance?: number; sort?: 'latest' | 'importance'; page: number; pageSize: number };

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
export const dedupeKeyFor = (item: Pick<SearchResult, 'url' | 'fingerprint'>) => { const normalizedUrl = normalizeUrl(item.url); return normalizedUrl ? `url:${normalizedUrl}` : `fingerprint:${item.fingerprint}`; };
const mapRow = (row: Record<string, unknown>): StoredInformation => ({ source: String(row.source), sourceName: String(row.source_name), keyword: String(row.keyword), title: String(row.title), summary: String(row.summary), content: String(row.content), url: String(row.url), publishedAt: row.published_at ? String(row.published_at) : null, collectedAt: String(row.collected_at), fingerprint: String(row.fingerprint), id: String(row.id), eventKey: String(row.event_key), isRead: Boolean(row.is_read), relevanceScore: Number(row.relevance_score), importanceScore: Number(row.importance_score), aiStatus: String(row.ai_status), analysisSummary: String(row.analysis_summary), analysisReason: String(row.analysis_reason) });

export const informationStore = {
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
    }
    return { saved, duplicates: results.length - saved };
  },
  list() { return (db.prepare('SELECT * FROM information_items ORDER BY collected_at DESC').all() as unknown as Record<string, unknown>[]).map(mapRow); },
  feed(options: FeedOptions) {
    const conditions: string[] = []; const params: Array<string | number> = [];
    if (options.source) { conditions.push('source = ?'); params.push(options.source); }
    if (options.unread) conditions.push('is_read = 0');
    if (options.minImportance !== undefined) { conditions.push('importance_score >= ?'); params.push(options.minImportance); }
    if (options.minRelevance !== undefined) { conditions.push('relevance_score >= ?'); params.push(options.minRelevance); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = options.sort === 'importance' ? 'importance_score DESC, collected_at DESC' : 'collected_at DESC';
    const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM information_items ${where}`).get(...params) as { count: number }).count);
    const rows = db.prepare(`SELECT * FROM information_items ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, options.pageSize, (options.page - 1) * options.pageSize) as unknown as Record<string, unknown>[];
    return { data: rows.map(mapRow), page: options.page, pageSize: options.pageSize, total, totalPages: Math.ceil(total / options.pageSize) };
  },
  findById(id: string) { const row = db.prepare('SELECT * FROM information_items WHERE id = ?').get(id) as unknown as Record<string, unknown> | undefined; return row ? mapRow(row) : undefined; },
  markRead(id: string) { return db.prepare('UPDATE information_items SET is_read = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id).changes > 0; },
  event(id: string) {
    const item = this.findById(id); if (!item) return undefined;
    const sources = (db.prepare('SELECT * FROM information_items WHERE event_key = ? ORDER BY collected_at DESC').all(item.eventKey) as unknown as Record<string, unknown>[]).map(mapRow);
    const timestamps = sources.map((source) => source.collectedAt).sort();
    return { eventKey: item.eventKey, title: item.title, firstSeenAt: timestamps[0], lastSeenAt: timestamps.at(-1), sourceCount: new Set(sources.map((source) => source.source)).size, sources };
  },
  updateAnalysis(id: string, analysis: { relevanceScore: number; importanceScore: number; summary: string; reason: string; provider: string }) { db.prepare('UPDATE information_items SET relevance_score = ?, importance_score = ?, ai_status = ?, analysis_summary = ?, analysis_reason = ?, updated_at = ? WHERE id = ?').run(analysis.relevanceScore, analysis.importanceScore, analysis.provider, analysis.summary, analysis.reason, new Date().toISOString(), id); return this.findById(id); },
  eventKeyFor
};
