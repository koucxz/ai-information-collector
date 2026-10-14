import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../app.js';

describe('GET /api/health', () => {
  it('returns a service health payload', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('signaldock-server');
  });

  it('allows the configured client origin', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['ratelimit-limit']).toBe('120');
  });

  it('returns a stable JSON response for unknown routes', async () => {
    const response = await request(app).get('/api/missing');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '接口不存在' });
  });
});
