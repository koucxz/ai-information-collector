import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BaiduAdapter, parseBaiduResults } from '../modules/collection/baidu.adapter.js';
import { FixtureAdapter } from '../modules/collection/fixture.adapter.js';

describe('collection adapters', () => {
  it('loads fixture results into the shared structure', async () => {
    const adapter = new FixtureAdapter(resolve(process.cwd(), '..', 'skills', 'hot-monitor', 'fixtures', 'hot-topics.json'));
    const results = await adapter.search('人工智能');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: 'fixture', sourceName: '本地测试数据', keyword: '人工智能' });
    expect(results[0].fingerprint).toHaveLength(64);
  });

  it('parses Baidu result headings', () => {
    const results = parseBaiduResults('<h3><a href="https://example.com/a">AI &amp; 工程</a></h3>', 'AI');
    expect(results[0]).toMatchObject({ source: 'baidu', title: 'AI & 工程', url: 'https://example.com/a' });
  });

  it('records timeout through AbortController', async () => {
    const fetcher: typeof fetch = (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError'))));
    await expect(new BaiduAdapter(5, fetcher).search('超时')).rejects.toMatchObject({ name: 'AbortError' });
  });
});
