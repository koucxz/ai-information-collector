import type { SourceAdapter } from './collection.types.js';
import { BaiduAdapter } from './baidu.adapter.js';
import { FixtureAdapter } from './fixture.adapter.js';
import { BilibiliAdapter, PublicHtmlAdapter } from './public-source.adapter.js';

export const sourceCatalog = [
  { id: 'fixture', name: '本地测试数据' },
  { id: 'baidu', name: '百度' },
  { id: 'bilibili', name: 'B 站' },
  { id: 'weibo', name: '微博' },
  { id: 'zhihu', name: '知乎' },
  { id: 'juejin', name: '掘金' }
] as const;

type SourceId = typeof sourceCatalog[number]['id'];
const factories: Record<SourceId, () => SourceAdapter> = {
  fixture: () => new FixtureAdapter(),
  baidu: () => new BaiduAdapter(),
  bilibili: () => new BilibiliAdapter(),
  weibo: () => new PublicHtmlAdapter('weibo'),
  zhihu: () => new PublicHtmlAdapter('zhihu'),
  juejin: () => new PublicHtmlAdapter('juejin')
};

export const createSourceAdapters = (sources: string[]) => {
  const unknown = sources.filter((source) => !(source in factories));
  if (unknown.length) return { adapters: [], unknown };
  return { adapters: [...new Set(sources)].map((source) => factories[source as SourceId]()), unknown: [] };
};

