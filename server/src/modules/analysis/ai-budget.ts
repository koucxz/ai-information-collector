import { env } from '../../config/env.js';
import { db } from '../../db/client.js';

let active = 0;
// One shared pool covers collection analysis, manual analysis and batch proposals.
export async function withAiBudget<T>(execute: () => Promise<T>): Promise<T> {
  if (active >= env.AI_CONCURRENCY) throw new Error('AI 并发上限已达到');
  const day = new Date().toISOString().slice(0, 10);
  const reserved = db.prepare('INSERT INTO ai_usage (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').get(day, env.AI_DAILY_LIMIT);
  if (!reserved) throw new Error('今日 AI 请求额度已用完');
  active += 1;
  try { return await execute(); } finally { active -= 1; }
}
