import { randomUUID } from 'node:crypto';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export interface JobRecord {
  job_id: string;
  status: JobStatus;
  progress: number;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface JobQueueOptions {
  /** 并发上限，1 表示串行执行。 */
  concurrency?: number;
  /** 已完成 / 失败任务的保留时长，到期由定时清理移除。 */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

type PendingTask = { id: string; run: () => Promise<unknown> };

/**
 * 单进程内存后台任务队列：默认串行，可通过 concurrency 调整并发上限。
 * 只保存状态、不持久化，进程重启后任务丢失（SD 为单进程部署）。
 */
export class JobQueue {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly pending: PendingTask[] = [];
  private active = 0;
  private readonly concurrency: number;
  private readonly ttlMs: number;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(options: JobQueueOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS);
    this.cleanupTimer = setInterval(() => this.cleanup(), Math.min(this.ttlMs || CLEANUP_INTERVAL_MS, CLEANUP_INTERVAL_MS));
    // 定时器不该阻止进程（尤其是测试进程）退出
    this.cleanupTimer.unref?.();
  }

  get(id: string): JobRecord | undefined {
    const job = this.jobs.get(id);
    return job ? { ...job } : undefined;
  }

  /** 入队一个后台任务，立即返回 queued 记录；任务在微任务中启动，不阻塞调用方。 */
  enqueue(task: (job: JobRecord) => Promise<unknown> | unknown): JobRecord {
    const now = Date.now();
    const job: JobRecord = { job_id: randomUUID(), status: 'queued', progress: 0, createdAt: now, updatedAt: now };
    this.jobs.set(job.job_id, job);
    this.pending.push({ id: job.job_id, run: () => Promise.resolve().then(() => task(job)) });
    queueMicrotask(() => this.drain());
    return job;
  }

  private drain(): void {
    while (this.active < this.concurrency && this.pending.length) {
      const entry = this.pending.shift()!;
      this.active += 1;
      void this.execute(entry);
    }
  }

  private async execute(entry: PendingTask): Promise<void> {
    const job = this.jobs.get(entry.id);
    if (!job) { this.active -= 1; return; } // 已被 TTL 清理
    job.status = 'running';
    job.updatedAt = Date.now();
    try {
      job.result = await entry.run();
      job.status = 'done';
      job.progress = 100;
    } catch (error) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : String(error);
    } finally {
      job.updatedAt = Date.now();
      this.active -= 1;
      this.drain();
    }
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, job] of this.jobs) {
      if ((job.status === 'done' || job.status === 'error') && job.updatedAt < cutoff) this.jobs.delete(id);
    }
  }
}

// 采集任务串行执行：与 CollectionRunner 的互斥配合，同一时间只跑一轮采集
export const jobQueue = new JobQueue({ concurrency: 1 });
