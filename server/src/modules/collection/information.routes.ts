import { Router } from 'express';
import { informationStore } from './information.store.js';

export const informationRouter = Router();
informationRouter.get('/', (request, response) => {
  const page = Math.max(1, Number(request.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(request.query.pageSize) || 10));
  const sort = request.query.sort === 'importance' || request.query.sort === 'personalized' ? request.query.sort : 'latest';
  const unread = request.query.unread === 'true';
  const saved = request.query.saved === 'true';
  const archived = request.query.archived === undefined ? false : request.query.archived === 'true';
  const query = typeof request.query.q === 'string' ? request.query.q : undefined;
  const source = typeof request.query.source === 'string' ? request.query.source : undefined;
  const minImportance = request.query.minImportance === undefined ? undefined : Number(request.query.minImportance);
  const minRelevance = request.query.minRelevance === undefined ? undefined : Number(request.query.minRelevance);
  if ([minImportance, minRelevance].some((value) => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1))) return response.status(400).json({ error: '筛选参数无效' });
  return response.json(informationStore.feed({ page, pageSize, sort, unread, saved, archived, query, minImportance, minRelevance }));
});
informationRouter.get('/:id', (request, response) => {
  const item = informationStore.findById(request.params.id);
  if (!item) return response.status(404).json({ error: '信息不存在' });
  return response.json({ data: item });
});
informationRouter.patch('/:id/read', (request, response) => {
  const isRead = request.body?.isRead === undefined ? true : request.body.isRead === true;
  return informationStore.setRead(request.params.id, isRead) ? response.json({ data: { id: request.params.id, isRead } }) : response.status(404).json({ error: '信息不存在' });
});
informationRouter.patch('/:id/save', (request, response) => {
  const isSaved = request.body?.saved === true;
  return informationStore.setSaved(request.params.id, isSaved) ? response.json({ data: { id: request.params.id, isSaved } }) : response.status(404).json({ error: '信息不存在' });
});
informationRouter.patch('/:id/archive', (request, response) => {
  const isArchived = request.body?.archived === true;
  return informationStore.setArchived(request.params.id, isArchived) ? response.json({ data: { id: request.params.id, isArchived } }) : response.status(404).json({ error: '信息不存在' });
});
informationRouter.put('/:id/feedback', (request, response) => {
  const value = request.body?.value;
  if (!['helpful', 'irrelevant', 'duplicate'].includes(value)) return response.status(400).json({ error: '反馈参数无效' });
  const item = informationStore.setFeedback(request.params.id, value);
  return item ? response.json({ data: item }) : response.status(404).json({ error: '信息不存在' });
});
informationRouter.get('/:id/event', (request, response) => {
  const event = informationStore.event(request.params.id);
  return event ? response.json({ data: event }) : response.status(404).json({ error: '信息不存在' });
});
