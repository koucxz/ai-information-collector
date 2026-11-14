import type { SourceAdapter } from './collection.types.js';
import { settingsStore } from '../../db/client.js';
import { BaiduAdapter } from './baidu.adapter.js';
import { FixtureAdapter } from './fixture.adapter.js';
import { GitHubAdapter } from './github.adapter.js';
import { BaiduIndexedAdapter, BilibiliAdapter, JuejinAdapter } from './public-source.adapter.js';
import { FeedSourceAdapter, mediaFeedSources } from './feed-source.adapter.js';
import { ArxivAdapter, DevtoAdapter, HackerNewsAdapter, LobstersAdapter, StackExchangeAdapter } from './global-source.adapter.js';

export type SourceCatalogEntry = {
  id: string;
  name: string;
  /** 默认勾选：产出稳定的来源才默认开启，避免一轮采集被空结果和噪声拖慢。 */
  defaultOn: boolean;
  hint?: string;
  /** 设置页分组：平台、媒体、其他；仅用于展示，不影响采集。 */
  group: 'platform' | 'media' | 'other';
};

// fixture 适配器保留供本地测试使用，但不再作为可选采集来源暴露给前端
const platformSources: SourceCatalogEntry[] = [
  { id: 'juejin', name: '掘金', defaultOn: true, group: 'platform' },
  { id: 'bilibili', name: 'B 站', defaultOn: true, group: 'platform' },
  { id: 'github', name: 'GitHub', defaultOn: true, group: 'platform', hint: '仓库更新与 Release；未配置 Token 时每分钟最多 10 次搜索' },
  { id: 'hackernews', name: 'Hacker News', defaultOn: true, group: 'platform', hint: '近 30 天技术社区讨论，按关键词检索' },
  { id: 'arxiv', name: 'arXiv', defaultOn: true, group: 'platform', hint: '最新论文，适合跟踪模型与研究进展' },
  { id: 'stackoverflow', name: 'Stack Overflow', defaultOn: true, group: 'platform', hint: '工程问答，偏部署与排错' },
  { id: 'devto', name: 'DEV Community', defaultOn: true, group: 'platform', hint: '英文开发者博客' },
  { id: 'lobsters', name: 'Lobsters', defaultOn: true, group: 'platform', hint: '高质量技术社区，量小但信噪比高' }
];

// 媒体按站点拆开，各自独立勾选；零产出的站点已剔除
const mediaSources: SourceCatalogEntry[] = mediaFeedSources.map(({ id, name, defaultOn, hint }) => ({ id, name, defaultOn, hint, group: 'media' as const }));

const noisySources: SourceCatalogEntry[] = [
  { id: 'baidu', name: '百度', defaultOn: false, group: 'other', hint: '网页检索结果，百科与聚合页较多' },
  { id: 'weibo', name: '微博', defaultOn: false, group: 'other', hint: '经公开索引抓取，经常没有结果' },
  { id: 'zhihu', name: '知乎', defaultOn: false, group: 'other', hint: '经公开索引抓取，经常没有结果' }
];

export const sourceCatalog: SourceCatalogEntry[] = [...platformSources, ...mediaSources, ...noisySources];

export const defaultSourceIds = sourceCatalog.filter((source) => source.defaultOn).map((source) => source.id);

export const COLLECTION_SOURCES_KEY = 'collection.sources';

/** 采集来源：先用设置页保存的选择，没有保存过或全部失效才回落到默认集合。 */
export const resolveCollectionSources = (): string[] => {
  const saved = settingsStore.get<string[]>(COLLECTION_SOURCES_KEY);
  const valid = (Array.isArray(saved) ? saved : [])
    .filter((id): id is string => typeof id === 'string' && sourceCatalog.some((source) => source.id === id));
  return valid.length ? [...new Set(valid)] : [...defaultSourceIds];
};

const factories: Record<string, () => SourceAdapter> = {
  fixture: () => new FixtureAdapter(),
  baidu: () => new BaiduAdapter(),
  bilibili: () => new BilibiliAdapter(),
  weibo: () => new BaiduIndexedAdapter('weibo'),
  zhihu: () => new BaiduIndexedAdapter('zhihu'),
  juejin: () => new JuejinAdapter(),
  github: () => new GitHubAdapter(),
  hackernews: () => new HackerNewsAdapter(),
  arxiv: () => new ArxivAdapter(),
  stackoverflow: () => new StackExchangeAdapter(),
  devto: () => new DevtoAdapter(),
  lobsters: () => new LobstersAdapter(),
  ...Object.fromEntries(mediaFeedSources.map((source) => [
    source.id,
    () => new FeedSourceAdapter({ source: source.id, sourceName: source.name, feeds: [source.feed] })
  ]))
};

export const createSourceAdapters = (sources: string[]) => {
  const unknown = sources.filter((source) => !(source in factories));
  if (unknown.length) return { adapters: [], unknown };
  return { adapters: [...new Set(sources)].map((source) => factories[source]()), unknown: [] };
};
