import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrateLegacyCollectionRuns, collectionRunsSchema } from '../db/migrations.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('deployed legacy database migration', () => {
  it('preserves IDs, timestamps, statistics and complete source payloads, and allows new runs', () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      legacy.exec('CREATE TABLE collection_runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload_json TEXT NOT NULL)');
      const payload = JSON.stringify({ stats: { results: 3, bySource: { rss: 2, hackernews: 1 } }, persistence: { saved: 2, changes: 1 }, errors: [] });
      legacy.prepare('INSERT INTO collection_runs VALUES (?, ?, ?)').run('old', '2026-11-10T00:00:00Z', payload);
      legacy.prepare('INSERT INTO collection_runs VALUES (?, ?, ?)').run('broken', '2026-11-09T00:00:00Z', '{invalid');
      migrateLegacyCollectionRuns(legacy);
      expect(legacy.prepare('SELECT * FROM collection_runs WHERE id = ?').get('old')).toMatchObject({ status: 'completed', started_at: '2026-11-10T00:00:00Z', results: 3, saved: 2, changes: 1, legacy_payload_json: payload });
      expect(legacy.prepare('SELECT * FROM collection_runs WHERE id = ?').get('broken')).toMatchObject({ status: 'failed', legacy_payload_json: '{invalid' });
      legacy.prepare('INSERT INTO collection_runs (id, status, sources_json, started_at) VALUES (?, ?, ?, ?)').run('new', 'running', '[]', '2026-11-10T00:00:00Z');
      migrateLegacyCollectionRuns(legacy);
      expect(legacy.prepare('SELECT COUNT(*) AS total FROM collection_runs').get()).toMatchObject({ total: 3 });
    } finally { legacy.close(); }
  });
  it('leaves an empty or current database intact', () => {
    const current = new DatabaseSync(':memory:');
    try {
      migrateLegacyCollectionRuns(current); current.exec(collectionRunsSchema); migrateLegacyCollectionRuns(current);
      expect(current.prepare('SELECT COUNT(*) AS total FROM collection_runs').get()).toMatchObject({ total: 0 });
    } finally { current.close(); }
  });
  it('boots the complete current database module against the legacy deployment layout', () => {
    const directory = mkdtempSync(resolve('prisma', 'migration-check-'));
    const file = resolve(directory, 'legacy.db');
    const legacy = new DatabaseSync(file);
    legacy.exec("CREATE TABLE collection_runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload_json TEXT NOT NULL); INSERT INTO collection_runs VALUES ('legacy-run', '2026-11-10T00:00:00Z', '{\"stats\":{\"results\":5}}');");
    legacy.close();
    try {
      const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import { db } from './src/db/client.ts'; const run=db.prepare('SELECT status, results, legacy_payload_json FROM collection_runs WHERE id=?').get('legacy-run'); console.log(JSON.stringify(run)); db.close();"], { encoding: 'utf8', env: { ...process.env, DATABASE_URL: `file:${file.replaceAll('\\', '/')}`, ADMIN_PASSWORD: 'test-only-migration-password.' } });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'completed', results: 5 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
