import { BaiduAdapter } from './baidu.adapter.js';
import type { SourceAdapter } from './collection.types.js';
import { FixtureAdapter } from './fixture.adapter.js';
import { HackerNewsAdapter } from './hackernews.adapter.js';
import { JuejinAdapter } from './juejin.adapter.js';
import { RssFeedAdapter } from './rss-feed.adapter.js';
import { V2exAdapter } from './v2ex.adapter.js';

export type SourceInfo = {
  key: string;
  name: string;
  kind: 'search' | 'feed' | 'demo' | 'legacy';
  description: string;
  enabled: boolean;
};

/** 前端「信息来源」直接用这份清单渲染，不再写死 */
export const SOURCE_CATALOG: SourceInfo[] = [
  { key: 'juejin', name: '掘金', kind: 'search', description: '按关键词搜索中文技术文章', enabled: true },
  { key: 'rss', name: '站点 RSS', kind: 'feed', description: 'IT之家 / 极客公园 / 爱范儿 / 量子位 / InfoQ / 开源中国 / 少数派 / Solidot', enabled: true },
  { key: 'v2ex', name: 'V2EX', kind: 'search', description: '开发者社区讨论', enabled: true },
  { key: 'hackernews', name: 'Hacker News', kind: 'search', description: '英文技术社区最新讨论', enabled: true },
  { key: 'baidu', name: '百度', kind: 'legacy', description: '网页抓取，风控拦截时本轮为空', enabled: true },
  { key: 'fixture', name: '本地测试数据', kind: 'demo', description: '离线演示用的固定样例', enabled: true }
];

// 采集时默认跑的源；fixture / baidu 需要显式指定
export const DEFAULT_SOURCE_KEYS = ['juejin', 'rss', 'v2ex', 'hackernews'];

const registry: Record<string, () => SourceAdapter> = {
  juejin: () => new JuejinAdapter(),
  rss: rssSingleton,
  v2ex: () => new V2exAdapter(),
  hackernews: () => new HackerNewsAdapter(),
  baidu: () => new BaiduAdapter(),
  fixture: () => new FixtureAdapter()
};

// RSS 适配器带 5 分钟抓取缓存，必须复用实例
let rssInstance: RssFeedAdapter | null = null;
function rssSingleton() {
  if (!rssInstance) rssInstance = new RssFeedAdapter();
  return rssInstance;
}

export const knownSources = () => Object.keys(registry);

/** 解析 ?source= 参数：all 走默认集合，也支持 a,b 多选 */
export const resolveAdapters = (source: string): SourceAdapter[] | null => {
  const keys = source === 'all' || source === ''
    ? DEFAULT_SOURCE_KEYS
    : source.split(',').map((key) => key.trim()).filter(Boolean);
  if (keys.length === 0) return null;
  if (keys.some((key) => !registry[key])) return null;
  return keys.map((key) => registry[key]());
};
