import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db } from '../db/client.js';
import { authCookieName, createSessionToken, verifySessionToken } from '../auth.js';
import { env } from '../config/env.js';

afterEach(() => vi.useRealTimers());
const cookie = (token: string) => `${authCookieName}=${token}`;
describe('real authentication enforcement', () => {
  it('rejects every anonymous business API including writes and generation', async () => {
    for (const url of ['/api/topics', '/api/information', '/api/data/backup', '/api/briefs', '/api/collect/sources', '/api/notifications/channels', '/api/events', '/api/history/changes']) {
      expect((await request(app).get(url)).status, url).toBe(401);
    }
    expect((await request(app).post('/api/briefs/generate').send({ itemIds: ['a', 'b'] })).status).toBe(401);
    expect((await request(app).post('/api/collect/run').send({ sources: ['fixture'] })).status).toBe(401);
  });

  it('accepts a login session and rejects its replay after logout', async () => {
    const login = await request(app).post('/api/auth/login').send({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD });
    const header = login.headers['set-cookie'][0] as string;
    const savedCookie = header.split(';')[0];
    expect(header).toContain('HttpOnly'); expect(header).toContain('SameSite=Strict');
    expect(login.headers['cache-control']).toBe('no-store');
    expect((await request(app).get('/api/briefs').set('Cookie', savedCookie)).status).toBe(200);
    expect((await request(app).post('/api/auth/logout').set('Cookie', savedCookie)).status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Cookie', savedCookie)).status).toBe(401);
    expect((await request(app).post('/api/topics').set('Cookie', savedCookie).send({ name: '重放' })).status).toBe(401);
  });

  it('rejects altered, malformed, expired and unregistered signed tokens', async () => {
    const token = createSessionToken();
    expect(verifySessionToken(token)).toBeDefined();
    for (const invalid of [token + '.extra', token.slice(0, -3) + 'xxx', '%invalid']) {
      expect((await request(app).get('/api/topics').set('Cookie', cookie(invalid))).status).toBe(401);
    }
    const payload = Buffer.from(JSON.stringify({ username: env.ADMIN_USERNAME, nonce: 'never-registered', expiresAt: Math.floor(Date.now() / 1000) + 1000 })).toString('base64url');
    const unregistered = payload + '.' + createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url');
    expect(verifySessionToken(unregistered)).toBeUndefined();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 9 * 60 * 60 * 1000);
    expect((await request(app).patch('/api/briefs/missing').set('Cookie', cookie(token)).send({ version: 1, title: '过期' })).status).toBe(401);
  });

  it('revokes the previous session when logging in again in the same browser', async () => {
    const token = createSessionToken();
    const old = verifySessionToken(token)!;
    const response = await request(app).post('/api/auth/login').set('Cookie', cookie(token)).send({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD });
    expect(response.status).toBe(200);
    expect(db.prepare('SELECT * FROM auth_sessions WHERE nonce = ?').get(old.nonce)).toBeUndefined();
    expect(verifySessionToken(token)).toBeUndefined();
  });
});
