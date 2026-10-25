import { Router } from 'express';
import { eventStore } from './event.store.js';

export const eventRouter = Router();

eventRouter.get('/', (request, response) => {
  const page = Math.max(1, Number(request.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(request.query.pageSize) || 20));
  const unread = request.query.unread === 'true';
  return response.json(eventStore.list({ page, pageSize, unread }));
});

eventRouter.get('/:eventKey', (request, response) => {
  const event = eventStore.detail(request.params.eventKey);
  return event ? response.json({ data: event }) : response.status(404).json({ error: '事件不存在' });
});
