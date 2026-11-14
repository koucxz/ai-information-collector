import { beforeEach, describe, expect, it } from 'vitest';
import request from '../test/authenticated-request.js';
import { app } from '../app.js';
import { db } from '../db/client.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';
import type { Brief } from '../modules/briefs/brief.schemas.js';

beforeEach(() => db.exec(`
  DELETE FROM editorial_briefs; DELETE FROM information_feedback; DELETE FROM information_item_topics;
  DELETE FROM topic_tag_meta; DELETE FROM information_changes; DELETE FROM information_snapshots;
  DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;
`));

describe('文章草稿（收藏素材 → 编辑器 → 发布侧栏）', () => {
  it('用收藏线索新建草稿会带上原文与主题标签，正文和标签可保存', async () => {
    const topic = await request(app).post('/api/topics').send({ name: 'AI 编程' });
    await request(app).post(`/api/topics/${topic.body.data.id}/keywords`).send({ value: 'Cursor' });
    informationStore.saveResults([
      normalizeResult({ source: 'fixture', sourceName: '测试来源', keyword: 'Cursor', title: 'Cursor 编辑器更新', summary: '更新说明', content: '正文片段', url: 'https://example.com/post-1', publishedAt: null }),
      normalizeResult({ source: 'rss', sourceName: 'RSS', keyword: 'Cursor', title: 'Cursor 使用体验', summary: '体验说明', content: '正文片段', url: 'https://example.com/post-2', publishedAt: null })
    ]);
    const ids = informationStore.list().map((item) => item.id);

    const created = await request(app).post('/api/briefs').send({ itemIds: ids });
    expect(created.status).toBe(201);
    const brief = created.body.data as Brief;
    expect(brief.status).toBe('draft');
    expect(brief.content).toBe('');
    expect(brief.sources).toHaveLength(2);
    expect(brief.tags).toContain('AI 编程');
    expect(brief.tasks.length).toBeGreaterThan(0);

    const saved = await request(app).patch('/api/briefs/' + brief.id).send({
      version: brief.version, title: '我的第一篇文章', content: '# 正文\n\n写点什么。', tags: ['AI 编程', '随笔']
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.content).toContain('正文');
    expect(saved.body.data.tags).toContain('随笔');
    expect((await request(app).get('/api/briefs')).body.data[0].title).toBe('我的第一篇文章');
  });

  it('发布前检查只是提示，未勾完也能标记发布', async () => {
    const created = await request(app).post('/api/briefs').send({ itemIds: [], title: '空白草稿' });
    expect(created.status).toBe(201);
    let brief = created.body.data as Brief;
    expect(brief.sources).toHaveLength(0);
    expect(brief.tasks.some((task) => !task.done)).toBe(true);

    const published = await request(app).patch('/api/briefs/' + brief.id).send({ version: brief.version, status: 'published' });
    expect(published.status).toBe(200);
    brief = published.body.data;
    expect(brief.status).toBe('published');
    expect(brief.publishedAt).toBeTruthy();
    expect(brief.tasks.some((task) => !task.done)).toBe(true);
  });
});
