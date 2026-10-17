import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.js';

type TopicRow = { id: string; name: string; aliases_json: string; exclude_words_json: string; enabled: number; created_at: string; updated_at: string };
type KeywordRow = { id: string; value: string; enabled: number; topic_id: string; created_at: string; updated_at: string };

const filePath = env.DATABASE_URL.startsWith('file:') ? env.DATABASE_URL.slice(5) : env.DATABASE_URL;
const databasePath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, aliases_json TEXT NOT NULL DEFAULT '[]', exclude_words_json TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS keywords (id TEXT PRIMARY KEY, value TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(topic_id, value));
  CREATE INDEX IF NOT EXISTS keywords_topic_enabled_idx ON keywords(topic_id, enabled);
  CREATE TABLE IF NOT EXISTS information_items (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_name TEXT NOT NULL, keyword TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', published_at TEXT, collected_at TEXT NOT NULL, fingerprint TEXT NOT NULL, dedupe_key TEXT NOT NULL, event_key TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, relevance_score REAL NOT NULL DEFAULT 0, importance_score REAL NOT NULL DEFAULT 0, ai_status TEXT NOT NULL DEFAULT 'pending', analysis_summary TEXT NOT NULL DEFAULT '', analysis_reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(source, dedupe_key));
  CREATE INDEX IF NOT EXISTS information_event_idx ON information_items(event_key);
  CREATE INDEX IF NOT EXISTS information_collected_idx ON information_items(collected_at);
  CREATE TABLE IF NOT EXISTS information_snapshots (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES information_items(id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT NOT NULL, fingerprint TEXT NOT NULL, captured_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS information_snapshot_item_idx ON information_snapshots(item_id, captured_at);
  CREATE TABLE IF NOT EXISTS information_changes (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES information_items(id) ON DELETE CASCADE, change_type TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS information_change_item_idx ON information_changes(item_id, created_at);
`);

const now = () => new Date().toISOString();
const parseList = (value: string) => JSON.parse(value) as string[];
const readKeywords = (topicId: string) => db.prepare('SELECT * FROM keywords WHERE topic_id = ? ORDER BY created_at ASC').all(topicId) as unknown as KeywordRow[];
const serializeKeyword = (keyword: KeywordRow) => ({ id: keyword.id, value: keyword.value, enabled: Boolean(keyword.enabled), createdAt: keyword.created_at, updatedAt: keyword.updated_at });
const serializeTopic = (row: TopicRow) => ({ id: row.id, name: row.name, aliases: parseList(row.aliases_json), excludeWords: parseList(row.exclude_words_json), enabled: Boolean(row.enabled), createdAt: row.created_at, updatedAt: row.updated_at, keywords: readKeywords(row.id).map(serializeKeyword) });

export const topicStore = {
  list() { return (db.prepare('SELECT * FROM topics ORDER BY created_at DESC').all() as unknown as TopicRow[]).map(serializeTopic); },
  create(input: { name: string; aliases: string[]; excludeWords: string[]; enabled: boolean }) { const id = randomUUID(); const timestamp = now(); db.prepare('INSERT INTO topics (id, name, aliases_json, exclude_words_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, input.name, JSON.stringify(input.aliases), JSON.stringify(input.excludeWords), input.enabled ? 1 : 0, timestamp, timestamp); return serializeTopic(db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as unknown as TopicRow); },
  update(id: string, input: { name?: string; aliases?: string[]; excludeWords?: string[]; enabled?: boolean }) { const current = db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as unknown as TopicRow | undefined; if (!current) return undefined; const timestamp = now(); db.prepare('UPDATE topics SET name = ?, aliases_json = ?, exclude_words_json = ?, enabled = ?, updated_at = ? WHERE id = ?').run(input.name ?? current.name, JSON.stringify(input.aliases ?? parseList(current.aliases_json)), JSON.stringify(input.excludeWords ?? parseList(current.exclude_words_json)), input.enabled === undefined ? current.enabled : (input.enabled ? 1 : 0), timestamp, id); return serializeTopic(db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as unknown as TopicRow); },
  delete(id: string) { return db.prepare('DELETE FROM topics WHERE id = ?').run(id).changes > 0; },
  addKeyword(topicId: string, input: { value: string; enabled: boolean }) { if (!db.prepare('SELECT id FROM topics WHERE id = ?').get(topicId)) return undefined; const id = randomUUID(); const timestamp = now(); db.prepare('INSERT INTO keywords (id, value, enabled, topic_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, input.value, input.enabled ? 1 : 0, topicId, timestamp, timestamp); return serializeKeyword(db.prepare('SELECT * FROM keywords WHERE id = ?').get(id) as unknown as KeywordRow); },
  updateKeyword(topicId: string, id: string, input: { value?: string; enabled?: boolean }) { const current = db.prepare('SELECT * FROM keywords WHERE id = ? AND topic_id = ?').get(id, topicId) as unknown as KeywordRow | undefined; if (!current) return undefined; const timestamp = now(); db.prepare('UPDATE keywords SET value = ?, enabled = ?, updated_at = ? WHERE id = ? AND topic_id = ?').run(input.value ?? current.value, input.enabled === undefined ? current.enabled : (input.enabled ? 1 : 0), timestamp, id, topicId); return serializeKeyword(db.prepare('SELECT * FROM keywords WHERE id = ?').get(id) as unknown as KeywordRow); },
  deleteKeyword(topicId: string, id: string) { return db.prepare('DELETE FROM keywords WHERE id = ? AND topic_id = ?').run(id, topicId).changes > 0; }
};

export const isConstraintError = (error: unknown) => error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
