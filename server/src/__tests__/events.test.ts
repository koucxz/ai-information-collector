import { beforeEach, describe, expect, it } from 'vitest';
import request from '../test/authenticated-request.js';
import { app } from '../app.js';
import { db } from '../db/client.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';

beforeEach(() => db.exec('DELETE FROM information_changes; DELETE FROM information_snapshots; DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;'));

describe('event API', () => {
  it('lists grouped events with counts', async () => {
    const first = normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword: 'AI', title: '同一事件发布', summary: '摘要', content: '内容', url: 'https://example.com/event-a', publishedAt: null });
    const second = normalizeResult({ ...first, source: 'baidu', sourceName: '百度', url: 'https://example.com/event-b' });
    informationStore.saveResults([first, second]);
    const response = await request(app).get('/api/events?page=1&pageSize=10');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1, totalPages: 1 });
    expect(response.body.data[0]).toMatchObject({ sourceCount: 2, itemCount: 2 });
  });

  it('returns evidence and change timeline for an event', async () => {
    const item = normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword: 'AI', title: '事件证据', summary: '摘要', content: '内容', url: 'https://example.com/event-c', publishedAt: null });
    informationStore.saveResults([item]);
    const stored = informationStore.list()[0];
    const response = await request(app).get('/api/events/' + stored.eventKey);
    expect(response.status).toBe(200);
    expect(response.body.data.evidence).toHaveLength(1);
    expect(response.body.data.changes).toHaveLength(0);
  });
});
