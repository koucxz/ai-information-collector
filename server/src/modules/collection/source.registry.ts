import type { SourceAdapter } from './collection.types.js';
import { BaiduAdapter } from './baidu.adapter.js';
import { FixtureAdapter } from './fixture.adapter.js';
import { GitHubAdapter } from './github.adapter.js';
import { BaiduIndexedAdapter, BilibiliAdapter, JuejinAdapter } from './public-source.adapter.js';
import { CHINESE_TECH_MEDIA, FeedSourceAdapter, FOREIGN_TECH_MEDIA } from './feed-source.adapter.js';
import { ArxivAdapter, DevtoAdapter, HackerNewsAdapter, LobstersAdapter, StackExchangeAdapter } from './global-source.adapter.js';

export type SourceCatalogEntry = {
  id: string;
  name: string;
  /** 默认勾选：产出稳定的来源才默认开启，避免一轮采集被空结果和噪声拖慢。 */
  defaultOn: boolean;
  hint?: string;
};

// fixture 适配器保留供本地测试使用，但不再作为可选采集来源暴露给前端
export const sourceCatalog: SourceCatalogEntry[] = [
  { id: 'juejin', name: '掘金', defaultOn: true },
  { id: 'bilibili', name: 'B 站', defaultOn: true },
  { id: 'github', name: 'GitHub', defaultOn: true, hint: '仓库更新与 Release；未配置 Token 时每分钟最多 10 次搜索' },
  { id: 'hackernews', name: 'Hacker News', defaultOn: true, hint: '近 30 天技术社区讨论，按关键词检索' },
  { id: 'arxiv', name: 'arXiv', defaultOn: true, hint: '最新论文，适合跟踪模型与研究进展' },
  { id: 'stackoverflow', name: 'Stack Overflow', defaultOn: true, hint: '工程问答，偏部署与排错' },
  { id: 'devto', name: 'DEV Community', defaultOn: true, hint: '英文开发者博客' },
  { id: 'lobsters', name: 'Lobsters', defaultOn: true, hint: '高质量技术社区，量小但信噪比高' },
  { id: 'tech-media', name: '国外科技媒体', defaultOn: true, hint: 'TechCrunch / The Verge / MIT 科技评论 / Wired / GitHub 博客 / OpenAI' },
  { id: 'cn-media', name: '中文科技媒体', defaultOn: true, hint: '少数派 / IT之家 / 量子位 / 开源中国 / Solidot / 雷峰网 / 钛媒体' },
  { id: 'baidu', name: '百度', defaultOn: false, hint: '网页检索结果，百科与聚合页较多' },
  { id: 'weibo', name: '微博', defaultOn: false, hint: '经公开索引抓取，经常没有结果' },
  { id: 'zhihu', name: '知乎', defaultOn: false, hint: '经公开索引抓取，经常没有结果' }
];

export const defaultSourceIds = sourceCatalog.filter((source) => source.defaultOn).map((source) => source.id);

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
  'tech-media': () => new FeedSourceAdapter({ source: 'tech-media', sourceName: '国外科技媒体', feeds: FOREIGN_TECH_MEDIA }),
  'cn-media': () => new FeedSourceAdapter({ source: 'cn-media', sourceName: '中文科技媒体', feeds: CHINESE_TECH_MEDIA })
};

export const createSourceAdapters = (sources: string[]) => {
  const unknown = sources.filter((source) => !(source in factories));
  if (unknown.length) return { adapters: [], unknown };
  return { adapters: [...new Set(sources)].map((source) => factories[source]()), unknown: [] };
};
