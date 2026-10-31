import { db } from '../../db/client.js';

const tables = ['topics', 'keywords', 'information_items', 'information_snapshots', 'information_changes', 'information_feedback', 'collection_runs', 'source_health', 'analysis_calls', 'notification_channels', 'notification_deliveries'] as const;
type Backup = { format: 'signaldock-backup'; version: 1; exportedAt: string; tables: Record<string, unknown[]> };

export const createBackup = (): Backup => ({
  format: 'signaldock-backup', version: 1, exportedAt: new Date().toISOString(),
  tables: Object.fromEntries(tables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]))
});

const csvEscape = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const exportInformationCsv = () => {
  const rows = db.prepare('SELECT id, source_name AS sourceName, keyword, title, summary, analysis_summary AS analysisSummary, url, published_at AS publishedAt, collected_at AS collectedAt, importance_score AS importanceScore, relevance_score AS relevanceScore, is_read AS isRead, is_saved AS isSaved, is_archived AS isArchived FROM information_items ORDER BY collected_at DESC').all() as Array<Record<string, unknown>>;
  const columns = ['id', 'sourceName', 'keyword', 'title', 'summary', 'analysisSummary', 'url', 'publishedAt', 'collectedAt', 'importanceScore', 'relevanceScore', 'isRead', 'isSaved', 'isArchived'];
  return [columns.join(','), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))].join('\n');
};

const insertRows = (table: string, rows: unknown[]) => {
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const columns = Object.keys(row).filter((column) => !column.startsWith('_'));
    if (!columns.length) continue;
    const placeholders = columns.map(() => '?').join(', ');
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...columns.map((column) => { const value = row[column]; return value === undefined || value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? value ?? null : JSON.stringify(value); }));
  }
};

export const restoreBackup = (input: unknown) => {
  const backup = input as Partial<Backup>;
  if (backup.format !== 'signaldock-backup' || backup.version !== 1 || !backup.tables || typeof backup.tables !== 'object') throw new Error('备份文件格式无效');
  const available = new Set(tables);
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
