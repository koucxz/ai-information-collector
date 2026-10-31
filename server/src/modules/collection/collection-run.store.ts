import { randomUUID } from 'node:crypto';
import { db } from '../../db/client.js';
import type { CollectionResponse } from './collector.service.js';

export type CollectionRunStatus = 'running' | 'completed' | 'partial' | 'failed';

export const collectionRunStore = {
  start(sources: string[]) {
    const id = randomUUID();
    db.prepare('INSERT INTO collection_runs (id, status, sources_json, started_at) VALUES (?, ?, ?, ?)').run(id, 'running', JSON.stringify(sources), new Date().toISOString());
    return id;
  },
  complete(id: string, result: CollectionResponse & { persistence: { saved: number; changes: number } }) {
    const status: CollectionRunStatus = result.errors.length ? 'partial' : 'completed';
    db.prepare('UPDATE collection_runs SET status = ?, finished_at = ?, results = ?, saved = ?, changes = ? WHERE id = ?').run(status, new Date().toISOString(), result.stats.results, result.persistence.saved, result.persistence.changes, id);
    for (const stat of result.sourceStats) {
      const timestamp = new Date().toISOString();
      db.prepare(`INSERT INTO source_health (source, attempts, successes, failures, total_duration_ms, last_success_at, last_failure_at, last_error, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET attempts = attempts + excluded.attempts, successes = successes + excluded.successes, failures = failures + excluded.failures, total_duration_ms = total_duration_ms + excluded.total_duration_ms, last_success_at = COALESCE(excluded.last_success_at, source_health.last_success_at), last_failure_at = COALESCE(excluded.last_failure_at, source_health.last_failure_at), last_error = COALESCE(excluded.last_error, source_health.last_error), updated_at = excluded.updated_at`).run(stat.source, stat.attempts, stat.successes, stat.failures, stat.durationMs, stat.successes ? timestamp : null, stat.failures ? timestamp : null, stat.lastError ?? null, timestamp);
    }
  },
  fail(id: string, error: string) { db.prepare('UPDATE collection_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?').run('failed', new Date().toISOString(), error, id); },
  list(limit = 30) {
    return db.prepare('SELECT id, status, sources_json AS sourcesJson, started_at AS startedAt, finished_at AS finishedAt, results, saved, changes, error FROM collection_runs ORDER BY started_at DESC LIMIT ?').all(limit).map((row) => ({ ...row as Record<string, unknown>, sources: JSON.parse(String((row as { sourcesJson: string }).sourcesJson)) }));
  },
  health() {
    return db.prepare(`SELECT source, attempts, successes, failures, total_duration_ms AS totalDurationMs, last_success_at AS lastSuccessAt, last_failure_at AS lastFailureAt, last_error AS lastError, updated_at AS updatedAt FROM source_health ORDER BY source`).all().map((row) => {
      const item = row as Record<string, unknown>;
      const attempts = Number(item.attempts);
      return { ...item, successRate: attempts ? Number(item.successes) / attempts : 0, averageDurationMs: attempts ? Number(item.totalDurationMs) / attempts : 0 };
    });
  }
};
