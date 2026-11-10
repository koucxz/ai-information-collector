import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { env } from './config/env.js';
import { notificationEvents, type CollectionEvent } from './modules/notifications/events.js';
import { sessionEvents, sessionFromRequest } from './auth.js';

export const attachRealtime = (server: HttpServer) => {
  const io = new SocketServer(server, {
    cors: { origin: env.CLIENT_URL, credentials: true },
    allowRequest: (request, callback) => callback(null, !request.headers.origin || request.headers.origin === env.CLIENT_URL)
  });
  io.use((socket, next) => {
    const session = sessionFromRequest({ headers: socket.handshake.headers } as never);
    if (session) { socket.data.session = session; return next(); }
    return next(new Error('未授权'));
  });
  io.on('connection', (socket) => {
    const delay = socket.data.session.expiresAt * 1000 - Date.now();
    if (delay <= 0 || !sessionFromRequest({ headers: socket.handshake.headers } as never)) { socket.disconnect(true); return; }
    const timer = setTimeout(() => socket.disconnect(true), delay);
    timer.unref();
    socket.on('disconnect', () => clearTimeout(timer));
  });
  const revoked = (nonce: string) => {
    for (const socket of io.sockets.sockets.values()) if (socket.data.session?.nonce === nonce) socket.disconnect(true);
  };
  sessionEvents.on('revoked', revoked);
  const forward = (event: CollectionEvent) => {
    for (const socket of io.sockets.sockets.values()) {
      if (sessionFromRequest({ headers: socket.handshake.headers } as never)) socket.emit('collection:status', event);
      else socket.disconnect(true);
    }
  };
  notificationEvents.on('collection', forward);
  // Socket.IO's server does not emit a public close event. Dispose on HTTP server close.
  server.once('close', () => { notificationEvents.off('collection', forward); sessionEvents.off('revoked', revoked); });
  return io;
};

