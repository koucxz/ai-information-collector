import { Router } from 'express';
import { historyStore } from './history.store.js';

export const historyRouter = Router();
historyRouter.get('/changes', (_request, response) => response.json({ data: historyStore.listChanges() }));
