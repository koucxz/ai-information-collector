import type { SourceAdapter } from './collection.types.js';
import { FixtureAdapter } from './fixture.adapter.js';
import { HackerNewsAdapter } from './hackernews.adapter.js';
import { JuejinAdapter } from './juejin.adapter.js';
import { Kr36Adapter } from './kr36.adapter.js';
import { RssFeedAdapter } from './rss-feed.adapter.js';
import { So360Adapter } from './so360.adapter.js';
import { V2exAdapter } from './v2ex.adapter.js';

export type SourceInfo = {
  key: string;
  name: string;
  kind: 'search' | 'feed' | 'demo';
  description: string;
  enabled: boolean;
};

/** 前端「信息来源」直接用这份清单渲染，不再写死 */
export const SOURCE_CATALOG: SourceInfo[] = [
  { key: 'juejin', name: '掘金', kind: 'search', description: '按关键词搜索中文技术文章', enabled: true },
  { key: 'kr36', name: '36氪', kind: 'feed', description: '网关快讯流，按关键词过滤', enabled: true },
  { key: 'so360', name: '360 搜索', kind: 'search', description: '中文网页检索（替代已风控的百度），结果无发布时间，按需启用', enabled: true },
  { key: 'rss', name: '站点 RSS', kind: 'feed', description: 'IT之家 / 极客公园 / 爱范儿 / 量子位 / 钛媒体 / 雷锋网 / 新浪科技 / InfoQ / 开源中国 / 少数派 / Solidot', enabled: true },
  { key: 'v2ex', name: 'V2EX', kind: 'search', description: '开发者社区讨论（走 sov2ex 镜像）', enabled: true },
  { key: 'hackernews', name: 'Hacker News', kind: 'search', description: '英文技术社区最新讨论', enabled: true },
  { key: 'fixture', name: '本地测试数据', kind: 'demo', description: '离线演示用的固定样例', enabled: true }
];

// 采集时默认跑的源；fixture 需要显式指定
// so360 没有发布时间，进默认集合会把真实新闻挤到后面，只在 ?source=so360 时单独跑
export const DEFAULT_SOURCE_KEYS = ['juejin', 'kr36', 'rss', 'v2ex', 'hackernews'];

// RSS / 36氪适配器带抓取缓存，必须复用实例，否则每个关键词都会重新抓一遍
let rssInstance: RssFeedAdapter | null = null;
let kr36Instance: Kr36Adapter | null = null;

const registry: Record<string, () => SourceAdapter> = {
  juejin: () => new JuejinAdapter(),
  kr36: () => {
    if (!kr36Instance) kr36Instance = new Kr36Adapter();
    return kr36Instance;
  },
  so360: () => new So360Adapter(),
  rss: () => {
    if (!rssInstance) rssInstance = new RssFeedAdapter();
    return rssInstance;
  },
  v2ex: () => new V2exAdapter(),
  hackernews: () => new HackerNewsAdapter(),
  fixture: () => new FixtureAdapter()
};

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
