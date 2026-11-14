import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createSchema, generationSchema, updateSchema } from './brief.schemas.js';
import type { BriefDocument } from './brief.schemas.js';
import { briefStore } from './brief.store.js';
import { BriefError, generateBriefs } from './brief.service.js';
import { topicCandidates } from './candidates.js';
import { informationStore } from '../collection/information.store.js';
import { tagsForItems } from '../collection/topic-tagger.js';
import type { ArticleMaterial } from './article-writer.js';
import { startWriting } from './article-job.js';

/** 发布侧栏里的提示式检查清单：和 Gutenberg / Ghost 一样只做提醒，不阻止发布。 */
const DEFAULT_CHECKS = [
  '回原文核对关键事实、时间与数据',
  '正文里没有「待补充 / TODO」等占位内容',
  '来源引用齐全，读者能回溯到原始出处'
];

export const briefRouter = Router();
const generationLimiter = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: '选题生成过于频繁，请稍后再试' } });
briefRouter.get('/', (_request, response) => response.json({ data: briefStore.list() }));
briefRouter.post('/', async (request, response) => {
  const input = createSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: '草稿参数无效' });
  const itemIds = [...new Set(input.data.itemIds)];
  const items = itemIds.map((id) => informationStore.findById(id));
  if (items.some((item) => !item || item.isArchived)) return response.status(400).json({ error: '部分素材不存在或已归档' });
  const valid = items.filter((item) => !!item);
  const tagMap = tagsForItems(valid.map((item) => item.id));
  const tags = [...new Set(valid.flatMap((item) => (tagMap.get(item.id) ?? []).map((tag) => tag.name)))].slice(0, 6);
  // 勾选素材建稿时直接写出成稿：素材太薄会先补原文正文，模型不可用则用本地整理稿兜底
  const materials: ArticleMaterial[] = valid.map((item) => ({
    id: item.id, title: item.title, sourceName: item.sourceName, url: item.url,
    summary: item.summary, content: item.content, collectedAt: item.collectedAt,
    importance: item.importanceScore,
    topics: (tagMap.get(item.id) ?? []).map((tag) => tag.name)
  }));
  const label = tags.slice(0, 2).join('、') || materials[0]?.title.slice(0, 20) || '本轮素材';
  // 正文交给后台写：模型出一篇稿子要一两分钟，卡在请求里会撞上前端和网关的超时
  const article = { title: '未命名草稿', content: '', provider: 'fallback' as const };
  const document: BriefDocument = {
    title: input.data.title ?? article.title,
    reader: '', angle: 'guide', rationale: '',
    outline: [{ title: '正文', detail: '正文由已选素材整理，可按自己的判断改写。', sourceIds: valid.map((item) => item.id) }],
    checks: DEFAULT_CHECKS,
    tasks: DEFAULT_CHECKS.map((title) => ({ id: randomUUID(), title, done: false, date: '' })),
    sources: valid.map((item, index) => ({
      id: item.id, title: item.title.slice(0, 200),
      summary: (materials[index].summary || item.content).slice(0, 1500),
      url: item.url, sourceName: item.sourceName
    })),
    provider: article.provider, archived: false,
    content: article.content, status: 'draft', tags,
    writing: materials.length > 0
  };
  const created = briefStore.createMany(randomUUID(), [document])[0];
  response.status(201).json({ data: created });
  startWriting(created.id, materials, label);
  return;
});
// 「今天写什么」：按采集记录算出带理由的选题候选，不消耗生成额度、不调用大模型
briefRouter.get('/candidates', (_request, response) => response.json(topicCandidates()));
briefRouter.get('/:id', (request, response) => {
  const current = briefStore.find(request.params.id);
  return current ? response.json({ data: current }) : response.status(404).json({ error: '文章不存在' });
});
// 按这篇草稿的来源重新写一遍正文：素材太薄会补原文，模型不可用则用本地整理稿
briefRouter.post('/:id/rewrite', async (request, response) => {
  const current = briefStore.find(request.params.id);
  if (!current) return response.status(404).json({ error: '文章不存在' });
  if (current.archived) return response.status(409).json({ error: '先恢复文章，再重新生成' });
  if (!current.sources.length) return response.status(400).json({ error: '这篇文章没有来源素材，无法自动写稿' });
  const materials: ArticleMaterial[] = current.sources.map((source) => ({
    id: source.id, title: source.title, sourceName: source.sourceName, url: source.url,
    summary: source.summary, content: '', topics: current.tags ?? [], importance: 0, collectedAt: ''
  }));
  const { id, version, createdAt: _createdAt, updatedAt: _updatedAt, ...document } = current;
  // 先把 writing 打开让页面进入等待状态，正文写完由后台任务落库
  const saved = briefStore.update(id, version, { ...document, writing: true, writeNote: undefined });
  if (!saved) return response.status(409).json({ error: '文章已更新，请重新加载' });
  response.json({ data: saved });
  startWriting(saved.id, materials, (current.tags ?? [])[0] || current.title.slice(0, 20));
  return;
});
briefRouter.post('/generate', generationLimiter, async (request, response) => {
  const input = generationSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: '请选择2–20条不同线索' });
  try { return response.json(await generateBriefs(input.data.itemIds, input.data.candidateId)); }
  catch (error) {
    if (error instanceof BriefError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
});
// 删除文章：草稿、已发布、已归档都能删，删了不留在归档里
briefRouter.delete('/:id', (request, response) => {
  const current = briefStore.find(request.params.id);
  if (!current) return response.status(404).json({ error: '文章不存在' });
  return briefStore.delete(current.id) ? response.status(204).end() : response.status(404).json({ error: '文章不存在' });
});
briefRouter.patch('/:id', (request, response) => {
  const input = updateSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: '选题更新格式无效，请检查标题、日期及行动内容' });
  const current = briefStore.find(request.params.id);
  if (!current) return response.status(404).json({ error: '选题不存在' });
  if (current.version !== input.data.version) return response.status(409).json({ error: '选题已在其他页面更新，请保留当前编辑并重新加载' });
  const { version, ...changes } = input.data;
  if (current.archived && (changes.archived !== false || Object.keys(changes).length !== 1)) return response.status(409).json({ error: '先恢复草稿，再进行编辑' });
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, version: _version, ...document } = current;
  const next = { ...document, ...changes };
  const allowed = new Set(current.sources.map(s => s.id));
  if (next.outline.some(section => section.sourceIds.some(id => !allowed.has(id)))) return response.status(400).json({ error: '提纲包含未知来源' });
  // 发布前检查是提示式清单（advisory），不阻断标记发布 / 归档，避免把编辑器变成待办工具
  if (changes.status === 'published' && current.status !== 'published') next.publishedAt = new Date().toISOString();
  else if (changes.status && changes.status !== 'published') next.publishedAt = '';
  const saved = briefStore.update(current.id, version, next);
  return saved ? response.json({ data: saved }) : response.status(409).json({ error: '选题已更新，请重新加载' });
});
