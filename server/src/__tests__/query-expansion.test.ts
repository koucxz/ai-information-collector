import { describe, expect, it } from 'vitest';
import { expandTopicQueries, matchesExcludedWord } from '../modules/collection/query-expansion.js';

describe('query expansion', () => {
  it('expands enabled keywords and aliases without duplicates', () => {
    const queries = expandTopicQueries([{ id: '1', name: '人工智能', aliases: ['AI', '大模型', 'ai'], excludeWords: ['广告'], enabled: true, keywords: [{ value: '人工智能', enabled: true }, { value: '停用词', enabled: false }] }]);
    expect(queries.map((query) => query.value)).toEqual(['人工智能', 'AI', '大模型']);
    expect(queries[0].excludeWords).toEqual(['广告']);
  });

  it('falls back to the topic name and applies exclude words', () => {
    expect(expandTopicQueries([{ id: '1', name: '信息监测', enabled: true, keywords: [] }])[0].value).toBe('信息监测');
    expect(matchesExcludedWord({ title: 'AI 广告', summary: '', content: '' }, ['广告'])).toBe(true);
    expect(matchesExcludedWord({ title: 'AI 发布', summary: '', content: '' }, ['广告'])).toBe(false);
  });
});
