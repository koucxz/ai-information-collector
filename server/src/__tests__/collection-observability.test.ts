import { beforeEach, describe, expect, it } from 'vitest';
import request from '../test/authenticated-request.js';
import { app } from '../app.js';
import { db } from '../db/client.js';

beforeEach(() => db.exec('DELETE FROM collection_runs; DELETE FROM source_health; DELETE FROM information_feedback; DELETE FROM information_changes; DELETE FROM information_snapshots; DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;'));

describe('collection observability', () => {
  it('records completed runs and source health', async () => {
    const topic = await request(app).post('/api/topics').send({ name: 'AI' });
    await request(app).post('/api/topics/' + topic.body.data.id + '/keywords').send({ value: '人工智能' });
    const run = await request(app).post('/api/collect/run').send({ sources: ['fixture'] });
    expect(run.status).toBe(200);
    expect(run.body.runId).toBeTruthy();
    expect((await request(app).get('/api/collect/runs')).body.data[0]).toMatchObject({ status: 'completed', results: 1 });
    expect((await request(app).get('/api/collect/health')).body.data[0]).toMatchObject({ source: 'fixture', attempts: 1, successes: 1, successRate: 1 });
  });
});
