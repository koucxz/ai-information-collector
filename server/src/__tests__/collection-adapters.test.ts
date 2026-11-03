import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BaiduAdapter, parseBaiduResults } from '../modules/collection/baidu.adapter.js';
import { FixtureAdapter } from '../modules/collection/fixture.adapter.js';

describe('collection adapters', () => {
  it('loads fixture results into the shared structure', async () => {
    const adapter = new FixtureAdapter(resolve(process.cwd(), '..', 'skills', 'hot-monitor', 'fixtures', 'hot-topics.json'));
    const results = await adapter.search('人工智能');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: 'fixture', keyword: '人工智能' });
    expect(results[0].sourceName).toBeTruthy();
    expect(results[0].fingerprint).toHaveLength(64);
  });

  it('prefers item sourceName and falls back to the adapter default', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'signaldock-fixture-')), 'fixture.json');
    writeFileSync(file, JSON.stringify([
      { title: 'A', url: 'https://example.com/a', keywords: ['k'] },
      { title: 'B', url: 'https://example.com/b', keywords: ['k'], sourceName: '知乎' }
    ]));
    const results = await new FixtureAdapter(file).search('k');
    expect(results.map((result) => result.sourceName)).toEqual(['本地测试数据', '知乎']);
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
