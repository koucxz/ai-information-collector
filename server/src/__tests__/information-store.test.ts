import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { informationStore, titleSimilarity } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';

beforeEach(() => db.exec('DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;'));

describe('information persistence', () => {
  it('deduplicates the same source URL and keeps different sources in one event', () => {
    const first = normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword: 'AI', title: 'AI 新闻', summary: '摘要', content: '正文', url: 'https://example.com/news#top', publishedAt: null });
    const sameUrl = { ...first, source: 'fixture', sourceName: '本地测试数据', url: 'https://example.com/news' };
    const otherSource = { ...first, source: 'baidu', sourceName: '百度' };
    expect(informationStore.saveResults([first, sameUrl, otherSource])).toEqual({ saved: 2, duplicates: 1 });
    const items = informationStore.list();
    expect(items).toHaveLength(2);
    expect(items[0].eventKey).toBe(items[1].eventKey);
  });

  it('merges similar cross-source titles and exposes event metadata', () => {
    const first = normalizeResult({ source: 'baidu', sourceName: '百度', keyword: 'AI', title: '国产大模型进入企业知识库工作流', summary: '', content: '正文', url: 'https://a.example/news', publishedAt: null });
    const second = normalizeResult({ source: 'zhihu', sourceName: '知乎', keyword: 'AI', title: '重磅：国产大模型正式进入企业知识库工作流', summary: '', content: '分析', url: 'https://b.example/question/1', publishedAt: null });
    expect(titleSimilarity(first.title, second.title)).toBeGreaterThan(0.68);
    informationStore.saveResults([first, second]);
    const items = informationStore.list();
    expect(items[0].eventKey).toBe(items[1].eventKey);
    expect(informationStore.event(items[0].id)).toMatchObject({ sourceCount: 2 });
  });
});
