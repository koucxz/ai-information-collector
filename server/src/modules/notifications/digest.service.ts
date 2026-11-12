import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';

export type DigestPeriod = 'daily' | 'weekly';
type DigestRow = { id: string; title: string; source_name: string; url: string; importance_score: number; analysis_summary: string; is_read: number; collected_at: string };
type MailTransport = { sendMail(options: { from: string; to: string; subject: string; text: string }): Promise<unknown> };

export const buildDigest = (period: DigestPeriod, now = new Date()) => {
  const duration = period === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const since = new Date(now.getTime() - duration).toISOString();
  // 只做聚合与 Top10 查询，不再把区间内所有正文读进内存（正文可达数 KB/条）
  const totals = db.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END), 0) AS unread
    FROM information_items WHERE collected_at >= ?`).get(since) as { total: number; unread: number };
  const changeCount = Number((db.prepare('SELECT COUNT(*) AS count FROM information_changes WHERE created_at >= ?').get(since) as { count: number }).count);
  const sourceRows = db.prepare('SELECT source_name, COUNT(*) AS count FROM information_items WHERE collected_at >= ? GROUP BY source_name').all(since) as Array<{ source_name: string; count: number }>;
  const sourceCounts = sourceRows.reduce<Record<string, number>>((counts, row) => { counts[row.source_name] = Number(row.count); return counts; }, {});
  const rows = db.prepare(`SELECT id, title, source_name, url, importance_score,
    substr(analysis_summary, 1, 400) AS analysis_summary, is_read, collected_at
    FROM information_items WHERE collected_at >= ?
    ORDER BY importance_score DESC, collected_at DESC LIMIT 10`).all(since) as unknown as DigestRow[];
  const title = period === 'daily' ? 'SignalDock 每日信息摘要' : 'SignalDock 每周信息摘要';
  const topItems = rows.map((item) => ({ id: item.id, title: item.title, sourceName: item.source_name, url: item.url, importanceScore: item.importance_score, summary: item.analysis_summary, collectedAt: item.collected_at }));
  const total = Number(totals.total);
  const unread = Number(totals.unread);
  const lines = [title, `统计区间：${since} 至 ${now.toISOString()}`, `新增信息：${total} 条；变化：${changeCount} 条；未读：${unread} 条。`];
  if (Object.keys(sourceCounts).length) lines.push(`来源：${Object.entries(sourceCounts).map(([source, count]) => `${source} ${count} 条`).join('，')}`);
  if (topItems.length) lines.push('', '重点信息：', ...topItems.map((item, index) => `${index + 1}. ${item.title}（${item.sourceName}，重要度 ${Math.round(item.importanceScore * 100)}%）\n${item.summary || item.url}`));
  else lines.push('', '本周期没有新信息。');
  return { period, title, since, until: now.toISOString(), total, unread, changes: changeCount, sourceCounts, topItems, text: lines.join('\n') };
};

export const sendDigest = async (period: DigestPeriod, options: { transport?: MailTransport; recipient?: string; now?: Date } = {}) => {
  const digest = buildDigest(period, options.now);
  const recipient = options.recipient ?? env.NOTIFY_EMAIL;
  if (!recipient) return { sent: false, reason: '未配置 NOTIFY_EMAIL', digest };
  let transport = options.transport;
  if (!transport) {
    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return { sent: false, reason: 'SMTP 配置不完整', digest };
    transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } });
  }
  await transport.sendMail({ from: env.SMTP_FROM || env.SMTP_USER || 'SignalDock', to: recipient, subject: digest.title, text: digest.text });
  return { sent: true, digest };
};

