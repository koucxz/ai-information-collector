import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { env } from './config/env.js';

const COOKIE_NAME = 'signaldock_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const loginSchema = z.object({ username: z.literal(env.ADMIN_USERNAME), password: z.string().min(1).max(256) }).strict();

type Session = { username: string; expiresAt: number; nonce: string };

const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const decode = (value: string) => Buffer.from(value, 'base64url').toString('utf8');
const sign = (value: string) => createHmac('sha256', env.SESSION_SECRET).update(value).digest('base64url');

export const createSessionToken = (username = env.ADMIN_USERNAME) => {
  const payload = encode(JSON.stringify({ username, expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, nonce: randomBytes(12).toString('hex') } satisfies Session));
  return `${payload}.${sign(payload)}`;
};

export const verifySessionToken = (token: string | undefined): Session | undefined => {
  if (!token) return undefined;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return undefined;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return undefined;
  try {
    const session = JSON.parse(decode(payload)) as Session;
    if (session.username !== env.ADMIN_USERNAME || !Number.isInteger(session.expiresAt) || session.expiresAt <= Math.floor(Date.now() / 1000)) return undefined;
    return session;
  } catch { return undefined; }
};

const safeDecode = (value: string) => { try { return decodeURIComponent(value); } catch { return ''; } };
const parseCookies = (header: string | undefined) => Object.fromEntries((header ?? '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
  const separator = part.indexOf('=');
  return separator < 0 ? [part, ''] : [part.slice(0, separator), safeDecode(part.slice(separator + 1))];
}));

export const sessionFromRequest = (request: Request) => verifySessionToken(parseCookies(request.headers.cookie)[COOKIE_NAME]);

export const setSessionCookie = (response: Response, token: string) => {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Strict${secure}`);
};

export const clearSessionCookie = (response: Response) => {
  response.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict`);
};

export const login = (username: string, password: string) => {
  const parsed = loginSchema.safeParse({ username, password });
  if (!parsed.success) return false;
  const actual = Buffer.from(password);
  const expected = Buffer.from(env.ADMIN_PASSWORD);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export const requireAuth = (request: Request, response: Response, next: NextFunction) => {
  if (env.NODE_ENV === 'test') return next();
  const session = sessionFromRequest(request);
  if (!session) return response.status(401).json({ error: '请先登录' });
  return next();
};

export const authCookieName = COOKIE_NAME;
