import { createHash, randomUUID } from 'node:crypto';
import { db } from '../../db/client.js';
import { fallbackAnalyze } from '../analysis/analysis.service.js';
import type { SearchResult } from './collection.types.js';
import { normalizeUrl } from './normalize.js';

export type StoredInformation = SearchResult & { id: string; eventKey: string; isRead: boolean; relevanceScore: number; importanceScore: number; aiStatus: string; analysisSummary: string; analysisReason: string };
export type FeedOptions = { source?: string; unread?: boolean; minImportance?: number; minRelevance?: number; sort?: 'latest' | 'importance'; page: number; pageSize: number };

const eventKeyFor = (title: string) => createHash('sha256').update(title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).digest('hex').slice(0, 24);
export const dedupeKeyFor = (item: Pick<SearchResult, 'url' | 'fingerprint'>) => { const normalizedUrl = normalizeUrl(item.url); return normalizedUrl ? `url:${normalizedUrl}` : `fingerprint:${item.fingerprint}`; };
const mapRow = (row: Record<string, unknown>): StoredInformation => ({ source: String(row.source), sourceName: String(row.source_name), keyword: String(row.keyword), title: String(row.title), summary: String(row.summary), content: String(row.content), url: String(row.url), publishedAt: row.published_at ? String(row.published_at) : null, collectedAt: String(row.collected_at), fingerprint: String(row.fingerprint), id: String(row.id), eventKey: String(row.event_key), isRead: Boolean(row.is_read), relevanceScore: Number(row.relevance_score), importanceScore: Number(row.importance_score), aiStatus: String(row.ai_status), analysisSummary: String(row.analysis_summary), analysisReason: String(row.analysis_reason) });

export const informationStore = {
  saveResults(results: SearchResult[]) {
    const insert = db.prepare('INSERT OR IGNORE INTO information_items (id, source, source_name, keyword, title, summary, content, url, published_at, collected_at, fingerprint, dedupe_key, event_key, relevance_score, importance_score, ai_status, analysis_summary, analysis_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    let saved = 0;
    // 一轮多源采集可能上百条，逐条提交太慢，包一个事务
    db.exec('BEGIN');
    try {
      for (const item of results) {
        const timestamp = new Date().toISOString();
        const normalizedUrl = normalizeUrl(item.url);
        const dedupeKey = dedupeKeyFor(item);
        // 入库即用本地规则给一个基础分：否则信息流里全是 0%，排序也失去意义
        const baseline = fallbackAnalyze(item);
        const result = insert.run(randomUUID(), item.source, item.sourceName, item.keyword, item.title, item.summary, item.content, normalizedUrl, item.publishedAt, item.collectedAt, item.fingerprint, dedupeKey, eventKeyFor(item.title), baseline.relevanceScore, baseline.importanceScore, baseline.provider, baseline.summary, baseline.reason, timestamp, timestamp);
        saved += Number(result.changes);
        db.prepare('UPDATE information_items SET source_name = ?, keyword = ?, title = ?, summary = ?, content = ?, url = ?, published_at = ?, collected_at = ?, fingerprint = ?, event_key = ?, updated_at = ? WHERE source = ? AND dedupe_key = ?').run(item.sourceName, item.keyword, item.title, item.summary, item.content, normalizedUrl, item.publishedAt, item.collectedAt, item.fingerprint, eventKeyFor(item.title), timestamp, item.source, dedupeKey);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { saved, duplicates: results.length - saved };
  },
  /** 历史数据兜底：规则升级后按同一套逻辑重算本地评分（AI 分析过的条目不动） */
  backfillScores() {
    const rows = db.prepare("SELECT id, keyword, title, summary, content, published_at, relevance_score, importance_score FROM information_items WHERE ai_status = 'fallback' OR (relevance_score = 0 AND importance_score = 0)").all() as unknown as Array<{ id: string; keyword: string; title: string; summary: string; content: string; published_at: string | null; relevance_score: number; importance_score: number }>;
    if (rows.length === 0) return 0;
    const update = db.prepare('UPDATE information_items SET relevance_score = ?, importance_score = ?, ai_status = ?, analysis_summary = ?, analysis_reason = ?, updated_at = ? WHERE id = ?');
    const timestamp = new Date().toISOString();
    let changed = 0;
    for (const row of rows) {
      const baseline = fallbackAnalyze({ ...row, publishedAt: row.published_at });
      const drifted = Math.abs(baseline.relevanceScore - row.relevance_score) > 0.001 || Math.abs(baseline.importanceScore - row.importance_score) > 0.001;
      if (!drifted) continue;
      update.run(baseline.relevanceScore, baseline.importanceScore, baseline.provider, baseline.summary, baseline.reason, timestamp, row.id);
      changed += 1;
    }
    return changed;
  },
  list() { return (db.prepare('SELECT * FROM information_items ORDER BY collected_at DESC').all() as unknown as Record<string, unknown>[]).map(mapRow); },
  feed(options: FeedOptions) {
    const conditions: string[] = []; const params: Array<string | number> = [];
    if (options.source) { conditions.push('source = ?'); params.push(options.source); }
    if (options.unread) conditions.push('is_read = 0');
    if (options.minImportance !== undefined) { conditions.push('importance_score >= ?'); params.push(options.minImportance); }
    if (options.minRelevance !== undefined) { conditions.push('relevance_score >= ?'); params.push(options.minRelevance); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    // 同一轮采集的条目入库时间几乎相同，按入库时间排会变成随机顺序；优先用内容发布时间
    const order = options.sort === 'importance' ? 'importance_score DESC, COALESCE(published_at, collected_at) DESC' : 'COALESCE(published_at, collected_at) DESC';
    const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM information_items ${where}`).get(...params) as { count: number }).count);
    const rows = db.prepare(`SELECT * FROM information_items ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, options.pageSize, (options.page - 1) * options.pageSize) as unknown as Record<string, unknown>[];
    return { data: rows.map(mapRow), page: options.page, pageSize: options.pageSize, total, totalPages: Math.ceil(total / options.pageSize) };
  },
  findById(id: string) { const row = db.prepare('SELECT * FROM information_items WHERE id = ?').get(id) as unknown as Record<string, unknown> | undefined; return row ? mapRow(row) : undefined; },
  markRead(id: string) { return db.prepare('UPDATE information_items SET is_read = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id).changes > 0; },
  event(id: string) { const item = this.findById(id); if (!item) return undefined; const sources = (db.prepare('SELECT * FROM information_items WHERE event_key = ? ORDER BY collected_at DESC').all(item.eventKey) as unknown as Record<string, unknown>[]).map(mapRow); return { eventKey: item.eventKey, title: item.title, sources }; },
  updateAnalysis(id: string, analysis: { relevanceScore: number; importanceScore: number; summary: string; reason: string; provider: string }) { db.prepare('UPDATE information_items SET relevance_score = ?, importance_score = ?, ai_status = ?, analysis_summary = ?, analysis_reason = ?, updated_at = ? WHERE id = ?').run(analysis.relevanceScore, analysis.importanceScore, analysis.provider, analysis.summary, analysis.reason, new Date().toISOString(), id); return this.findById(id); },
  eventKeyFor
};
