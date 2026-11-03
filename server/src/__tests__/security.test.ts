import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { restoreBackup, exportInformationCsv, csvEscape } from '../modules/data/data.service.js';
import { parsePublicHttpUrl } from '../security/url.js';

describe('security hardening', () => {
  it('sets browser security headers and keeps health public', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('rejects state-changing requests from an untrusted origin', async () => {
    const response = await request(app).post('/api/topics').set('Origin', 'https://evil.example').send({ name: '跨站请求' });
    expect(response.status).toBe(403);
  });

  it('supports the single admin login and rejects invalid credentials', async () => {
    expect((await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' })).status).toBe(401);
    const response = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'VideoNote2026.' });
    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('rejects local notification endpoints', async () => {
    expect(parsePublicHttpUrl('http://127.0.0.1:3001')).toBeUndefined();
    expect((await request(app).post('/api/notifications/channels').send({ name: 'local', type: 'webhook', endpoint: 'http://127.0.0.1:3001' })).status).toBe(400);
  });

  it('rejects unknown backup columns instead of interpolating them into SQL', () => {
    expect(() => restoreBackup({ format: 'signaldock-backup', version: 1, tables: { topics: [{ 'id); DROP TABLE topics; --': 'x' }] } })).toThrow('非法列');
  });

  it('prefixes spreadsheet formulas in CSV exports', () => {
    expect(exportInformationCsv()).toContain('id,sourceName,keyword');
    expect(csvEscape('=1+1')).toBe("'=1+1");
  });
});
