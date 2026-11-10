import request from '../test/authenticated-request.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { db } from '../db/client.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';

beforeEach(() => db.exec('DELETE FROM notification_deliveries; DELETE FROM notification_channels; DELETE FROM analysis_calls; DELETE FROM collection_runs; DELETE FROM source_health; DELETE FROM information_feedback; DELETE FROM information_changes; DELETE FROM information_snapshots; DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;'));

describe('product capability APIs', () => {
  it('stores topic source scope and schedule settings', async () => {
    const response = await request(app).post('/api/topics').send({ name: '产品设计', sourceIds: ['zhihu', 'juejin'], frequencyMinutes: 45, notificationLevel: 'all', description: '关注真实产品案例' });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ sourceIds: ['zhihu', 'juejin'], frequencyMinutes: 45, notificationLevel: 'all', description: '关注真实产品案例' });
  });

  it('searches indexed information while preserving regular filters', async () => {
    const item = normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword: 'AI', title: '检索索引验证', summary: 'FTS 摘要', content: '这是一段可以被全文搜索找到的正文。', url: 'https://example.com/fts', publishedAt: null });
    informationStore.saveResults([item]);
    const response = await request(app).get('/api/information?q=全文搜索');
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
  });

  it('exports and restores a portable JSON backup', async () => {
    await request(app).post('/api/topics').send({ name: '备份主题' });
    const backup = await request(app).get('/api/data/backup');
    expect(backup.body).toMatchObject({ format: 'signaldock-backup', version: 1 });
    await request(app).delete(`/api/topics/${backup.body.tables.topics[0].id}`);
    expect((await request(app).get('/api/topics')).body.data).toHaveLength(0);
    const restored = await request(app).post('/api/data/restore').send(backup.body);
    expect(restored.status).toBe(200);
    expect((await request(app).get('/api/topics')).body.data[0].name).toBe('备份主题');
  });

  it('creates and lists notification channels without exposing a secret in the API shape', async () => {
    const created = await request(app).post('/api/notifications/channels').send({ name: '办公群', type: 'feishu', endpoint: 'https://example.com/webhook/token' });
    expect(created.status).toBe(201);
    expect((await request(app).get('/api/notifications/channels')).body.data[0]).toMatchObject({ name: '办公群', type: 'feishu', enabled: true });
  });
});
