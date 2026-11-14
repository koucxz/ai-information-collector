import { beforeEach, describe, expect, it } from 'vitest';
import request from '../test/authenticated-request.js';
import { app } from '../app.js';
import { db } from '../db/client.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';
import { tagText, topicRules, type TopicRule } from '../modules/collection/topic-tagger.js';
import { containsTerm } from '../modules/collection/text-match.js';

const rules: TopicRule[] = [
  { id: 'coding', name: 'AI 编程', terms: ['AI', 'Cursor', 'AI 编程'], excludes: [], queryWords: ['cursor'] },
  { id: 'ops', name: '部署运维', terms: ['Docker', '部署运维'], excludes: ['教程'], queryWords: ['docker'] }
];

const insert = (keyword: string, title: string, url: string) => informationStore.saveResults([
  normalizeResult({ source: 'fixture', sourceName: '测试来源', keyword, title, summary: '', content: '', url, publishedAt: null })
]);

beforeEach(() => db.exec(`
  DELETE FROM editorial_briefs; DELETE FROM information_feedback; DELETE FROM information_item_topics;
  DELETE FROM topic_tag_meta; DELETE FROM information_changes; DELETE FROM information_snapshots;
  DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;
`));

describe('主题打标', () => {
  it('英文按词边界匹配，中文支持去空格的紧凑写法', () => {
    const item = { keyword: '', summary: '', content: '' };
    // maintain 里虽然含有字母 ai，但不是一个独立的词
    expect(tagText({ ...item, title: 'Maintain 工具更新' }, rules)).toEqual([]);
    expect(tagText({ ...item, title: 'AI 编程工具更新' }, rules).map(hit => hit.id)).toContain('coding');
    expect(tagText({ ...item, title: 'AI编程工具更新' }, rules).map(hit => hit.id)).toContain('coding');
    expect(tagText({ ...item, title: 'Docker 桌面版发布' }, rules).map(hit => hit.id)).toContain('ops');
  });

  it('一条信息可带多个标签，排除词命中的主题不参与打标', () => {
    const multi = tagText({ title: 'Cursor 搭配 Docker 的实践', summary: '', content: '', keyword: '' }, rules);
    expect(multi.map(hit => hit.id).sort()).toEqual(['coding', 'ops']);
    expect(multi[0].score).toBeGreaterThan(0);
    const excluded = tagText({ title: 'Docker 入门教程', summary: '', content: '', keyword: '' }, rules);
    expect(excluded.map(hit => hit.id)).not.toContain('ops');
  });

  it('标题权重高于摘要，正文偶然提词不打标，采集查询词仍能归类历史数据', () => {
    const titleHit = tagText({ title: 'Cursor 编辑器发布', summary: '', content: '', keyword: '' }, rules)[0];
    const summaryHit = tagText({ title: '无关标题', summary: 'Cursor 更新说明', content: '', keyword: '' }, rules)[0];
    expect(titleHit.score).toBeGreaterThan(summaryHit.score);
    expect(tagText({ title: '无关标题', summary: '', content: '里面提到 Cursor', keyword: '' }, rules)).toEqual([]);
    expect(tagText({ title: '历史标题', summary: '摘要里提到 Cursor', content: '', keyword: 'cursor' }, rules)[0].id).toBe('coding');
    expect(tagText({ title: '无关标题', summary: '', content: '只有正文提到 Cursor', keyword: 'cursor' }, rules)).toEqual([]);
  });

  it('采集词命中但内容与主题无关的噪声不会被误归类', () => {
    const noise = { title: 'Banner de consentimento de cookies (Consent Mode v2)', summary: 'Mirrored from agent_issues id 1003510', content: 'D1 is authoritative for this issue state', keyword: 'Kimi' };
    expect(tagText(noise, rules)).toEqual([]);
  });

  it('模型名带版本号或前缀也能命中', () => {
    // Qwen3.8 / GPT-4 这类写法应该被当成 Qwen / GPT，但 Google 不能被 Go 命中
    expect(containsTerm('qwen3.8 re-educated', '', 'Qwen')).toBe(true);
    expect(containsTerm('gpt-4 turbo release', '', 'GPT')).toBe(true);
    expect(containsTerm('google announces', '', 'Go')).toBe(false);
    expect(containsTerm('maintain the database', '', 'AI')).toBe(false);
  });

  it('GPT 关键词也能命中 ChatGPT 写法', async () => {
    const topic = await request(app).post('/api/topics').send({ name: '大模型上新' });
    await request(app).post(`/api/topics/${topic.body.data.id}/keywords`).send({ value: 'GPT' });
    const hits = tagText({ title: 'Introducing ChatGPT Wallet', summary: '', content: '', keyword: 'GPT' }, topicRules());
    expect(hits.map((hit) => hit.name)).toContain('大模型上新');
  });

  it('主题筛选、未分类筛选与主题计数都基于打标结果', async () => {
    const coding = await request(app).post('/api/topics').send({ name: 'AI 编程', aliases: ['Copilot'] });
    const ops = await request(app).post('/api/topics').send({ name: '部署运维', excludeWords: ['教程'] });
    await request(app).post(`/api/topics/${coding.body.data.id}/keywords`).send({ value: 'Cursor' });
    await request(app).post(`/api/topics/${ops.body.data.id}/keywords`).send({ value: 'Docker' });
    insert('其他', 'Cursor 搭配 Docker 的实践', 'https://example.com/tag-1');
    insert('其他', '和主题无关的日常记录', 'https://example.com/tag-2');
    insert('其他', 'Docker 入门教程', 'https://example.com/tag-3');
    insert('其他', 'Copilot 新版本', 'https://example.com/tag-4');

    const codingFeed = await request(app).get(`/api/information?topicId=${coding.body.data.id}`);
    expect(codingFeed.body.total).toBe(2);
    expect(codingFeed.body.data[0].topics.map((tag: { name: string }) => tag.name)).toContain('AI 编程');
    const opsFeed = await request(app).get(`/api/information?topicId=${ops.body.data.id}`);
    expect(opsFeed.body.total).toBe(1); // 排除词「教程」那条不归到部署运维
    const noneFeed = await request(app).get('/api/information?topicId=__none__');
    expect(noneFeed.body.total).toBe(2); // 无关记录 + 被排除词过滤的记录

    const overview = await request(app).get('/api/information/overview');
    expect(overview.body.topicCounts[coding.body.data.id]).toBe(2);
    expect(overview.body.unclassified).toBe(2);
    expect((await request(app).post('/api/information/retag')).status).toBe(200);
  });

  it('主题改名或关键词变更后自动重打标', async () => {
    const topic = await request(app).post('/api/topics').send({ name: '旧名字' });
    insert('其他', '旧名字 相关动态', 'https://example.com/tag-rename');
    expect((await request(app).get('/api/information?topicId=' + topic.body.data.id)).body.total).toBe(1);
    await request(app).patch('/api/topics/' + topic.body.data.id).send({ name: '新名字' });
    const feed = await request(app).get('/api/information?topicId=' + topic.body.data.id);
    expect(feed.body.total).toBe(0);
    expect(feed.body.data).toHaveLength(0);
  });
});
