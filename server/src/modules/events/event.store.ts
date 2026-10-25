import { db } from '../../db/client.js';

type EventRow = {
  event_key: string;
  title: string;
  first_seen_at: string;
  last_seen_at: string;
  source_count: number;
  item_count: number;
  unread_count: number;
  importance_score: number;
  relevance_score: number;
};

const eventRow = (row: EventRow) => ({
  eventKey: row.event_key,
  title: row.title,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  sourceCount: Number(row.source_count),
  itemCount: Number(row.item_count),
  unreadCount: Number(row.unread_count),
  importanceScore: Number(row.importance_score),
  relevanceScore: Number(row.relevance_score)
});

const eventQuery = `
  SELECT event_key,
    MAX(title) AS title,
    MIN(collected_at) AS first_seen_at,
    MAX(collected_at) AS last_seen_at,
    COUNT(DISTINCT source) AS source_count,
    COUNT(*) AS item_count,
    SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread_count,
    MAX(importance_score) AS importance_score,
    MAX(relevance_score) AS relevance_score
  FROM information_items
`;

export const eventStore = {
  list(options: { page: number; pageSize: number; unread?: boolean } = { page: 1, pageSize: 20 }) {
    const conditions = options.unread ? ' WHERE is_read = 0' : '';
    const total = Number((db.prepare(`SELECT COUNT(DISTINCT event_key) AS count FROM information_items${conditions}`).get() as { count: number }).count);
    const rows = db.prepare(`${eventQuery}${conditions} GROUP BY event_key ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`).all(options.pageSize, (options.page - 1) * options.pageSize) as unknown as EventRow[];
    return { data: rows.map(eventRow), page: options.page, pageSize: options.pageSize, total, totalPages: Math.ceil(total / options.pageSize) };
  },

  findByKey(eventKey: string) {
    const row = db.prepare(`${eventQuery} WHERE event_key = ? GROUP BY event_key`).get(eventKey) as unknown as EventRow | undefined;
    if (!row) return undefined;
    return eventRow(row);
  },

  evidence(eventKey: string) {
    return db.prepare(`
      SELECT id, source, source_name AS sourceName, title, summary, content, url,
        published_at AS publishedAt, collected_at AS collectedAt,
        importance_score AS importanceScore, relevance_score AS relevanceScore
      FROM information_items WHERE event_key = ? ORDER BY collected_at DESC
    `).all(eventKey);
  },

  changes(eventKey: string) {
    return db.prepare(`
      SELECT changes.id, changes.item_id AS itemId, changes.change_type AS changeType,
        changes.summary, changes.created_at AS createdAt
      FROM information_changes AS changes
      JOIN information_items AS items ON items.id = changes.item_id
      WHERE items.event_key = ? ORDER BY changes.created_at DESC
    `).all(eventKey);
  },

  detail(eventKey: string) {
    const event = this.findByKey(eventKey);
    if (!event) return undefined;
    return { ...event, evidence: this.evidence(eventKey), changes: this.changes(eventKey) };
  }
};
