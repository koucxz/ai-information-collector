import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/client.js';
import { fallbackAnalyze } from '../modules/analysis/analysis.service.js';
import { analyzeInformation } from '../modules/analysis/analysis.service.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';
import request from 'supertest';
import { app } from '../app.js';

beforeEach(() => db.exec('DELETE FROM information_changes; DELETE FROM information_snapshots; DELETE FROM information_items; DELETE FROM keywords; DELETE FROM topics;'));

describe('information analysis', () => {
  it('uses a deterministic local fallback without an API key', async () => {
    const result = fallbackAnalyze({ title: '开源 AI 工具发布', summary: '', content: '人工智能工具提升性能。', keyword: '人工智能' });
    expect(result.provider).toBe('fallback');
    expect(result.relevanceScore).toBeGreaterThan(0.8);
    expect(result.summary).toContain('人工智能');
    expect((await analyzeInformation({ title: 'AI', summary: '摘要', content: '正文', keyword: 'AI' })).provider).toBe('fallback');
  });

  it('persists analysis through the API', async () => {
    const item = normalizeResult({ source: 'fixture', sourceName: '本地测试数据', keyword: 'AI', title: 'AI 工具', summary: '工具摘要', content: '工具正文', url: 'https://example.com/analysis', publishedAt: null });
    informationStore.saveResults([item]);
    const stored = informationStore.list()[0];
    const response = await request(app).post(`/api/information/${stored.id}/analyze`);
    expect(response.status).toBe(200);
    expect(response.body.analysis.provider).toBe('fallback');
    expect(response.body.data.aiStatus).toBe('fallback');
  });
});
