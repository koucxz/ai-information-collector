import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { informationStore } from '../modules/collection/information.store.js';
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
});
