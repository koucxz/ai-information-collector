import { describe, expect, it } from 'vitest';
import { BilibiliAdapter, parseBilibiliResults, parsePublicHtmlResults, PublicHtmlAdapter } from '../modules/collection/public-source.adapter.js';
import { createSourceAdapters } from '../modules/collection/source.registry.js';

describe('domestic public source adapters', () => {
  it('parses Bilibili search data', () => {
    const results = parseBilibiliResults({ data: { result: [{ title: '<em>AI</em> 工具', description: '视频介绍', arcurl: '//www.bilibili.com/video/BV1abc', pubdate: 1_700_000_000 }] } }, 'AI');
    expect(results[0]).toMatchObject({ source: 'bilibili', sourceName: 'B 站', title: 'AI 工具', url: 'https://www.bilibili.com/video/BV1abc' });
  });

  it.each([
    ['weibo', '微博', '<a href="//weibo.com/123/detail/abc" title="微博热议">查看</a>', /weibo\.com/],
    ['zhihu', '知乎', '<a href="/question/123/answer/456"><span>知乎回答</span></a>', /zhihu\.com/],
    ['juejin', '掘金', '<a href="https://juejin.cn/post/123">工程文章</a>', /juejin\.cn/]
  ])('parses %s public links', (source, sourceName, html, urlPattern) => {
    const config = source === 'weibo'
      ? { source, sourceName, baseUrl: 'https://s.weibo.com', includePath: /weibo\.com\/(?:\d+|detail)\// }
      : source === 'zhihu'
        ? { source, sourceName, baseUrl: 'https://www.zhihu.com', includePath: /zhihu\.com\/(?:question|answer|p)\// }
        : { source, sourceName, baseUrl: 'https://juejin.cn', includePath: /juejin\.cn\/post\// };
    const results = parsePublicHtmlResults(html, 'AI', config);
    expect(results[0]).toMatchObject({ source, sourceName });
    expect(results[0].url).toMatch(urlPattern);
  });

  it('uses timeout-aware requests and validates the source registry', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ data: { result: [] } }), { status: 200 });
    await expect(new BilibiliAdapter(fetcher).search('AI')).resolves.toEqual([]);
    await expect(new PublicHtmlAdapter('juejin', async () => new Response('<html></html>')).search('AI')).resolves.toEqual([]);
    expect(createSourceAdapters(['baidu', 'weibo']).adapters).toHaveLength(2);
    expect(createSourceAdapters(['missing']).unknown).toEqual(['missing']);
  });
});

