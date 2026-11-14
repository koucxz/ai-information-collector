import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { aiTokenUsage, budgetDay, usageTokens, withAiBudget } from '../modules/analysis/ai-budget.js';

beforeEach(() => db.exec('DELETE FROM ai_usage; DELETE FROM ai_token_usage;'));
afterEach(() => vi.restoreAllMocks());
describe('persistent AI request budget', () => {
  it('counts failures and rejects exhausted quota before contacting the provider', async () => {
    const day = budgetDay();
    db.prepare('INSERT INTO ai_usage (day, count) VALUES (?, ?)').run(day, env.AI_DAILY_LIMIT - 1);
    await expect(withAiBudget(async () => { throw new Error('provider failed'); })).rejects.toThrow('provider failed');
    const external = vi.fn(async () => 'should not call');
    await expect(withAiBudget(external)).rejects.toThrow('额度');
    expect(external).not.toHaveBeenCalled();
  });
  it('blocks the call once today\'s token budget is used up', async () => {
    const day = budgetDay();
    db.prepare('INSERT INTO ai_token_usage (day, tokens) VALUES (?, ?)').run(day, env.AI_DAILY_TOKEN_LIMIT);
    const external = vi.fn(async () => 'should not call');
    await expect(withAiBudget(external)).rejects.toThrow('token');
    expect(external).not.toHaveBeenCalled();
  });
  it('records real usage and falls back to the estimate when the provider omits it', async () => {
    aiTokenUsage.record(usageTokens({ usage: { total_tokens: 1200 } }));
    expect(aiTokenUsage.used()).toBe(1200);
    aiTokenUsage.record(usageTokens({}), 800);
    expect(aiTokenUsage.used()).toBe(2000);
    expect(aiTokenUsage.remaining()).toBe(env.AI_DAILY_TOKEN_LIMIT - 2000);
  });
  it('releases the concurrency slot after a failure', async () => {
    await expect(withAiBudget(async () => { throw new Error('failure'); })).rejects.toThrow();
    expect(await withAiBudget(async () => 'ok')).toBe('ok');
  });
});
