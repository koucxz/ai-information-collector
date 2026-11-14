import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../../config/env.js';
import { runCollection } from '../collection/collection.service.js';
import { resolveCollectionSources } from '../collection/source.registry.js';
import { notificationEvents } from '../notifications/events.js';

// 定时采集也只用默认开启的来源，避免把低产出的抓取算进每一轮计划
export class CollectionRunner {
  private running = false;
  constructor(private readonly execute: typeof runCollection = runCollection, private readonly events = notificationEvents) {}

  // 每轮都重新读设置：设置页改完，下一轮定时采集就跟着变
  async trigger(sources: string[] = resolveCollectionSources()) {
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

// 显式指定时区：容器默认 UTC，写成北京时间会差 8 小时
export const startCollectionScheduler = (runner = collectionRunner): ScheduledTask | undefined => {
  if (!env.COLLECTION_SCHEDULE_ENABLED) return undefined;
  const task = cron.schedule(env.COLLECTION_CRON, () => { void runner.trigger(); }, { timezone: env.SCHEDULE_TIMEZONE });
  const next = (task as unknown as { getNextRun?: () => Date | null }).getNextRun?.();
  console.log(`[采集调度] 已启用 ${env.COLLECTION_CRON} (${env.SCHEDULE_TIMEZONE})，下次触发 ${next?.toISOString() ?? '未知'}`);
  return task;
};

