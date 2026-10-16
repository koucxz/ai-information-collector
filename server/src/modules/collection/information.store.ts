import { createHash, randomUUID } from 'node:crypto';
import { db } from '../../db/client.js';
import type { SearchResult } from './collection.types.js';
import { normalizeUrl } from './normalize.js';

export type StoredInformation = SearchResult & { id: string; eventKey: string; isRead: boolean; relevanceScore: number; importanceScore: number; aiStatus: string; analysisSummary: string; analysisReason: string };

const eventKeyFor = (title: string) => createHash('sha256').update(title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).digest('hex').slice(0, 24);
const mapRow = (row: Record<string, unknown>): StoredInformation => ({ source: String(row.source), sourceName: String(row.source_name), keyword: String(row.keyword), title: String(row.title), summary: String(row.summary), content: String(row.content), url: String(row.url), publishedAt: row.published_at ? String(row.published_at) : null, collectedAt: String(row.collected_at), fingerprint: String(row.fingerprint), id: String(row.id), eventKey: String(row.event_key), isRead: Boolean(row.is_read), relevanceScore: Number(row.relevance_score), importanceScore: Number(row.importance_score), aiStatus: String(row.ai_status), analysisSummary: String(row.analysis_summary), analysisReason: String(row.analysis_reason) });

export const informationStore = {
  saveResults(results: SearchResult[]) {
    const insert = db.prepare('INSERT OR IGNORE INTO information_items (id, source, source_name, keyword, title, summary, content, url, published_at, collected_at, fingerprint, dedupe_key, event_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    let saved = 0;
    for (const item of results) {
      const timestamp = new Date().toISOString();
      const normalizedUrl = normalizeUrl(item.url);
      const dedupeKey = normalizedUrl ? `url:${normalizedUrl}` : `fingerprint:${item.fingerprint}`;
      const result = insert.run(randomUUID(), item.source, item.sourceName, item.keyword, item.title, item.summary, item.content, normalizedUrl, item.publishedAt, item.collectedAt, item.fingerprint, dedupeKey, eventKeyFor(item.title), timestamp, timestamp);
      saved += Number(result.changes);
    }
    return { saved, duplicates: results.length - saved };
  },
  list() { return (db.prepare('SELECT * FROM information_items ORDER BY collected_at DESC').all() as unknown as Record<string, unknown>[]).map(mapRow); },
  findById(id: string) { const row = db.prepare('SELECT * FROM information_items WHERE id = ?').get(id) as unknown as Record<string, unknown> | undefined; return row ? mapRow(row) : undefined; },
  eventKeyFor
};
