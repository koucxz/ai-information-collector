import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db } from '../db/client.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';

beforeEach(() => db.exec('DELETE FROM information_changes; DELETE FROM information_snapshots; DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;'));

describe('information feed', () => {
  it('filters, sorts and paginates information', async () => {
    const first = normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword: 'AI', title: '普通信息', summary: '', content: '内容', url: 'https://example.com/feed-1', publishedAt: null });
    const second = normalizeResult({ source: 'baidu', sourceName: '百度', keyword: 'AI', title: '重要信息', summary: '', content: '重大开源发布', url: 'https://example.com/feed-2', publishedAt: null });
    informationStore.saveResults([first, second]);
    db.prepare('UPDATE information_items SET importance_score = 0.9 WHERE source = ?').run('baidu');
    const response = await request(app).get('/api/information?source=baidu&sort=importance&page=1&pageSize=1&minImportance=0.8');
    expect(response.body).toMatchObject({ total: 1, totalPages: 1, page: 1 });
    expect(response.body.data[0].source).toBe('baidu');
  });

  it('marks read and returns event sources', async () => {
    const item = normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword: 'AI', title: '同一事件', summary: '', content: '内容', url: 'https://example.com/event-1', publishedAt: null });
    const other = normalizeResult({ ...item, source: 'baidu', sourceName: '百度', url: 'https://example.com/event-2' });
    informationStore.saveResults([item, other]);
    const stored = informationStore.list()[0];
    expect((await request(app).patch(`/api/information/${stored.id}/read`)).status).toBe(200);
    expect((await request(app).get(`/api/information/${stored.id}/event`)).body.data.sources).toHaveLength(2);
  });
});
