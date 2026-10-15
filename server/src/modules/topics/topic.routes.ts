import { Router } from 'express';
import { isConstraintError, topicStore } from '../../db/client.js';
import { keywordCreateSchema, keywordIdSchema, keywordUpdateSchema, topicCreateSchema, topicIdSchema, topicUpdateSchema } from './topic.schemas.js';

export const topicRouter = Router();

topicRouter.get('/', (_request, response) => response.json({ data: topicStore.list() }));

topicRouter.post('/', (request, response) => {
  const parsed = topicCreateSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: '主题参数无效', details: parsed.error.flatten() });
  try { return response.status(201).json({ data: topicStore.create(parsed.data) }); }
  catch (error) { if (isConstraintError(error)) return response.status(400).json({ error: '主题名称已存在' }); throw error; }
});

topicRouter.patch('/:topicId', (request, response) => {
  const topicId = topicIdSchema.safeParse(request.params.topicId);
  const parsed = topicUpdateSchema.safeParse(request.body);
  if (!topicId.success || !parsed.success) return response.status(400).json({ error: '主题参数无效' });
  try {
    const topic = topicStore.update(topicId.data, parsed.data);
    if (!topic) return response.status(404).json({ error: '主题不存在' });
    return response.json({ data: topic });
  } catch (error) { if (isConstraintError(error)) return response.status(400).json({ error: '主题名称已存在' }); throw error; }
});

topicRouter.delete('/:topicId', (request, response) => {
  const topicId = topicIdSchema.safeParse(request.params.topicId);
  if (!topicId.success) return response.status(400).json({ error: '主题 ID 无效' });
  if (!topicStore.delete(topicId.data)) return response.status(404).json({ error: '主题不存在' });
  return response.status(204).send();
});

topicRouter.post('/:topicId/keywords', (request, response) => {
  const topicId = topicIdSchema.safeParse(request.params.topicId);
  const parsed = keywordCreateSchema.safeParse(request.body);
  if (!topicId.success || !parsed.success) return response.status(400).json({ error: '关键词参数无效' });
  try {
    const keyword = topicStore.addKeyword(topicId.data, parsed.data);
    if (!keyword) return response.status(404).json({ error: '主题不存在' });
    return response.status(201).json({ data: keyword });
  } catch (error) { if (isConstraintError(error)) return response.status(400).json({ error: '关键词已存在' }); throw error; }
});

topicRouter.patch('/:topicId/keywords/:keywordId', (request, response) => {
  const topicId = topicIdSchema.safeParse(request.params.topicId);
  const keywordId = keywordIdSchema.safeParse(request.params.keywordId);
  const parsed = keywordUpdateSchema.safeParse(request.body);
  if (!topicId.success || !keywordId.success || !parsed.success) return response.status(400).json({ error: '关键词参数无效' });
  try {
    const keyword = topicStore.updateKeyword(topicId.data, keywordId.data, parsed.data);
    if (!keyword) return response.status(404).json({ error: '关键词不存在' });
    return response.json({ data: keyword });
  } catch (error) { if (isConstraintError(error)) return response.status(400).json({ error: '关键词已存在' }); throw error; }
});

topicRouter.delete('/:topicId/keywords/:keywordId', (request, response) => {
  const topicId = topicIdSchema.safeParse(request.params.topicId);
  const keywordId = keywordIdSchema.safeParse(request.params.keywordId);
  if (!topicId.success || !keywordId.success) return response.status(400).json({ error: '关键词 ID 无效' });
  if (!topicStore.deleteKeyword(topicId.data, keywordId.data)) return response.status(404).json({ error: '关键词不存在' });
  return response.status(204).send();
});
