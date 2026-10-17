import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { historyStore } from '../modules/collection/history.store.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';

beforeEach(() => db.exec('DELETE FROM information_changes; DELETE FROM information_snapshots; DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;'));

describe('history detection', () => {
  it('marks first capture as new and identical capture as seen', () => {
    const item = normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword: 'AI', title: 'AI 新闻', summary: '', content: '正文', url: 'https://example.com/history', publishedAt: null });
    informationStore.saveResults([item]);
    expect(historyStore.capture([item])).toEqual({ snapshots: 1, changes: 1 });
    expect(historyStore.capture([item])).toEqual({ snapshots: 1, changes: 0 });
  });

  it('marks changed content as updated', () => {
    const first = normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword: 'AI', title: 'AI 新闻', summary: '', content: '旧正文', url: 'https://example.com/history', publishedAt: null });
    const second = normalizeResult({ ...first, content: '新正文' });
    informationStore.saveResults([first]); historyStore.capture([first]);
    informationStore.saveResults([second]);
    expect(historyStore.capture([second])).toEqual({ snapshots: 1, changes: 1 });
    expect(historyStore.listChanges().map((change) => change.changeType)).toEqual(['updated', 'new']);
  });
});
