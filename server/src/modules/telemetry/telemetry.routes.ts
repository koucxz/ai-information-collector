import { Router } from 'express';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 用户侧连接质量上报：只记录前端真实遇到的超时 / 连接失败 / 5xx / 慢响应。
 * 走免鉴权的同域端点（登录超时也要能上报），不写业务数据库，只追加 JSONL 供监测看板消费。
 */
const REASONS = new Set(['timeout', 'network', 'server', 'slow']);
const DIRECTORIES = ['/data/telemetry', join(process.cwd(), 'data', 'telemetry')];

function append(line: string): void {
  const file = new Date().toISOString().slice(0, 10) + '.jsonl';
  for (const directory of DIRECTORIES) {
    try {
      mkdirSync(directory, { recursive: true });
      appendFileSync(join(directory, file), line, 'utf8');
      return;
    } catch {
      // 容器只读或未挂载 /data 时尝试下一个目录
    }
  }
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

export const telemetryRouter = Router();

telemetryRouter.post('/', (request, response) => {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const reason = String(body.reason ?? '');
  const ms = Number(body.ms);
  append(JSON.stringify({
    ts: new Date().toISOString(),
    feature: text(body.feature, 24) || '未知',
    reason: REASONS.has(reason) ? reason : 'unknown',
    ms: Number.isFinite(ms) && ms >= 0 ? Math.min(Math.round(ms), 600_000) : null,
    origin: text(body.origin, 80) || 'unknown'
  }) + '\n');
  response.status(204).end();
});
