import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { db } from '../db/client.js';

beforeEach(() => {
  db.exec('DELETE FROM keywords; DELETE FROM topics;');
});

describe('topic and keyword management', () => {
  it('creates a topic with keywords and reads it back', async () => {
    const created = await request(app).post('/api/topics').send({
      name: '人工智能', aliases: ['AI', '大模型'], excludeWords: ['广告']
    });
    expect(created.status).toBe(201);
    const topicId = created.body.data.id;

    const keyword = await request(app).post(`/api/topics/${topicId}/keywords`).send({ value: '多模态模型' });
    expect(keyword.status).toBe(201);

    const listed = await request(app).get('/api/topics');
    expect(listed.body.data[0]).toMatchObject({ name: '人工智能', aliases: ['AI', '大模型'], excludeWords: ['广告'] });
    expect(listed.body.data[0].keywords[0]).toMatchObject({ value: '多模态模型', enabled: true });
  });

  it('updates and disables a topic and its keyword', async () => {
    const created = await request(app).post('/api/topics').send({ name: '软件工程' });
    const topicId = created.body.data.id;
    const keyword = await request(app).post(`/api/topics/${topicId}/keywords`).send({ value: 'TypeScript' });

    const topic = await request(app).patch(`/api/topics/${topicId}`).send({ name: '工程实践', enabled: false });
    const updatedKeyword = await request(app).patch(`/api/topics/${topicId}/keywords/${keyword.body.data.id}`).send({ enabled: false, value: 'Node.js' });

    expect(topic.body.data).toMatchObject({ name: '工程实践', enabled: false });
    expect(updatedKeyword.body.data).toMatchObject({ value: 'Node.js', enabled: false });
  });

  it('rejects duplicate names and keywords', async () => {
    const created = await request(app).post('/api/topics').send({ name: '重复检查' });
    expect((await request(app).post('/api/topics').send({ name: '重复检查' })).status).toBe(400);
    const topicId = created.body.data.id;
    expect((await request(app).post(`/api/topics/${topicId}/keywords`).send({ value: '同一个词' })).status).toBe(201);
    expect((await request(app).post(`/api/topics/${topicId}/keywords`).send({ value: '同一个词' })).status).toBe(400);
  });

  it('cascades keyword deletion when a topic is deleted', async () => {
    const created = await request(app).post('/api/topics').send({ name: '级联删除' });
    const topicId = created.body.data.id;
    await request(app).post(`/api/topics/${topicId}/keywords`).send({ value: '需要删除' });
    expect((await request(app).delete(`/api/topics/${topicId}`)).status).toBe(204);
    expect((await request(app).get('/api/topics')).body.data).toHaveLength(0);
  });

  it('rejects invalid topic payloads', async () => {
    const response = await request(app).post('/api/topics').send({ name: '' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('主题参数无效');
  });
});
