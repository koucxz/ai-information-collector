import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { withAiBudget } from '../modules/analysis/ai-budget.js';

beforeEach(() => db.exec('DELETE FROM ai_usage'));
afterEach(() => vi.restoreAllMocks());
describe('persistent AI request budget', () => {
  it('counts failures and rejects exhausted quota before contacting the provider', async () => {
    const day = new Date().toISOString().slice(0, 10);
    db.prepare('INSERT INTO ai_usage (day, count) VALUES (?, ?)').run(day, env.AI_DAILY_LIMIT - 1);
    await expect(withAiBudget(async () => { throw new Error('provider failed'); })).rejects.toThrow('provider failed');
    const external = vi.fn(async () => 'should not call');
    await expect(withAiBudget(external)).rejects.toThrow('额度');
    expect(external).not.toHaveBeenCalled();
  });
  it('releases the concurrency slot after a failure', async () => {
    await expect(withAiBudget(async () => { throw new Error('failure'); })).rejects.toThrow();
    expect(await withAiBudget(async () => 'ok')).toBe('ok');
  });
});
