import { db } from '../../db/client.js';

const tables = ['topics', 'keywords', 'information_items', 'information_snapshots', 'information_changes', 'information_feedback', 'collection_runs', 'source_health', 'analysis_calls', 'notification_channels', 'notification_deliveries'] as const;
type Backup = { format: 'signaldock-backup'; version: 1; exportedAt: string; tables: Record<string, unknown[]> };
const columns: Record<typeof tables[number], readonly string[]> = {
  topics: ['id', 'name', 'aliases_json', 'exclude_words_json', 'source_ids_json', 'frequency_minutes', 'notification_level', 'description', 'enabled', 'created_at', 'updated_at'],
  keywords: ['id', 'value', 'enabled', 'topic_id', 'created_at', 'updated_at'],
  information_items: ['id', 'source', 'source_name', 'keyword', 'title', 'summary', 'content', 'url', 'published_at', 'collected_at', 'fingerprint', 'dedupe_key', 'event_key', 'is_read', 'relevance_score', 'importance_score', 'ai_status', 'analysis_summary', 'analysis_reason', 'is_saved', 'is_archived', 'created_at', 'updated_at'],
  information_snapshots: ['id', 'item_id', 'title', 'content', 'fingerprint', 'captured_at'],
  information_changes: ['id', 'item_id', 'change_type', 'summary', 'created_at'],
  information_feedback: ['item_id', 'value', 'created_at', 'updated_at'],
  collection_runs: ['id', 'status', 'sources_json', 'started_at', 'finished_at', 'results', 'saved', 'changes', 'error'],
  source_health: ['source', 'attempts', 'successes', 'failures', 'total_duration_ms', 'last_success_at', 'last_failure_at', 'last_error', 'updated_at'],
  analysis_calls: ['id', 'item_id', 'provider', 'status', 'attempts', 'duration_ms', 'error', 'created_at'],
  notification_channels: ['id', 'name', 'type', 'endpoint', 'enabled', 'created_at', 'updated_at'],
  notification_deliveries: ['id', 'channel_id', 'status', 'response_code', 'error', 'created_at']
};

export const createBackup = (): Backup => ({
  format: 'signaldock-backup', version: 1, exportedAt: new Date().toISOString(),
  tables: Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]))
});

export const csvEscape = (value: unknown) => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const exportInformationCsv = () => {
  const rows = db.prepare('SELECT id, source_name AS sourceName, keyword, title, summary, analysis_summary AS analysisSummary, url, published_at AS publishedAt, collected_at AS collectedAt, importance_score AS importanceScore, relevance_score AS relevanceScore, is_read AS isRead, is_saved AS isSaved, is_archived AS isArchived FROM information_items ORDER BY collected_at DESC').all() as Array<Record<string, unknown>>;
  const columns = ['id', 'sourceName', 'keyword', 'title', 'summary', 'analysisSummary', 'url', 'publishedAt', 'collectedAt', 'importanceScore', 'relevanceScore', 'isRead', 'isSaved', 'isArchived'];
  return [columns.join(','), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))].join('\n');
};

const insertRows = (table: string, rows: unknown[]) => {
  if (!tables.includes(table as typeof tables[number])) throw new Error('备份包含未知数据表');
  const allowed = new Set(columns[table as typeof tables[number]]);
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('备份行格式无效');
    const row = raw as Record<string, unknown>;
    const rowColumns = Object.keys(row);
    if (rowColumns.some((column) => !allowed.has(column))) throw new Error(`备份数据表 ${table} 包含非法列`);
    if (!rowColumns.length) continue;
    const placeholders = rowColumns.map(() => '?').join(', ');
    db.prepare(`INSERT INTO ${table} (${rowColumns.join(', ')}) VALUES (${placeholders})`).run(...rowColumns.map((column) => {
      const value = row[column];
      if (value === undefined || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value ?? null;
      throw new Error('备份字段类型无效');
    }));
  }
};

export const restoreBackup = (input: unknown) => {
  const backup = input as Partial<Backup>;
  if (backup.format !== 'signaldock-backup' || backup.version !== 1 || !backup.tables || typeof backup.tables !== 'object' || Array.isArray(backup.tables)) throw new Error('备份文件格式无效');
  const available = new Set(tables);
  const totalRows = tables.reduce((count, table) => count + (Array.isArray(backup.tables?.[table]) ? backup.tables[table]?.length ?? 0 : 0), 0);
  if (totalRows > 20_000) throw new Error('备份数据量超过限制');
  for (const key of Object.keys(backup.tables)) if (!available.has(key as typeof tables[number])) throw new Error('备份包含未知数据表');
  db.exec('BEGIN');
  try {
    for (const table of [...tables].reverse()) db.exec(`DELETE FROM ${table}`);
    for (const table of tables) if (Array.isArray(backup.tables[table]) && available.has(table)) insertRows(table, backup.tables[table] ?? []);
    db.exec('DELETE FROM information_search');
    db.exec(`INSERT INTO information_search (item_id, title, summary, content, analysis_summary, keyword, source_name) SELECT id, title, summary, content, analysis_summary, keyword, source_name FROM information_items`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { restored: true, tables: Object.fromEntries(tables.map((table) => [table, Array.isArray(backup.tables?.[table]) ? backup.tables[table]?.length ?? 0 : 0])) };
};
