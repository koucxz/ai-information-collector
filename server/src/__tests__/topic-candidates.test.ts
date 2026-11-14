import { beforeEach, describe, expect, it } from 'vitest';
import request from '../test/authenticated-request.js';
import { app } from '../app.js';
import { db } from '../db/client.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';
import type { Brief } from '../modules/briefs/brief.schemas.js';

const insert = (source: string, keyword: string, title: string, hoursAgo: number) => {
  const url = `https://example.com/candidate/${encodeURIComponent(title)}`;
  informationStore.saveResults([normalizeResult({
    source, sourceName: source, keyword, title, summary: '公开片段，需要回原文核验', content: '公开片段', url, publishedAt: null
  })]);
  const item = informationStore.list().find(row => row.url === url);
  if (item) db.prepare('UPDATE information_items SET collected_at = ?, importance_score = ?, relevance_score = ? WHERE id = ?')
    .run(new Date(Date.now() - hoursAgo * 3_600_000).toISOString(), 0.72, 0.66, item.id);
  return item;
};

beforeEach(() => db.exec('DELETE FROM editorial_briefs; DELETE FROM generation_usage; DELETE FROM ai_usage; DELETE FROM information_feedback; DELETE FROM information_changes; DELETE FROM information_snapshots; DELETE FROM information_items;'));

describe('Beacon 风格选题推荐与成稿状态', () => {
  it('用真实采集记录算出六维评分、抢跑窗口与可开写的线索', async () => {
    insert('juejin', 'Docker 部署', 'Docker 部署实践与踩坑', 1);
    insert('kr36', 'Docker 部署', '容器化部署的新方案', 3);
    insert('v2ex', 'Docker 部署', '生产环境迁移记录', 20);
    insert('rss', '前端框架', '框架更新一览', 200);
    const response = await request(app).get('/api/briefs/candidates');
    expect(response.status).toBe(200);
    expect(response.body.method).toBe('rules');
    const candidate = response.body.data.find((item: { keyword: string }) => item.keyword === 'Docker 部署');
    expect(candidate).toBeDefined();
    expect(candidate.dimensions).toHaveLength(6);
    expect(candidate.score).toBeGreaterThan(0);
    expect(candidate.score).toBeLessThanOrEqual(100);
    expect(candidate.angle).toBe('engineering');
    expect(candidate.window).toContain('抢跑窗口');
    expect(candidate.why).toContain('3 条线索');
    expect(candidate.itemIds.length).toBeGreaterThanOrEqual(2);
    expect(candidate.sampleTitles).toHaveLength(3);
    expect(candidate.used).toBe(false);
  });

  it('推荐理由可转成选题，正文保存后只有完成检查表才能标记已发布', async () => {
    const first = insert('juejin', 'Docker 部署', 'Docker 部署实践与踩坑', 1);
    const second = insert('kr36', 'Docker 部署', '容器化部署的新方案', 3);
    const generated = await request(app).post('/api/briefs/generate').send({ itemIds: [first!.id, second!.id] });
    expect(generated.status).toBe(200);
    let brief = generated.body.data[0] as Brief;
    expect(brief.status).toBe('idea');
    expect(brief.content).toBe('');
    expect(brief.signal?.dimensions).toHaveLength(6);
    expect(brief.rationale).toContain('条线索');

    const written = await request(app).patch('/api/briefs/' + brief.id).send({ version: brief.version, content: '# 初稿\n\n待补充事实核验。', status: 'draft' });
    expect(written.status).toBe(200);
    brief = written.body.data;
    expect(brief.content).toContain('初稿');
    expect((await request(app).get('/api/briefs')).body.data[0].content).toContain('初稿');

    expect((await request(app).patch('/api/briefs/' + brief.id).send({ version: brief.version, status: 'published' })).status).toBe(400);
    const published = await request(app).patch('/api/briefs/' + brief.id).send({
      version: brief.version, tasks: brief.tasks.map(task => ({ ...task, done: true })), status: 'published'
    });
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe('published');
    expect(published.body.data.publishedAt).toBeTruthy();
    expect(published.body.data.content).toContain('初稿');
  });

  it('候选里已开写过的线索会被标出来', async () => {
    const first = insert('juejin', '前端框架', '框架 A 更新', 2);
    const second = insert('kr36', '前端框架', '框架 B 对比', 4);
    await request(app).post('/api/briefs/generate').send({ itemIds: [first!.id, second!.id] });
    const candidate = (await request(app).get('/api/briefs/candidates')).body.data
      .find((item: { keyword: string }) => item.keyword === '前端框架');
    expect(candidate.used).toBe(true);
  });
});
