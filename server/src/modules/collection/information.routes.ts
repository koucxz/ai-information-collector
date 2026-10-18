import { Router } from 'express';
import { informationStore } from './information.store.js';

export const informationRouter = Router();
informationRouter.get('/', (request, response) => {
  const page = Math.max(1, Number(request.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(request.query.pageSize) || 10));
  const sort = request.query.sort === 'importance' ? 'importance' : 'latest';
  const unread = request.query.unread === 'true';
  const source = typeof request.query.source === 'string' ? request.query.source : undefined;
  const minImportance = request.query.minImportance === undefined ? undefined : Number(request.query.minImportance);
  const minRelevance = request.query.minRelevance === undefined ? undefined : Number(request.query.minRelevance);
  if ([minImportance, minRelevance].some((value) => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1))) return response.status(400).json({ error: '筛选参数无效' });
  return response.json(informationStore.feed({ page, pageSize, sort, unread, source, minImportance, minRelevance }));
});
informationRouter.get('/:id', (request, response) => {
  const item = informationStore.findById(request.params.id);
  if (!item) return response.status(404).json({ error: '信息不存在' });
  return response.json({ data: item });
});
informationRouter.patch('/:id/read', (request, response) => informationStore.markRead(request.params.id) ? response.json({ data: { id: request.params.id, isRead: true } }) : response.status(404).json({ error: '信息不存在' }));
informationRouter.get('/:id/event', (request, response) => {
  const event = informationStore.event(request.params.id);
  return event ? response.json({ data: event }) : response.status(404).json({ error: '信息不存在' });
});
