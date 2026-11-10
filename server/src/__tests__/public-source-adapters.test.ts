import { describe, expect, it } from 'vitest';
import { BaiduIndexedAdapter, BilibiliAdapter, JuejinAdapter, parseBilibiliHtmlResults, parseBilibiliResults, parseJuejinResults, parsePublicHtmlResults, PublicHtmlAdapter } from '../modules/collection/public-source.adapter.js';
import { createSourceAdapters } from '../modules/collection/source.registry.js';

describe('domestic public source adapters', () => {
  it('parses Bilibili search data', () => {
    const results = parseBilibiliResults({ data: { result: [{ title: '<em>AI</em> 工具', description: '视频介绍', arcurl: '//www.bilibili.com/video/BV1abc', pubdate: 1_700_000_000 }] } }, 'AI');
    expect(results[0]).toMatchObject({ source: 'bilibili', sourceName: 'B 站', title: 'AI 工具', url: 'https://www.bilibili.com/video/BV1abc' });
  });

  it('parses Bilibili search HTML and canonicalizes video links', () => {
    const html = '<a href="//www.bilibili.com/video/BV1uNk1YxEJQ/?spm_id_from=1"><h3 title="AI 大模型教程">AI <em>大模型</em>教程</h3></a>';
    expect(parseBilibiliHtmlResults(html, '大模型')[0]).toMatchObject({ title: 'AI 大模型教程', url: 'https://www.bilibili.com/video/BV1uNk1YxEJQ' });
  });

  it('parses Juejin public search data', () => {
    const payload = { data: [{ result_type: 2, result_model: { article_id: '123', article_info: { article_id: '123', title: '大模型工程实践', brief_content: '文章摘要', ctime: '1700000000' } } }] };
    expect(parseJuejinResults(payload, '大模型')[0]).toMatchObject({ source: 'juejin', title: '大模型工程实践', url: 'https://juejin.cn/post/123' });
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
    const fetcher: typeof fetch = async () => new Response('<html></html>', { status: 200 });
    await expect(new BilibiliAdapter(fetcher).search('AI')).resolves.toEqual([]);
    await expect(new PublicHtmlAdapter('juejin', async () => new Response('<html></html>')).search('AI')).resolves.toEqual([]);
    await expect(new BaiduIndexedAdapter('zhihu', fetcher).search('AI')).resolves.toEqual([]);
    await expect(new JuejinAdapter(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })).search('AI')).resolves.toEqual([]);
    expect(createSourceAdapters(['baidu', 'weibo']).adapters).toHaveLength(2);
    expect(createSourceAdapters(['missing']).unknown).toEqual(['missing']);
  });
});

