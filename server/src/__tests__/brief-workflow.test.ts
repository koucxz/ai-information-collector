import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from '../test/authenticated-request.js';
import { app } from '../app.js';
import { db } from '../db/client.js';
import { env } from '../config/env.js';
import { informationStore } from '../modules/collection/information.store.js';
import { normalizeResult } from '../modules/collection/normalize.js';
import { createBackup, restoreBackup } from '../modules/data/data.service.js';
import { generateBriefs, validateModelDrafts } from '../modules/briefs/brief.service.js';
import type { Brief, SourceSnapshot } from '../modules/briefs/brief.schemas.js';

const seed = () => {
  informationStore.saveResults(['垂直 Agent 新进展', 'Agent 的评估与成本'].map((title, index) => normalizeResult({ source: 'fixture', sourceName: '测试来源', keyword: 'AI Agent', title, summary: '需要对照原文核验', content: '公开片段', url: `https://www.example.com/brief/${index}`, publishedAt: null })));
  return informationStore.list().map(item => item.id);
};
beforeEach(() => db.exec('DELETE FROM editorial_briefs; DELETE FROM generation_usage; DELETE FROM ai_usage; DELETE FROM information_feedback; DELETE FROM information_changes; DELETE FROM information_snapshots; DELETE FROM information_items;'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('batch editorial workflow', () => {
  it('requires distinct available sources and rejects individual generation', async () => {
    const ids = seed();
    for (const itemIds of [[ids[0]], [ids[0], ids[0]], [ids[0], 'missing'], Array.from({ length: 21 }, (_, i) => String(i))]) {
      expect((await request(app).post('/api/briefs/generate').send({ itemIds })).status).toBe(400);
    }
  });

  it('persists edits, detects conflicts, keeps snapshots and restores backups with action progress', async () => {
    const ids = seed();
    const response = await request(app).post('/api/briefs/generate').send({ itemIds: ids });
    expect(response.status).toBe(200);
    let brief = response.body.data[0] as Brief;
    expect(brief).toMatchObject({ provider: 'fallback', archived: false }); expect(brief.sources).toHaveLength(2);
    const edited = await request(app).patch('/api/briefs/' + brief.id).send({ version: brief.version, title: '我的综合选题', reader: '技术负责人' });
    expect(edited.status).toBe(200); brief = edited.body.data;
    expect((await request(app).patch('/api/briefs/' + brief.id).send({ version: 1, title: '过期覆盖' })).status).toBe(409);
    const reused = await request(app).post('/api/briefs/generate').send({ itemIds: [...ids].reverse() });
    expect(reused.body.reused).toBe(true); expect(reused.body.data[0].title).toBe('我的综合选题');
    // 发布前检查改为提示式清单后，归档不再被未勾完的检查项阻断
    const completed = await request(app).patch('/api/briefs/' + brief.id).send({ version: brief.version, tasks: brief.tasks.map(t => ({ ...t, done: true, date: '2026-11-12' })), archived: true });
    expect(completed.status).toBe(200); brief = completed.body.data;
    expect((await request(app).patch('/api/briefs/' + brief.id).send({ version: brief.version, title: '归档不可编辑' })).status).toBe(409);
    const backup = createBackup();
    expect(backup.tables).not.toHaveProperty('auth_sessions');
    restoreBackup(backup);
    expect((await request(app).get('/api/briefs')).body.data[0]).toEqual(brief);
    // Saved evidence snapshots survive source deletion.
    db.exec('DELETE FROM information_items');
    const restored = await request(app).patch('/api/briefs/' + brief.id).send({ version: brief.version, archived: false });
    expect(restored.status).toBe(200); expect(restored.body.data.sources).toHaveLength(2); expect(restored.body.data.tasks[0].done).toBe(true);
  });

  it('validates action dates and evidence references', async () => {
    const generated = await generateBriefs(seed()); const b = generated.data[0];
    expect((await request(app).patch('/api/briefs/' + b.id).send({ version: b.version, tasks: b.tasks.map(t => ({ ...t, date: '2026-99-40' })) })).status).toBe(400);
    expect((await request(app).patch('/api/briefs/' + b.id).send({ version: b.version, outline: [{ title: '虚构证据', detail: '', sourceIds: ['not-input'] }] })).status).toBe(400);
  });

  it('only accepts structured AI proposals grounded in multiple input sources', () => {
    const sources: SourceSnapshot[] = ['a', 'b'].map(id => ({ id, title: id, sourceName: '来源', url: 'https://example.com', summary: '' }));
    const draft = { title: '综合选题', reader: '开发者', angle: 'guide', rationale: '跨来源选题', outline: [{ title: '提纲', detail: '内容', sourceIds: ['a', 'b'] }], checks: ['核验'], tasks: ['调查'] };
    expect(validateModelDrafts({ briefs: [draft] }, sources)[0].provider).toBe('ai');
    expect(() => validateModelDrafts({ briefs: [{ ...draft, outline: [{ ...draft.outline[0], sourceIds: ['a', 'invented'] }] }] }, sources)).toThrow();
    expect(() => validateModelDrafts({ briefs: [{ ...draft, outline: [{ ...draft.outline[0], sourceIds: ['a'] }] }] }, sources)).toThrow();
  });

  it('enforces persistent daily quota before external calls, while reusing existing work', async () => {
    const ids = seed();
    db.prepare('INSERT INTO generation_usage (day, count) VALUES (?, ?)').run(new Date().toISOString().slice(0, 10), env.BRIEF_DAILY_LIMIT);
    const response = await request(app).post('/api/briefs/generate').send({ itemIds: ids });
    expect(response.status).toBe(429); expect((await request(app).get('/api/briefs')).body.data).toHaveLength(0);
  });

  it('calls the AI provider once for concurrent identical input and preserves grounded results', async () => {
    const ids = seed(); const originalKey = env.AI_API_KEY; env.AI_API_KEY = 'unit-test-only';
    const external = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ briefs: [{ title: '跨来源提炼的选题', reader: '开发者', angle: 'engineering', rationale: '比较场景、验证与成本', outline: [{ title: '综合提纲', detail: '基于所选材料', sourceIds: ids }], checks: ['核验原文'], tasks: ['做一次实际验证'] }] }) } }] }), { status: 200 }));
    vi.stubGlobal('fetch', external);
    try {
      const [left, right] = await Promise.all([generateBriefs(ids), generateBriefs([...ids].reverse())]);
      expect(external).toHaveBeenCalledTimes(1);
      expect(left.data[0].id).toBe(right.data[0].id);
      expect(left.data[0]).toMatchObject({ title: '跨来源提炼的选题', provider: 'ai' });
    } finally { env.AI_API_KEY = originalKey; }
  });

  it('falls back visibly when AI returns invented evidence', async () => {
    const ids = seed(); const originalKey = env.AI_API_KEY; env.AI_API_KEY = 'unit-test-only';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ briefs: [{ title: '虚构来源', reader: '', angle: 'guide', rationale: '', outline: [{ title: '提纲', detail: '', sourceIds: [ids[0], 'fabricated'] }], checks: ['核验'], tasks: ['调查'] }] }) } }] }), { status: 200 })));
    try {
      const result = await generateBriefs(ids);
      expect(result.data[0].provider).toBe('fallback'); expect(result.data[0].sources.map(s => s.id).sort()).toEqual([...ids].sort());
    } finally { env.AI_API_KEY = originalKey; }
  });

  it('accepts authenticated backups larger than normal request limits', async () => {
    seed();
    db.prepare('UPDATE information_items SET content = ? WHERE id = ?').run('x'.repeat(300_000), informationStore.list()[0].id);
    const backup = createBackup();
    const response = await request(app).post('/api/data/restore').send(backup);
    expect(response.status).toBe(200);
    expect(informationStore.list().some(item => item.content.length === 300_000)).toBe(true);
  });
});
