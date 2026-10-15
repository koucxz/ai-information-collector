import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { db } from '../db/client.js';

beforeEach(() => db.exec('DELETE FROM keywords; DELETE FROM topics;'));

describe('GET /api/collect/preview', () => {
  it('collects fixture data for enabled topics and keywords', async () => {
    const topic = await request(app).post('/api/topics').send({ name: 'AI' });
    await request(app).post(`/api/topics/${topic.body.data.id}/keywords`).send({ value: '人工智能' });
    const response = await request(app).get('/api/collect/preview?source=fixture');
    expect(response.status).toBe(200);
    expect(response.body.stats).toMatchObject({ topics: 1, keywords: 1, results: 1 });
    expect(response.body.data[0].source).toBe('fixture');
  });

  it('skips disabled keywords and rejects unknown sources', async () => {
    const topic = await request(app).post('/api/topics').send({ name: 'AI' });
    const keyword = await request(app).post(`/api/topics/${topic.body.data.id}/keywords`).send({ value: '人工智能' });
    await request(app).patch(`/api/topics/${topic.body.data.id}/keywords/${keyword.body.data.id}`).send({ enabled: false });
    const skipped = await request(app).get('/api/collect/preview?source=fixture');
    expect(skipped.body.stats.keywords).toBe(0);
    expect((await request(app).get('/api/collect/preview?source=unknown')).status).toBe(400);
  });
});
