import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { SearchResult, SourceAdapter } from './collection.types.js';
import { normalizeResult } from './normalize.js';

type FixtureItem = { title: string; summary?: string; content?: string; url: string; publishedAt?: string; keywords?: string[] };

export class FixtureAdapter implements SourceAdapter {
  source = 'fixture';
  sourceName = '本地测试数据';
  constructor(private readonly filePath = resolve(process.cwd(), '..', 'skills', 'hot-monitor', 'fixtures', 'hot-topics.json')) {}

  async search(keyword: string): Promise<SearchResult[]> {
    const items = JSON.parse(await readFile(this.filePath, 'utf8')) as FixtureItem[];
    const query = keyword.toLocaleLowerCase();
    return items.filter((item) => [item.title, item.summary, item.content, ...(item.keywords ?? [])].join(' ').toLocaleLowerCase().includes(query)).map((item) => normalizeResult({ source: this.source, sourceName: this.sourceName, keyword, title: item.title, summary: item.summary ?? '', content: item.content ?? item.summary ?? '', url: item.url, publishedAt: item.publishedAt ?? null }));
  }
}
