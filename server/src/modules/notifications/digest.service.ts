import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';

export type DigestPeriod = 'daily' | 'weekly';
type DigestRow = { id: string; title: string; source_name: string; url: string; importance_score: number; analysis_summary: string; is_read: number; collected_at: string };
type MailTransport = { sendMail(options: { from: string; to: string; subject: string; text: string }): Promise<unknown> };

export const buildDigest = (period: DigestPeriod, now = new Date()) => {
  const duration = period === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  const since = new Date(now.getTime() - duration).toISOString();
  const items = db.prepare('SELECT id, title, source_name, url, importance_score, analysis_summary, is_read, collected_at FROM information_items WHERE collected_at >= ? ORDER BY importance_score DESC, collected_at DESC').all(since) as unknown as DigestRow[];
  const changeCount = Number((db.prepare('SELECT COUNT(*) AS count FROM information_changes WHERE created_at >= ?').get(since) as { count: number }).count);
  const sourceCounts = items.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.source_name]: (counts[item.source_name] ?? 0) + 1 }), {});
  const title = period === 'daily' ? 'SignalDock 每日信息摘要' : 'SignalDock 每周信息摘要';
  const topItems = items.slice(0, 10).map((item) => ({ id: item.id, title: item.title, sourceName: item.source_name, url: item.url, importanceScore: item.importance_score, summary: item.analysis_summary, collectedAt: item.collected_at }));
  const lines = [title, `统计区间：${since} 至 ${now.toISOString()}`, `新增信息：${items.length} 条；变化：${changeCount} 条；未读：${items.filter((item) => !item.is_read).length} 条。`];
  if (Object.keys(sourceCounts).length) lines.push(`来源：${Object.entries(sourceCounts).map(([source, count]) => `${source} ${count} 条`).join('，')}`);
  if (topItems.length) lines.push('', '重点信息：', ...topItems.map((item, index) => `${index + 1}. ${item.title}（${item.sourceName}，重要度 ${Math.round(item.importanceScore * 100)}%）\n${item.summary || item.url}`));
  else lines.push('', '本周期没有新信息。');
  return { period, title, since, until: now.toISOString(), total: items.length, unread: items.filter((item) => !item.is_read).length, changes: changeCount, sourceCounts, topItems, text: lines.join('\n') };
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

