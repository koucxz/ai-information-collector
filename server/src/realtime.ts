import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { env } from './config/env.js';
import { notificationEvents, type CollectionEvent } from './modules/notifications/events.js';
import { sessionFromRequest } from './auth.js';

export const attachRealtime = (server: HttpServer) => {
  const io = new SocketServer(server, { cors: { origin: env.CLIENT_URL, credentials: true } });
  io.use((socket, next) => {
    if (env.NODE_ENV === 'test' || sessionFromRequest({ headers: socket.handshake.headers } as never)) return next();
    return next(new Error('未授权'));
  });
  const forward = (event: CollectionEvent) => io.emit('collection:status', event);
  notificationEvents.on('collection', forward);
  io.on('close', () => notificationEvents.off('collection', forward));
  return io;
};

