import { env } from '../../config/env.js';
import type { SearchResult, SourceAdapter } from './collection.types.js';
import { normalizeResult } from './normalize.js';

type GitHubRepository = { full_name: string; html_url: string; description: string | null; updated_at: string };
type GitHubIssue = { title: string; html_url: string; body: string | null; updated_at: string; pull_request?: unknown; repository_url?: string };
type GitHubRelease = { name: string | null; tag_name: string; html_url: string; body: string | null; published_at: string | null };

export const mapGitHubRepositories = (items: GitHubRepository[], keyword: string): SearchResult[] => items.map((item) =>
  normalizeResult({ source: 'github', sourceName: 'GitHub', keyword, title: item.full_name, summary: item.description ?? '', content: item.description ?? item.full_name, url: item.html_url, publishedAt: item.updated_at })
);

export const mapGitHubIssues = (items: GitHubIssue[], keyword: string): SearchResult[] => items.filter((item) => !item.pull_request).map((item) =>
  normalizeResult({ source: 'github', sourceName: 'GitHub', keyword, title: item.title, summary: item.body?.slice(0, 300) ?? '', content: item.body ?? item.title, url: item.html_url, publishedAt: item.updated_at })
);

export const mapGitHubReleases = (items: GitHubRelease[], keyword: string, repository: string): SearchResult[] => items.map((item) =>
  normalizeResult({ source: 'github', sourceName: 'GitHub', keyword, title: `${repository} ${item.name || item.tag_name}`, summary: item.body?.slice(0, 300) ?? '', content: item.body ?? item.tag_name, url: item.html_url, publishedAt: item.published_at })
);

export class GitHubAdapter implements SourceAdapter {
  source = 'github';
  sourceName = 'GitHub';
  // 未登录时搜索接口只有 10 次/分钟，单次采集只用前几个关键词，避免整轮 403
  maxQueries = 5;
  constructor(private readonly token = env.GITHUB_TOKEN, private readonly timeoutMs = 8_000, private readonly fetcher: typeof fetch = fetch) {}

  private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const response = await this.fetcher(`https://api.github.com${path}`, {
        signal: combinedSignal,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SignalDock/1.0', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }
      });
      if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
      return await response.json() as T;
    } finally { clearTimeout(timer); }
  }

  async search(keyword: string, options: { signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const query = encodeURIComponent(keyword);
    // 只保留仓库与 release：issue 里大量是提问和模板噪声，会稀释信息流质量
    const repositories = await this.request<{ items?: GitHubRepository[] }>(`/search/repositories?q=${query}&sort=updated&order=desc&per_page=8`, options.signal);
    const repositoryItems = repositories.items ?? [];
    const releaseRequests = await Promise.allSettled(repositoryItems.slice(0, 2).map(async (repository) => ({
      repository: repository.full_name,
      releases: await this.request<GitHubRelease[]>(`/repos/${repository.full_name}/releases?per_page=2`, options.signal)
    })));
    const releases = releaseRequests.flatMap((request) => request.status === 'fulfilled' ? mapGitHubReleases(request.value.releases, keyword, request.value.repository) : []);
    return [...mapGitHubRepositories(repositoryItems, keyword), ...releases];
  }
}

