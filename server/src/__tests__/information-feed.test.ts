import { beforeEach, describe, expect, it } from 'vitest';
import request from '../test/authenticated-request.js';
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

  it('filters information by topic and reports per-topic counts', async () => {
    const coding = await request(app).post('/api/topics').send({ name: 'AI 编程', aliases: ['Copilot'] });
    const ops = await request(app).post('/api/topics').send({ name: '运维' });
    await request(app).post(`/api/topics/${coding.body.data.id}/keywords`).send({ value: 'Cursor' });
    await request(app).post(`/api/topics/${ops.body.data.id}/keywords`).send({ value: 'Docker' });
    const make = (keyword: string, title: string, url: string) => normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword, title, summary: '', content: '内容', url, publishedAt: null });
    informationStore.saveResults([
      make('Cursor', 'Cursor 编辑器更新', 'https://example.com/topic-1'),
      make('Copilot', 'Copilot 新版本', 'https://example.com/topic-2'),
      make('Docker', 'Docker 新版本', 'https://example.com/topic-3')
    ]);

    const feed = await request(app).get(`/api/information?topicId=${coding.body.data.id}`);
    expect(feed.body.total).toBe(2);
    expect(feed.body.data.map((item: { keyword: string }) => item.keyword).sort()).toEqual(['Copilot', 'Cursor']);

    const overview = await request(app).get(`/api/information/overview?topicId=${coding.body.data.id}`);
    expect(overview.body.all).toBe(2);
    expect(overview.body.globalAll).toBe(3);
    expect(overview.body.topicCounts[coding.body.data.id]).toBe(2);
    expect(overview.body.topicCounts[ops.body.data.id]).toBe(1);
    expect((await request(app).get('/api/information?topicId=missing')).status).toBe(400);
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
