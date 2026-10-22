import { EventEmitter } from 'node:events';

export type CollectionEvent = {
  status: 'started' | 'completed' | 'failed';
  sources: string[];
  timestamp: string;
  stats?: { results: number; saved: number; changes: number };
  error?: string;
};

export const notificationEvents = new EventEmitter();

