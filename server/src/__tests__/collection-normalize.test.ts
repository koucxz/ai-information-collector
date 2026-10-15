import { describe, expect, it } from 'vitest';
import { fingerprintFor, normalizeResult } from '../modules/collection/normalize.js';

describe('collection normalization', () => {
  it('cleans text, normalizes URL and creates a stable fingerprint', () => {
    const first = normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword: 'AI', title: '<b> AI 进展 </b>', summary: '  摘要  ', content: '<p>正文</p>', url: 'https://example.com/a#top', publishedAt: '2026-10-15T00:00:00Z' });
    const second = fingerprintFor({ source: 'fixture', title: 'AI 进展', content: '正文', url: 'https://example.com/a' });
    expect(first.title).toBe('AI 进展');
    expect(first.url).toBe('https://example.com/a');
    expect(first.fingerprint).toBe(second);
  });
});
