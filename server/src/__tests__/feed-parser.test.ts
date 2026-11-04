import { describe, expect, it } from 'vitest';
import { parseFeed } from '../modules/collection/rss.js';
import { collectTopics } from '../modules/collection/collector.service.js';
import { resolveAdapters, SOURCE_CATALOG } from '../modules/collection/sources.js';
import type { SearchResult, SourceAdapter } from '../modules/collection/collection.types.js';

const rss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<item>
  <title><![CDATA[ 大模型进入企业知识库 ]]></title>
  <link>https://example.com/a?utm_source=rss</link>
  <description><![CDATA[<p>多家厂商在同一周发布更新</p>]]></description>
  <pubDate>Tue, 03 Nov 2026 10:20:00 +0800</pubDate>
</item>
<item>
  <title>没有链接的条目</title>
  <description>应当被丢弃</description>
</item>
</channel></rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>RAG 检索层设计</title>
    <link rel="alternate" href="https://example.com/b"/>
    <summary>切片与重排</summary>
    <published>2026-11-02T08:00:00Z</published>
  </entry>
</feed>`;

describe('feed parser', () => {
  it('parses RSS items and drops entries without links', () => {
    const items = parseFeed(rss);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('大模型进入企业知识库');
    expect(items[0].summary).toBe('多家厂商在同一周发布更新');
    expect(items[0].publishedAt).toBe('2026-11-03T02:20:00.000Z');
  });

  it('parses Atom entries', () => {
    const items = parseFeed(atom);
    expect(items[0]).toMatchObject({ title: 'RAG 检索层设计', link: 'https://example.com/b' });
  });
});

describe('source registry', () => {
  it('expands all into the default multi-source set', () => {
    const adapters = resolveAdapters('all');
    expect(adapters?.map((adapter) => adapter.source)).toEqual(['bing', 'hackernews', 'rss']);
  });

  it('accepts comma separated sources and rejects unknown ones', () => {
    expect(resolveAdapters('rss,fixture')?.map((adapter) => adapter.source)).toEqual(['rss', 'fixture']);
    expect(resolveAdapters('unknown')).toBeNull();
  });

  it('exposes every catalog key in the registry', () => {
    expect(SOURCE_CATALOG.map((source) => source.key).sort()).toEqual(['baidu', 'bing', 'fixture', 'hackernews', 'rss']);
  });
});

describe('collectTopics concurrency', () => {
  const fake = (source: string, delay: number): SourceAdapter => ({
    source,
    sourceName: source,
    async search(keyword: string): Promise<SearchResult[]> {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (keyword === 'boom') throw new Error('来源炸了');
      return [{
        source, sourceName: source, keyword,
        title: `${source}-${keyword}`, summary: '', content: '', url: `https://example.com/${source}/${keyword}`,
        publishedAt: null, collectedAt: new Date().toISOString(), fingerprint: `${source}-${keyword}`
      }];
    }
  });

  it('runs sources in parallel and reports per-source counts', async () => {
    const topics = [{ id: 't1', name: 'AI', enabled: true, keywords: [{ value: 'Agent', enabled: true }, { value: 'RAG', enabled: true }] }];
    const startedAt = Date.now();
    const result = await collectTopics(topics, [fake('a', 120), fake('b', 120), fake('c', 120)]);
    expect(Date.now() - startedAt).toBeLessThan(600);
    expect(result.stats).toMatchObject({ topics: 1, keywords: 2, results: 6, bySource: { a: 2, b: 2, c: 2 } });
  });

  it('keeps other sources alive when one fails and dedupes repeated keywords', async () => {
    const topics = [{ id: 't1', name: 'AI', enabled: true, keywords: [{ value: 'Agent', enabled: true }, { value: 'Agent', enabled: true }] }];
    const broken: SourceAdapter = { source: 'bad', sourceName: 'bad', async search() { throw new Error('来源炸了'); } };
    const result = await collectTopics(topics, [fake('ok', 1), broken]);
    expect(result.stats.keywords).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ source: 'bad', keyword: 'Agent', message: '来源炸了' });
    expect(result.data).toHaveLength(1);
  });
});
