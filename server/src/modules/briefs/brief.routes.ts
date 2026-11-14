import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { generationSchema, updateSchema } from './brief.schemas.js';
import { briefStore } from './brief.store.js';
import { BriefError, generateBriefs } from './brief.service.js';
import { topicCandidates } from './candidates.js';

export const briefRouter = Router();
const generationLimiter = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: '选题生成过于频繁，请稍后再试' } });
briefRouter.get('/', (_request, response) => response.json({ data: briefStore.list() }));
// 「今天写什么」：按采集记录算出带理由的选题候选，不消耗生成额度、不调用大模型
briefRouter.get('/candidates', (_request, response) => response.json(topicCandidates()));
briefRouter.post('/generate', generationLimiter, async (request, response) => {
  const input = generationSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: '请选择2–20条不同线索' });
  try { return response.json(await generateBriefs(input.data.itemIds)); }
  catch (error) {
    if (error instanceof BriefError) return response.status(error.status).json({ error: error.message });
    throw error;
  }
});
briefRouter.patch('/:id', (request, response) => {
  const input = updateSchema.safeParse(request.body);
  if (!input.success) return response.status(400).json({ error: '选题更新格式无效，请检查标题、日期及行动内容' });
  const current = briefStore.find(request.params.id);
  if (!current) return response.status(404).json({ error: '选题不存在' });
  if (current.version !== input.data.version) return response.status(409).json({ error: '选题已在其他页面更新，请保留当前编辑并重新加载' });
  const { version, ...changes } = input.data;
  if (current.archived && (changes.archived !== false || Object.keys(changes).length !== 1)) return response.status(409).json({ error: '先恢复选题，再进行编辑' });
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, version: _version, ...document } = current;
  const next = { ...document, ...changes };
  const allowed = new Set(current.sources.map(s => s.id));
  if (next.outline.some(section => section.sourceIds.some(id => !allowed.has(id)))) return response.status(400).json({ error: '提纲包含未知来源' });
  if (next.archived && !next.tasks.every(task => task.done)) return response.status(400).json({ error: '请完成全部行动后再归档' });
  if (changes.status === 'published' && current.status !== 'published') {
    if (!next.tasks.every(task => task.done)) return response.status(400).json({ error: '请先完成发布前检查表里的全部核验项，再标记已发布' });
    next.publishedAt = new Date().toISOString();
  } else if (changes.status && changes.status !== 'published') next.publishedAt = '';
  const saved = briefStore.update(current.id, version, next);
  return saved ? response.json({ data: saved }) : response.status(409).json({ error: '选题已更新，请重新加载' });
});
