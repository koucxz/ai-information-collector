import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../../config/env.js';
import { runCollection } from '../collection/collection.service.js';
import { sourceCatalog } from '../collection/source.registry.js';
import { notificationEvents } from '../notifications/events.js';

export const defaultCollectionSources: string[] = sourceCatalog.filter((source) => source.id !== 'fixture').map((source) => source.id);

export class CollectionRunner {
  private running = false;
  constructor(private readonly execute: typeof runCollection = runCollection, private readonly events = notificationEvents) {}

  async trigger(sources: string[] = defaultCollectionSources) {
    if (this.running) return { status: 'skipped' as const, reason: '已有采集任务正在运行' };
    this.running = true;
    const timestamp = new Date().toISOString();
    this.events.emit('collection', { status: 'started', sources, timestamp });
    try {
      const result = await this.execute(sources);
      this.events.emit('collection', { status: 'completed', sources, timestamp: new Date().toISOString(), stats: { results: result.stats.results, saved: result.persistence.saved, changes: result.persistence.changes } });
      return { status: 'completed' as const, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : '采集任务失败';
      this.events.emit('collection', { status: 'failed', sources, timestamp: new Date().toISOString(), error: message });
      throw error;
    } finally { this.running = false; }
  }
}

export const collectionRunner = new CollectionRunner();

export const startCollectionScheduler = (runner = collectionRunner): ScheduledTask | undefined => {
  if (!env.COLLECTION_SCHEDULE_ENABLED) return undefined;
  return cron.schedule(env.COLLECTION_CRON, () => { void runner.trigger(); });
};

