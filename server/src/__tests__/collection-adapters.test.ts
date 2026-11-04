import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FixtureAdapter } from '../modules/collection/fixture.adapter.js';
import { createLimiter } from '../modules/collection/http.js';
import { mapNewsflashItems } from '../modules/collection/kr36.adapter.js';
import { parseSo360Results } from '../modules/collection/so360.adapter.js';

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

  it('parses 360 results and prefers the real target over the redirect link', () => {
    const html = [
      '<li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=abc" data-mdurl="https://blog.csdn.net/a/1">什么是<em>大模型</em></a></h3><p class="res-desc">一段摘要</p></li>',
      '<li class="res-list"><h3 class="res-title"><a href="https://hao.360.com/?src=so">360 导航</a></h3></li>',
      '<li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=def" data-mdurl="https://blog.csdn.net/a/1">什么是大模型</a></h3></li>'
    ].join('');
    const results = parseSo360Results(html, '大模型');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: 'so360', title: '什么是大模型', url: 'https://blog.csdn.net/a/1' });
  });

  it('maps 36kr newsflash payloads to items with real links', () => {
    const items = mapNewsflashItems([
      { itemId: 4055156798411652, itemType: 20, templateMaterial: { widgetTitle: '赛微微电：拟增持', widgetContent: '36氪获悉', publishTime: 1793779128810, authorName: '36氪' } },
      { itemId: 4053676712891526, itemType: 10, templateMaterial: { widgetTitle: 'Anthropic 新模型', publishTime: 1793693629107 } },
      { itemId: 1, templateMaterial: {} }
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].url).toBe('https://36kr.com/newsflashes/4055156798411652');
    expect(items[1].url).toBe('https://36kr.com/p/4053676712891526');
    expect(items[0].publishedAt).toBe(new Date(1793779128810).toISOString());
  });

  it('serializes requests through the limiter', async () => {
    const limit = createLimiter(5);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((value) => limit(async () => {
      order.push(value);
      await new Promise((resolve) => setTimeout(resolve, 15));
    })));
    expect(order).toEqual([1, 2, 3]);
  });
});
