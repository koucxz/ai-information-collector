import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { db } from '../db/client.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';
import { buildDigest, sendDigest } from '../modules/notifications/digest.service.js';

beforeEach(() => db.exec('DELETE FROM information_feedback; DELETE FROM information_changes; DELETE FROM information_snapshots; DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;'));

describe('digest notifications', () => {
  it('builds daily and weekly summaries from recent information', async () => {
    informationStore.saveResults([normalizeResult({ source: 'baidu', sourceName: '百度', keyword: 'AI', title: '重要发布', summary: '摘要', content: '正文', url: 'https://example.com/digest', publishedAt: null })]);
    db.prepare('UPDATE information_items SET importance_score = 0.9, analysis_summary = ?').run('值得关注');
    const digest = buildDigest('daily', new Date(Date.now() + 1_000));
    expect(digest).toMatchObject({ total: 1, unread: 1, sourceCounts: { 百度: 1 } });
    expect(digest.text).toContain('重要发布');
    expect((await request(app).get('/api/notifications/digest?period=weekly')).status).toBe(200);
  });

  it('sends through an injected transport and degrades without email config', async () => {
    const sent: Array<{ to: string; subject: string }> = [];
    const transport = { sendMail: async (message: { to: string; subject: string }) => { sent.push(message); } };
    await expect(sendDigest('daily', { transport, recipient: 'me@example.com' })).resolves.toMatchObject({ sent: true });
    expect(sent[0]).toMatchObject({ to: 'me@example.com', subject: 'SignalDock 每日信息摘要' });
    await expect(sendDigest('daily')).resolves.toMatchObject({ sent: false, reason: '未配置 NOTIFY_EMAIL' });
  });
});

