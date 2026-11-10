import type { DatabaseSync } from 'node:sqlite';

export const collectionRunsSchema = `CREATE TABLE IF NOT EXISTS collection_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, sources_json TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, results INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0, changes INTEGER NOT NULL DEFAULT 0, error TEXT, legacy_payload_json TEXT NOT NULL DEFAULT '');`;

// The alternative deployed version stores complete collection payloads in a different schema.
// Convert before creating indexes that depend on the current started_at column.
export function migrateLegacyCollectionRuns(database: DatabaseSync) {
  const columns = database.prepare('PRAGMA table_info(collection_runs)').all() as { name: string }[];
  if (!columns.some(column => column.name === 'payload_json') || columns.some(column => column.name === 'started_at')) return;
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('ALTER TABLE collection_runs RENAME TO collection_runs_before_workflow');
    database.exec(collectionRunsSchema);
    const rows = database.prepare('SELECT id, created_at, payload_json FROM collection_runs_before_workflow').all() as { id: string; created_at: string; payload_json: string }[];
    const insert = database.prepare('INSERT INTO collection_runs (id, status, sources_json, started_at, finished_at, results, saved, changes, error, legacy_payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    for (const row of rows) {
      let payload: { errors?: unknown[]; stats?: { results?: number; bySource?: Record<string, number> }; persistence?: { saved?: number; changes?: number }; data?: { source?: string }[] } | undefined;
      try { payload = JSON.parse(row.payload_json); } catch { /* Preserve the original payload even when invalid. */ }
      const sources = payload?.stats?.bySource && typeof payload.stats.bySource === 'object' ? Object.keys(payload.stats.bySource) : Array.isArray(payload?.data) ? [...new Set(payload.data.map(item => item?.source).filter((source): source is string => typeof source === 'string'))] : [];
      insert.run(row.id, !payload ? 'failed' : payload.errors?.length ? 'partial' : 'completed', JSON.stringify(sources), row.created_at, row.created_at, count(payload?.stats?.results), count(payload?.persistence?.saved), count(payload?.persistence?.changes), payload ? null : '旧采集记录未能解析，原始内容已保留', row.payload_json);
    }
    database.exec('DROP TABLE collection_runs_before_workflow; COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
