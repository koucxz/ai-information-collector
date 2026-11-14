import { describe, expect, it } from 'vitest';
import { parseFeedEntries, FeedSourceAdapter } from '../modules/collection/feed-source.adapter.js';
import { DevtoAdapter, HackerNewsAdapter, LobstersAdapter, mapHackerNews, mapStackExchange, StackExchangeAdapter } from '../modules/collection/global-source.adapter.js';
import { matchesQuery, primaryQuery, queryVariants } from '../modules/collection/query-terms.js';
import { collectTopics } from '../modules/collection/collector.service.js';
import { createSourceAdapters, defaultSourceIds, sourceCatalog } from '../modules/collection/source.registry.js';
import type { SourceAdapter, TopicConfig } from '../modules/collection/collection.types.js';

const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<item><title><![CDATA[Cursor 1.0 发布，Agent 模式上线]]></title><link>https://example.com/cursor</link><description><![CDATA[<p>AI 编程工具 &amp; 大模型更新</p>]]></description><pubDate>Fri, 13 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Docker 部署实践</title><link>/post/docker</link><description>容器化部署</description><pubDate>Thu, 12 Nov 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;

const atom = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title type="html"><![CDATA[Introducing ChatGPT Wallet]]></title><link rel="alternate" type="text/html" href="https://example.com/wallet"/><summary type="html"><![CDATA[<p>A secure way for agents to complete purchases.</p>]]></summary><published>2026-11-13T15:00:00Z</published></entry>
</feed>`;

describe('feed parsing', () => {
  it('parses RSS items with CDATA, entities and relative links', () => {
    const entries = parseFeedEntries(rss, 10, 'https://example.com');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ title: 'Cursor 1.0 发布，Agent 模式上线', url: 'https://example.com/cursor', publishedAt: '2026-11-13T10:00:00.000Z' });
    expect(entries[0].summary).toBe('AI 编程工具 & 大模型更新');
    expect(entries[1].url).toBe('https://example.com/post/docker');
  });

  it('parses Atom entries', () => {
    const entries = parseFeedEntries(atom, 10, 'https://example.com');
    expect(entries[0]).toMatchObject({ title: 'Introducing ChatGPT Wallet', url: 'https://example.com/wallet', publishedAt: '2026-11-13T15:00:00.000Z' });
    expect(entries[0].summary).toContain('agents');
  });
});

describe('query terms', () => {
  it('maps Chinese keywords to English search terms', () => {
    expect(primaryQuery('大模型')).toBe('large language model');
    expect(queryVariants('大模型')).toContain('llm');
    expect(queryVariants('GPT')).toContain('chatgpt');
    expect(matchesQuery('Qwen3-VL 多模态模型发布', 'Qwen')).toBe(true);
    expect(matchesQuery('Introducing ChatGPT Wallet', 'GPT')).toBe(true);
    expect(matchesQuery('maintain the database', 'AI')).toBe(false);
  });
});

describe('global source adapters', () => {
  it('maps Hacker News stories with a discussion fallback', () => {
    const results = mapHackerNews([
      { objectID: '1', title: 'Show HN: Cursor', url: 'https://example.com/show', points: 42, num_comments: 7, created_at: '2026-11-13T10:00:00Z' },
      { objectID: '2', title: 'Ask HN: how do agents work', story_text: '<p>Question body</p>', created_at: '2026-11-13T11:00:00Z' }
    ], 'Cursor');
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ source: 'hackernews', sourceName: 'Hacker News', url: 'https://example.com/show' });
    expect(results[0].summary).toBe('42 分 · 7 条评论 · Hacker News');
    expect(results[1].url).toBe('https://news.ycombinator.com/item?id=2');
    expect(results[1].summary).toBe('Question body');
  });

  it('maps Stack Overflow questions', () => {
    const results = mapStackExchange([{ title: 'How to deploy &amp; scale Docker', link: 'https://stackoverflow.com/q/1', body: '<p>body</p>', creation_date: 1_700_000_000, score: 5, answer_count: 2 }], 'Docker');
    expect(results[0]).toMatchObject({ source: 'stackoverflow', sourceName: 'Stack Overflow', title: 'How to deploy & scale Docker' });
    expect(results[0].publishedAt).toBe('2023-11-14T22:13:20.000Z');
  });

  it('filters cached dev.to articles by keyword', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return Response.json([
        { title: 'Cursor tips', description: 'AI coding', url: 'https://dev.to/a', published_at: '2026-11-13T00:00:00Z', tag_list: ['ai'] },
        { title: 'Rails notes', description: 'Ruby', url: 'https://dev.to/b', published_at: '2026-11-12T00:00:00Z', tag_list: ['ruby'] }
      ]);
    };
    const adapter = new DevtoAdapter(fetcher, 1_000);
    expect(await adapter.search('Cursor')).toHaveLength(1);
    expect(await adapter.search('Docker')).toHaveLength(0);
    expect(calls).toBe(1);
  });

  it('filters lobsters tag feeds by keyword', async () => {
    const fetcher: typeof fetch = async () => Response.json([
      { short_id: 'abc', title: 'Running agents in production', url: '', description: 'Agent deployment notes', created_at: '2026-11-13T00:00:00Z', score: '3', comment_count: '1', tags: ['ai'] }
    ]);
    const adapter = new LobstersAdapter(fetcher, 1_000);
    const results = await adapter.search('Agent');
    expect(results[0]).toMatchObject({ source: 'lobsters', url: 'https://lobste.rs/s/abc' });
    expect(results[0].summary).toBe('Agent deployment notes');
  });

  it('fetches each feed once per adapter and keeps outlet names', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return new Response(url.includes('a.example') ? rss : atom);
    };
    const adapter = new FeedSourceAdapter({
      source: 'tech-media', sourceName: '国外科技媒体',
      feeds: [{ name: 'A 站', url: 'https://a.example/feed', siteUrl: 'https://a.example' }, { name: 'B 站', url: 'https://b.example/feed', siteUrl: 'https://b.example' }]
    }, fetcher, 1_000);
    const cursor = await adapter.search('Cursor');
    const llm = await adapter.search('大模型');
    expect(calls).toHaveLength(2);
    expect(cursor[0].sourceName).toBe('A 站');
    expect(cursor[0].source).toBe('tech-media');
    expect(llm.length).toBeGreaterThan(0);
  });

  it('uses real HTTP adapters with a fake transport', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('hn.algolia.com')) return Response.json({ hits: [{ objectID: '1', title: 'Cursor is fast', url: 'https://example.com/c', points: 1, num_comments: 0, created_at: '2026-11-13T00:00:00Z' }] });
      if (url.includes('api.stackexchange.com')) return Response.json({ items: [] });
      return Response.json([]);
    };
    expect((await new HackerNewsAdapter(fetcher, 1_000).search('Cursor'))[0].title).toBe('Cursor is fast');
    await expect(new StackExchangeAdapter(fetcher, 1_000).search('Cursor')).resolves.toEqual([]);
  });
});

describe('source catalog and quotas', () => {
  it('exposes high-quality foreign sources by default and keeps noisy ones opt-in', () => {
    const ids = sourceCatalog.map((source) => source.id);
    for (const id of ['hackernews', 'arxiv', 'stackoverflow', 'devto', 'lobsters', 'tech-media', 'cn-media']) expect(ids).toContain(id);
    expect(sourceCatalog.find((source) => source.id === 'baidu')?.defaultOn).toBe(false);
    expect(sourceCatalog.find((source) => source.id === 'weibo')?.defaultOn).toBe(false);
    expect(defaultSourceIds).not.toContain('zhihu');
    expect(createSourceAdapters(['hackernews', 'tech-media']).adapters).toHaveLength(2);
  });

  it('honours maxQueries so rate-limited sources do not burn the whole keyword list', async () => {
    const calls: string[] = [];
    const adapter: SourceAdapter = {
      source: 'limited', sourceName: '受限来源', maxQueries: 2,
      async search(keyword) { calls.push(keyword); return []; }
    };
    const topics: TopicConfig[] = [{ id: 't', name: 'AI', enabled: true, keywords: [{ value: 'A', enabled: true }, { value: 'B', enabled: true }, { value: 'C', enabled: true }] }];
    const result = await collectTopics(topics, [adapter]);
    expect(calls).toEqual(['A', 'B']);
    expect(result.sourceStats[0]).toMatchObject({ source: 'limited', attempts: 2, successes: 2, failures: 0 });
  });
});
