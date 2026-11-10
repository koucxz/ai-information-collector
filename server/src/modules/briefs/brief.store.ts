import { randomUUID } from 'node:crypto';
import { db } from '../../db/client.js';
import type { Brief, BriefDocument } from './brief.schemas.js';

type Row = { id: string; document_json: string; version: number; created_at: string; updated_at: string };
const serialize = (row: Row): Brief => ({ ...JSON.parse(row.document_json) as BriefDocument, id: row.id, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at });
export const briefStore = {
  list() { return (db.prepare('SELECT * FROM editorial_briefs ORDER BY created_at DESC, id').all() as unknown as Row[]).map(serialize); },
  find(id: string) { const row = db.prepare('SELECT * FROM editorial_briefs WHERE id = ?').get(id) as Row | undefined; return row ? serialize(row) : undefined; },
  byGeneration(key: string) { return (db.prepare('SELECT * FROM editorial_briefs WHERE generation_key = ? ORDER BY created_at, id').all(key) as unknown as Row[]).map(serialize); },
  createMany(key: string, documents: BriefDocument[]) {
    const timestamp = new Date().toISOString();
    db.exec('BEGIN');
    try {
      for (const doc of documents) db.prepare('INSERT INTO editorial_briefs (id, generation_key, document_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), key, JSON.stringify(doc), timestamp, timestamp);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return this.byGeneration(key);
  },
  update(id: string, version: number, document: BriefDocument) {
    const result = db.prepare('UPDATE editorial_briefs SET document_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').run(JSON.stringify(document), new Date().toISOString(), id, version);
    return result.changes ? this.find(id) : undefined;
  }
};
