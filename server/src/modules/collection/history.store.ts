import { randomUUID } from 'node:crypto';
import { db } from '../../db/client.js';
import type { SearchResult } from './collection.types.js';
import { dedupeKeyFor } from './information.store.js';

export type ChangeType = 'new' | 'updated';
export type ChangeRecord = { id: string; itemId: string; changeType: ChangeType; summary: string; createdAt: string };

export const historyStore = {
  capture(results: SearchResult[]) {
    let snapshots = 0; let changes = 0;
    for (const item of results) {
      const row = db.prepare('SELECT id FROM information_items WHERE source = ? AND dedupe_key = ?').get(item.source, dedupeKeyFor(item)) as { id: string } | undefined;
      if (!row) continue;
      const previous = db.prepare('SELECT fingerprint FROM information_snapshots WHERE item_id = ? ORDER BY captured_at DESC LIMIT 1').get(row.id) as { fingerprint: string } | undefined;
      const timestamp = new Date().toISOString();
      db.prepare('INSERT INTO information_snapshots (id, item_id, title, content, fingerprint, captured_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), row.id, item.title, item.content, item.fingerprint, timestamp);
      snapshots += 1;
      if (!previous || previous.fingerprint !== item.fingerprint) {
        const changeType: ChangeType = previous ? 'updated' : 'new';
        db.prepare('INSERT INTO information_changes (id, item_id, change_type, summary, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), row.id, changeType, previous ? '标题或正文发生变化' : '首次发现这条信息', timestamp);
        changes += 1;
      }
    }
    return { snapshots, changes };
  },
  listChanges() { return db.prepare('SELECT id, item_id AS itemId, change_type AS changeType, summary, created_at AS createdAt FROM information_changes ORDER BY created_at DESC').all(); }
};
