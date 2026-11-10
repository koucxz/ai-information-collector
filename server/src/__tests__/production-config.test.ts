import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
const prepare = () => {
  vi.resetModules(); vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64)); vi.stubEnv('ADMIN_PASSWORD', 'configured-password.');
  vi.stubEnv('CLIENT_URL', 'https://notes.example.com');
};
describe('production configuration', () => {
  it('requires an explicit password and rejects placeholder or short session secrets', async () => {
    prepare(); vi.stubEnv('ADMIN_PASSWORD', undefined);
    await expect(import('../config/env.js')).rejects.toThrow('ADMIN_PASSWORD');
    for (const secret of ['short-secret-123456', 'replace-with-a-long-random-secret', 'signaldock-development-session-secret']) {
      prepare(); vi.stubEnv('SESSION_SECRET', secret);
      await expect(import('../config/env.js')).rejects.toThrow('SESSION_SECRET');
    }
  });
  it('preserves the explicitly configured password including punctuation', async () => {
    prepare(); vi.stubEnv('ADMIN_PASSWORD', 'configured-password.');
    const { env } = await import('../config/env.js');
    expect(env.ADMIN_PASSWORD).toBe('configured-password.');
  });
  it('requires the actual HTTPS origin without a path', async () => {
    for (const origin of ['http://notes.example.com', 'https://notes.example.com/sd', 'https://notes.example.com/']) {
      prepare(); vi.stubEnv('CLIENT_URL', origin);
      await expect(import('../config/env.js')).rejects.toThrow('CLIENT_URL');
    }
  });
});
