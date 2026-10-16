import { Router } from 'express';
import { informationStore } from './information.store.js';

export const informationRouter = Router();
informationRouter.get('/', (_request, response) => response.json({ data: informationStore.list() }));
informationRouter.get('/:id', (request, response) => {
  const item = informationStore.findById(request.params.id);
  if (!item) return response.status(404).json({ error: '信息不存在' });
  return response.json({ data: item });
});
