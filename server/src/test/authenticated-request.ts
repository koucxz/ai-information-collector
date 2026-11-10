import supertest from 'supertest';
import { authCookieName, createSessionToken } from '../auth.js';

// Business tests exercise the actual authentication middleware using registered sessions.
export default function request(app: Parameters<typeof supertest>[0]) {
  const client = supertest(app);
  const cookie = `${authCookieName}=${createSessionToken()}`;
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const) {
    const original = client[method].bind(client);
    client[method] = ((url: string) => original(url).set('Cookie', cookie)) as typeof client[typeof method];
  }
  return client;
}
