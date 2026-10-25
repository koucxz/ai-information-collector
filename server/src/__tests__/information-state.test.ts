import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db } from '../db/client.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';

beforeEach(() => db.exec('DELETE FROM information_feedback; DELETE FROM information_changes; DELETE FROM information_snapshots; DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;'));

describe('information state and search', () => {
  it('searches content and toggles read, saved and archived states', async () => {
    const item = normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword: 'DeepSeek', title: '模型价格变化', summary: '国产模型价格和额度调整', content: '上下文长度更新', url: 'https://example.com/state-1', publishedAt: null });
    informationStore.saveResults([item]);
    const stored = informationStore.list()[0];
    expect((await request(app).get('/api/information?q=上下文')).body.total).toBe(1);
    expect((await request(app).patch('/api/information/' + stored.id + '/save').send({ saved: true })).body.data.isSaved).toBe(true);
    expect((await request(app).patch('/api/information/' + stored.id + '/archive').send({ archived: true })).body.data.isArchived).toBe(true);
    expect((await request(app).get('/api/information?saved=true&archived=false')).body.total).toBe(0);
    expect((await request(app).patch('/api/information/' + stored.id + '/read').send({ isRead: false })).body.data.isRead).toBe(false);
  });
});
