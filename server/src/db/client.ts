import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from '../config/env.js';

type TopicRow = { id: string; name: string; aliases_json: string; exclude_words_json: string; source_ids_json: string; frequency_minutes: number; notification_level: string; description: string; enabled: number; created_at: string; updated_at: string };
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
  CREATE TABLE IF NOT EXISTS information_feedback (item_id TEXT PRIMARY KEY REFERENCES information_items(id) ON DELETE CASCADE, value TEXT NOT NULL CHECK(value IN ('helpful', 'irrelevant', 'duplicate')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS collection_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, sources_json TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, results INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0, changes INTEGER NOT NULL DEFAULT 0, error TEXT);
  CREATE INDEX IF NOT EXISTS collection_runs_started_idx ON collection_runs(started_at DESC);
  CREATE TABLE IF NOT EXISTS source_health (source TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, total_duration_ms INTEGER NOT NULL DEFAULT 0, last_success_at TEXT, last_failure_at TEXT, last_error TEXT, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS analysis_calls (id TEXT PRIMARY KEY, item_id TEXT, provider TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, duration_ms INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS analysis_calls_created_idx ON analysis_calls(created_at DESC);
  CREATE TABLE IF NOT EXISTS notification_channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, endpoint TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notification_deliveries (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE, status TEXT NOT NULL, response_code INTEGER, error TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS notification_deliveries_created_idx ON notification_deliveries(created_at DESC);
  CREATE TABLE IF NOT EXISTS auth_sessions (nonce TEXT PRIMARY KEY, username TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS editorial_briefs (id TEXT PRIMARY KEY, generation_key TEXT NOT NULL, document_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS editorial_briefs_generation_idx ON editorial_briefs(generation_key);
  CREATE TABLE IF NOT EXISTS generation_usage (day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
`);

const ensureColumn = (table: string, column: string, definition: string) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};

ensureColumn('information_items', 'is_saved', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('information_items', 'is_archived', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('topics', 'source_ids_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('topics', 'frequency_minutes', 'INTEGER NOT NULL DEFAULT 120');
ensureColumn('topics', 'notification_level', "TEXT NOT NULL DEFAULT 'important'");
ensureColumn('topics', 'description', "TEXT NOT NULL DEFAULT ''");
db.exec('CREATE INDEX IF NOT EXISTS information_saved_idx ON information_items(is_saved, is_archived, collected_at);');
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS information_search USING fts5(item_id UNINDEXED, title, summary, content, analysis_summary, keyword, source_name);`);
db.exec(`DELETE FROM information_search;
  INSERT INTO information_search (item_id, title, summary, content, analysis_summary, keyword, source_name)
  SELECT id, title, summary, content, analysis_summary, keyword, source_name FROM information_items;`);

const now = () => new Date().toISOString();
const parseList = (value: string) => JSON.parse(value) as string[];
const readKeywords = (topicId: string) => db.prepare('SELECT * FROM keywords WHERE topic_id = ? ORDER BY created_at ASC').all(topicId) as unknown as KeywordRow[];
const serializeKeyword = (keyword: KeywordRow) => ({ id: keyword.id, value: keyword.value, enabled: Boolean(keyword.enabled), createdAt: keyword.created_at, updatedAt: keyword.updated_at });
const parseJsonList = (value: string | undefined) => {
  try { return value ? parseList(value) : []; } catch { return []; }
};
const serializeTopic = (row: TopicRow) => ({ id: row.id, name: row.name, aliases: parseJsonList(row.aliases_json), excludeWords: parseJsonList(row.exclude_words_json), sourceIds: parseJsonList(row.source_ids_json), frequencyMinutes: Number(row.frequency_minutes ?? 120), notificationLevel: (row.notification_level === 'all' || row.notification_level === 'none' ? row.notification_level : 'important') as 'all' | 'important' | 'none', description: row.description ?? '', enabled: Boolean(row.enabled), createdAt: row.created_at, updatedAt: row.updated_at, keywords: readKeywords(row.id).map(serializeKeyword) });

export const topicStore = {
  list() { return (db.prepare('SELECT * FROM topics ORDER BY created_at DESC').all() as unknown as TopicRow[]).map(serializeTopic); },
  create(input: { name: string; aliases: string[]; excludeWords: string[]; sourceIds?: string[]; frequencyMinutes?: number; notificationLevel?: string; description?: string; enabled: boolean }) { const id = randomUUID(); const timestamp = now(); db.prepare('INSERT INTO topics (id, name, aliases_json, exclude_words_json, source_ids_json, frequency_minutes, notification_level, description, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, input.name, JSON.stringify(input.aliases), JSON.stringify(input.excludeWords), JSON.stringify(input.sourceIds ?? []), input.frequencyMinutes ?? 120, input.notificationLevel ?? 'important', input.description ?? '', input.enabled ? 1 : 0, timestamp, timestamp); return serializeTopic(db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as unknown as TopicRow); },
  update(id: string, input: { name?: string; aliases?: string[]; excludeWords?: string[]; sourceIds?: string[]; frequencyMinutes?: number; notificationLevel?: string; description?: string; enabled?: boolean }) { const current = db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as unknown as TopicRow | undefined; if (!current) return undefined; const timestamp = now(); db.prepare('UPDATE topics SET name = ?, aliases_json = ?, exclude_words_json = ?, source_ids_json = ?, frequency_minutes = ?, notification_level = ?, description = ?, enabled = ?, updated_at = ? WHERE id = ?').run(input.name ?? current.name, JSON.stringify(input.aliases ?? parseJsonList(current.aliases_json)), JSON.stringify(input.excludeWords ?? parseJsonList(current.exclude_words_json)), JSON.stringify(input.sourceIds ?? parseJsonList(current.source_ids_json)), input.frequencyMinutes ?? current.frequency_minutes, input.notificationLevel ?? current.notification_level, input.description ?? current.description, input.enabled === undefined ? current.enabled : (input.enabled ? 1 : 0), timestamp, id); return serializeTopic(db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as unknown as TopicRow); },
  delete(id: string) { return db.prepare('DELETE FROM topics WHERE id = ?').run(id).changes > 0; },
  addKeyword(topicId: string, input: { value: string; enabled: boolean }) { if (!db.prepare('SELECT id FROM topics WHERE id = ?').get(topicId)) return undefined; const id = randomUUID(); const timestamp = now(); db.prepare('INSERT INTO keywords (id, value, enabled, topic_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, input.value, input.enabled ? 1 : 0, topicId, timestamp, timestamp); return serializeKeyword(db.prepare('SELECT * FROM keywords WHERE id = ?').get(id) as unknown as KeywordRow); },
  updateKeyword(topicId: string, id: string, input: { value?: string; enabled?: boolean }) { const current = db.prepare('SELECT * FROM keywords WHERE id = ? AND topic_id = ?').get(id, topicId) as unknown as KeywordRow | undefined; if (!current) return undefined; const timestamp = now(); db.prepare('UPDATE keywords SET value = ?, enabled = ?, updated_at = ? WHERE id = ? AND topic_id = ?').run(input.value ?? current.value, input.enabled === undefined ? current.enabled : (input.enabled ? 1 : 0), timestamp, id, topicId); return serializeKeyword(db.prepare('SELECT * FROM keywords WHERE id = ?').get(id) as unknown as KeywordRow); },
  deleteKeyword(topicId: string, id: string) { return db.prepare('DELETE FROM keywords WHERE id = ? AND topic_id = ?').run(id, topicId).changes > 0; }
};

export const analysisCallStore = {
  record(input: { itemId?: string; provider: string; status: string; attempts: number; durationMs: number; error?: string }) {
    db.prepare('INSERT INTO analysis_calls (id, item_id, provider, status, attempts, duration_ms, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), input.itemId ?? null, input.provider, input.status, input.attempts, input.durationMs, input.error ?? null, now());
  },
  list(limit = 50) { return db.prepare('SELECT id, item_id AS itemId, provider, status, attempts, duration_ms AS durationMs, error, created_at AS createdAt FROM analysis_calls ORDER BY created_at DESC LIMIT ?').all(Math.min(200, Math.max(1, limit))); }
};

export type NotificationChannelType = 'feishu' | 'wecom' | 'dingtalk' | 'webhook';
type NotificationChannel = { id: string; name: string; type: NotificationChannelType; endpoint: string; enabled: boolean; createdAt: string; updatedAt: string };
export const notificationChannelStore = {
  list(): NotificationChannel[] { return db.prepare('SELECT id, name, type, endpoint, enabled, created_at AS createdAt, updated_at AS updatedAt FROM notification_channels ORDER BY created_at DESC').all().map((row) => { const item = row as Record<string, unknown>; return { id: String(item.id), name: String(item.name), type: String(item.type) as NotificationChannelType, endpoint: String(item.endpoint), enabled: Boolean(item.enabled), createdAt: String(item.createdAt), updatedAt: String(item.updatedAt) }; }); },
  create(input: { name: string; type: NotificationChannelType; endpoint: string; enabled?: boolean }): NotificationChannel | undefined { const id = randomUUID(); const timestamp = now(); db.prepare('INSERT INTO notification_channels (id, name, type, endpoint, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, input.name, input.type, input.endpoint, input.enabled === false ? 0 : 1, timestamp, timestamp); return this.findById(id); },
  findById(id: string): NotificationChannel | undefined { const row = db.prepare('SELECT id, name, type, endpoint, enabled, created_at AS createdAt, updated_at AS updatedAt FROM notification_channels WHERE id = ?').get(id) as Record<string, unknown> | undefined; return row ? { id: String(row.id), name: String(row.name), type: String(row.type) as NotificationChannelType, endpoint: String(row.endpoint), enabled: Boolean(row.enabled), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt) } : undefined; },
  update(id: string, input: { name?: string; type?: NotificationChannelType; endpoint?: string; enabled?: boolean }) { const current = this.findById(id); if (!current) return undefined; const timestamp = now(); db.prepare('UPDATE notification_channels SET name = ?, type = ?, endpoint = ?, enabled = ?, updated_at = ? WHERE id = ?').run(input.name ?? current.name, input.type ?? current.type, input.endpoint ?? current.endpoint, input.enabled === undefined ? (current.enabled ? 1 : 0) : (input.enabled ? 1 : 0), timestamp, id); return this.findById(id); },
  delete(id: string) { return db.prepare('DELETE FROM notification_channels WHERE id = ?').run(id).changes > 0; },
  recordDelivery(input: { channelId: string; status: string; responseCode?: number; error?: string }) { db.prepare('INSERT INTO notification_deliveries (id, channel_id, status, response_code, error, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), input.channelId, input.status, input.responseCode ?? null, input.error ?? null, now()); },
  deliveries(limit = 50) { return db.prepare('SELECT id, channel_id AS channelId, status, response_code AS responseCode, error, created_at AS createdAt FROM notification_deliveries ORDER BY created_at DESC LIMIT ?').all(Math.min(200, Math.max(1, limit))); }
};

export const isConstraintError = (error: unknown) => error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
