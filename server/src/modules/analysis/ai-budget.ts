import { env } from '../../config/env.js';
import { db } from '../../db/client.js';

let active = 0;

const today = () => new Date().toISOString().slice(0, 10);

type ProviderUsage = { usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number } };

/** 从 OpenAI 兼容响应里取真实用量；服务商没返回 usage 时返回 0，由调用方按估算兜底。 */
export const usageTokens = (payload: ProviderUsage | undefined): number => {
  const usage = payload?.usage;
  if (!usage) return 0;
  const total = Number(usage.total_tokens);
  if (Number.isFinite(total) && total > 0) return Math.round(total);
  const parts = Number(usage.prompt_tokens ?? 0) + Number(usage.completion_tokens ?? 0);
  return Number.isFinite(parts) && parts > 0 ? Math.round(parts) : 0;
};

/**
 * 每天可用的 token 预算。请求数上限管的是「调了几次」，管不住「一次写稿烧掉几万 token」，
 * 所以两把尺子一起用：请求数防刷，token 数防烧钱。
 */
export const aiTokenUsage = {
  day: today,
  used(): number {
    const row = db.prepare('SELECT tokens FROM ai_token_usage WHERE day = ?').get(today()) as { tokens: number } | undefined;
    return row?.tokens ?? 0;
  },
  requests(): number {
    const row = db.prepare('SELECT count FROM ai_usage WHERE day = ?').get(today()) as { count: number } | undefined;
    return row?.count ?? 0;
  },
  limit(): number {
    return env.AI_DAILY_TOKEN_LIMIT;
  },
  remaining(): number {
    return Math.max(0, env.AI_DAILY_TOKEN_LIMIT - this.used());
  },
  /** 记一笔真实用量；服务商没回 usage 时用 estimate 兜底，保证预算不会因为缺字段而无限花。 */
  record(tokens: number, estimate = 0): void {
    const amount = Math.round(tokens > 0 ? tokens : estimate);
    if (!Number.isFinite(amount) || amount <= 0) return;
    db.prepare('INSERT INTO ai_token_usage (day, tokens) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET tokens = tokens + excluded.tokens').run(today(), amount);
  },
  assert(): void {
    if (this.used() >= this.limit()) {
      throw new Error(`今日 AI token 用量已达上限（${this.limit()}），明天自动恢复；需要继续用可调大 AI_DAILY_TOKEN_LIMIT`);
    }
  }
};

/** 调用前先估算这次要花多少，明显超出剩余额度就直接拒绝，不把钱花在注定被截断的请求上。 */
export const assertTokenRoom = (estimate: number): void => {
  aiTokenUsage.assert();
  if (estimate > 0 && estimate > aiTokenUsage.remaining()) {
    throw new Error(`今日 AI token 余额只剩 ${aiTokenUsage.remaining()}，不够这次请求预计的 ${estimate}，明天自动恢复`);
  }
};

// One shared pool covers collection analysis, manual analysis and batch proposals.
export async function withAiBudget<T>(execute: () => Promise<T>): Promise<T> {
  if (active >= env.AI_CONCURRENCY) throw new Error('AI 并发上限已达到');
  aiTokenUsage.assert();
  const reserved = db.prepare('INSERT INTO ai_usage (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').get(today(), env.AI_DAILY_LIMIT);
  if (!reserved) throw new Error('今日 AI 请求额度已用完');
  active += 1;
  try { return await execute(); } finally { active -= 1; }
}
