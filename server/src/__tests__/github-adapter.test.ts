import { describe, expect, it } from 'vitest';
import { GitHubAdapter, mapGitHubIssues, mapGitHubReleases, mapGitHubRepositories } from '../modules/collection/github.adapter.js';

describe('GitHub adapter', () => {
  it('maps repositories, releases and issues into information', () => {
    expect(mapGitHubRepositories([{ full_name: 'demo/ai', html_url: 'https://github.com/demo/ai', description: 'AI 项目', updated_at: '2026-10-17T00:00:00Z' }], 'AI')[0]).toMatchObject({ title: 'demo/ai', source: 'github' });
    expect(mapGitHubReleases([{ name: 'Version 1', tag_name: 'v1', html_url: 'https://github.com/demo/ai/releases/tag/v1', body: '更新', published_at: '2026-10-17T01:00:00Z' }], 'AI', 'demo/ai')[0].title).toContain('Version 1');
    expect(mapGitHubIssues([{ title: 'Issue', html_url: 'https://github.com/demo/ai/issues/1', body: '问题', updated_at: '2026-10-17T02:00:00Z' }, { title: 'PR', html_url: 'https://github.com/demo/ai/pull/2', body: null, updated_at: '2026-10-17T02:00:00Z', pull_request: {} }], 'AI')).toHaveLength(1);
  });

  it('collects repository and release results and sends a token', async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, authorization: (init?.headers as Record<string, string>)?.Authorization });
      if (url.includes('/search/repositories')) return Response.json({ items: [{ full_name: 'demo/ai', html_url: 'https://github.com/demo/ai', description: 'AI', updated_at: '2026-10-17T00:00:00Z' }] });
      return Response.json([{ name: 'v1', tag_name: 'v1', html_url: 'https://github.com/demo/ai/releases/tag/v1', body: 'AI', published_at: '2026-10-17T00:00:00Z' }]);
    };
    const results = await new GitHubAdapter('token', 1_000, fetcher).search('AI');
    expect(results).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.authorization === 'Bearer token')).toBe(true);
    // 未登录时搜索接口限流，单次采集只用前 5 个关键词
    expect(new GitHubAdapter(undefined, 1_000, fetcher).maxQueries).toBe(5);
  });

  it('keeps repository and issue results when release lookup fails', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/search/repositories')) return Response.json({ items: [{ full_name: 'demo/ai', html_url: 'https://github.com/demo/ai', description: null, updated_at: '2026-10-17T00:00:00Z' }] });
      if (url.includes('/search/issues')) return Response.json({ items: [] });
      return new Response('', { status: 500 });
    };
    await expect(new GitHubAdapter(undefined, 1_000, fetcher).search('AI')).resolves.toHaveLength(1);
  });
});

