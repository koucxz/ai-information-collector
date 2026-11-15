import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { env } from './config/env.js';
import { notificationEvents, type CollectionEvent } from './modules/notifications/events.js';
import { sessionEvents, sessionFromRequest } from './auth.js';

/**
 * 把 socket 握手信息还原成 sessionFromRequest 需要的 Request 形状。
 * token 模式（Vercel 直连）把 handshake.auth.token 注入 Authorization；cookie 模式保持原样。
 * 返回的伪对象没有 query，sessionFromRequest 内部对 query 已做可选链处理。
 */
const credentialRequest = (socket: Socket) => {
  const token = socket.handshake.auth?.token;
  const headers = typeof token === 'string' && token
    ? { ...socket.handshake.headers, authorization: `Bearer ${token}` }
    : socket.handshake.headers;
  return { headers } as never;
};

export const attachRealtime = (server: HttpServer) => {
  const io = new SocketServer(server, {
    cors: { origin: env.CLIENT_URL, credentials: true },
    allowRequest: (request, callback) => callback(null, !request.headers.origin || request.headers.origin === env.CLIENT_URL)
  });
  io.use((socket, next) => {
    const session = sessionFromRequest(credentialRequest(socket));
    if (session) { socket.data.session = session; return next(); }
    return next(new Error('未授权'));
  });
  io.on('connection', (socket) => {
    const delay = socket.data.session.expiresAt * 1000 - Date.now();
    if (delay <= 0 || !sessionFromRequest(credentialRequest(socket))) { socket.disconnect(true); return; }
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
      if (sessionFromRequest(credentialRequest(socket))) socket.emit('collection:status', event);
      else socket.disconnect(true);
    }
  };
  notificationEvents.on('collection', forward);
  // Socket.IO's server does not emit a public close event. Dispose on HTTP server close.
  server.once('close', () => { notificationEvents.off('collection', forward); sessionEvents.off('revoked', revoked); });
  return io;
};
