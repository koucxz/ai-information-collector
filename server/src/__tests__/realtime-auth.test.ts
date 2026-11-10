import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Server as SocketServer } from 'socket.io';
import { app } from '../app.js';
import { attachRealtime } from '../realtime.js';
import { authCookieName, createSessionToken, revokeSession, verifySessionToken } from '../auth.js';
import { notificationEvents } from '../modules/notifications/events.js';

let http: Server | undefined;
let realtime: SocketServer | undefined;
const sockets: Socket[] = [];
const socketOnce = (socket: Socket, event: string) => new Promise<any[]>(resolve => socket.once(event, (...args: any[]) => resolve(args)));
afterEach(async () => {
  vi.useRealTimers();
  sockets.forEach(socket => socket.disconnect()); sockets.length = 0;
  if (realtime) await new Promise<void>(resolve => realtime!.close(() => resolve()));
  if (http?.listening) await new Promise<void>(resolve => http!.close(() => resolve()));
  http = undefined; realtime = undefined;
});
const start = async () => {
  http = createServer(app); realtime = attachRealtime(http); http.listen(0, '127.0.0.1'); await once(http, 'listening');
  return `http://127.0.0.1:${(http.address() as { port: number }).port}`;
};
const client = (url: string, token?: string, origin?: string) => {
  const socket = connect(url, { autoConnect: false, reconnection: false, transports: ['websocket'], extraHeaders: { ...(token ? { Cookie: `${authCookieName}=${token}` } : {}), ...(origin ? { Origin: origin } : {}) } });
  sockets.push(socket); return socket;
};
describe('realtime authentication', () => {
  it('rejects anonymous connections and hostile origins', async () => {
    const url = await start();
    for (const socket of [client(url), client(url, createSessionToken(), 'https://evil.example')]) {
      const failed = socketOnce(socket, 'connect_error'); socket.connect(); expect((await failed)[0]).toBeInstanceOf(Error);
    }
  });
  it('delivers events to a registered session and disconnects immediately on logout', async () => {
    const initial = notificationEvents.listenerCount('collection');
    const url = await start(); const token = createSessionToken(); const socket = client(url, token);
    const connected = socketOnce(socket, 'connect'); socket.connect(); await connected;
    const event = socketOnce(socket, 'collection:status'); notificationEvents.emit('collection', { status: 'started' });
    expect((await event)[0].status).toBe('started');
    const disconnected = socketOnce(socket, 'disconnect'); revokeSession(verifySessionToken(token)!); await disconnected;
    expect(socket.connected).toBe(false);
    await new Promise<void>(resolve => realtime!.close(() => resolve())); realtime = undefined;
    expect(notificationEvents.listenerCount('collection')).toBe(initial);
  });
  it('expires an already connected session without needing a new request', async () => {
    // Offset Date at token creation, then restore it just before the session expires.
    const url = await start();
    vi.useFakeTimers({ toFake: ['Date'] }); const now = Date.now(); vi.setSystemTime(now - (8 * 60 * 60 * 1000 - 2500));
    const token = createSessionToken(); vi.setSystemTime(now);
    const socket = client(url, token); const connected = socketOnce(socket, 'connect'); socket.connect(); await connected;
    const disconnected = socketOnce(socket, 'disconnect'); await disconnected;
    expect(socket.connected).toBe(false);
  });
});
