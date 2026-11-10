import request from '../test/authenticated-request.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { db } from '../db/client.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';

beforeEach(() => db.exec('DELETE FROM information_feedback; DELETE FROM information_changes; DELETE FROM information_snapshots; DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;'));

describe('feedback and personalized ranking', () => {
  it('stores and replaces feedback through the API', async () => {
    informationStore.saveResults([normalizeResult({ source: 'juejin', sourceName: '掘金', keyword: 'AI', title: 'AI 工程', summary: '', content: '正文', url: 'https://juejin.cn/post/feedback', publishedAt: null })]);
    const item = informationStore.list()[0];
    expect((await request(app).put(`/api/information/${item.id}/feedback`).send({ value: 'helpful' })).body.data.feedback).toBe('helpful');
    expect((await request(app).put(`/api/information/${item.id}/feedback`).send({ value: 'irrelevant' })).body.data.feedback).toBe('irrelevant');
    expect((await request(app).put(`/api/information/${item.id}/feedback`).send({ value: 'other' })).status).toBe(400);
  });

  it('uses feedback and learned source preference in personalized order', () => {
    informationStore.saveResults([
      normalizeResult({ source: 'zhihu', sourceName: '知乎', keyword: 'AI', title: '知乎一', summary: '', content: '正文', url: 'https://zhihu.com/question/1', publishedAt: null }),
      normalizeResult({ source: 'zhihu', sourceName: '知乎', keyword: 'AI', title: '知乎二', summary: '', content: '正文', url: 'https://zhihu.com/question/2', publishedAt: null }),
      normalizeResult({ source: 'weibo', sourceName: '微博', keyword: 'AI', title: '微博一', summary: '', content: '正文', url: 'https://weibo.com/1/detail/a', publishedAt: null })
    ]);
    const items = informationStore.list();
    informationStore.setFeedback(items.find((item) => item.title === '知乎一')!.id, 'helpful');
    informationStore.setFeedback(items.find((item) => item.title === '微博一')!.id, 'irrelevant');
    const ranked = informationStore.feed({ page: 1, pageSize: 10, sort: 'personalized' }).data;
    expect(ranked[0].title).toBe('知乎一');
    expect(ranked.at(-1)?.title).toBe('微博一');
    expect(ranked.find((item) => item.title === '知乎二')!.personalizedScore).toBeGreaterThan(0);
  });
});
