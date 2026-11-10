import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { clearSessionCookie, createSessionToken, login, requireAuth, revokeSession, sessionFromRequest, setSessionCookie } from '../../auth.js';

export const authRouter = Router();
authRouter.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: '登录尝试过于频繁，请稍后再试' } });

authRouter.post('/login', loginLimiter, (request, response) => {
  const username = typeof request.body?.username === 'string' ? request.body.username : '';
  const password = typeof request.body?.password === 'string' ? request.body.password : '';
  if (!login(username, password)) return response.status(401).json({ error: '用户名或密码错误' });
  const previous = sessionFromRequest(request);
  if (previous) revokeSession(previous);
  setSessionCookie(response, createSessionToken(username));
  return response.json({ data: { username } });
});

authRouter.get('/me', (request, response) => {
  const session = sessionFromRequest(request);
  return session ? response.json({ data: { username: session.username } }) : response.status(401).json({ error: '请先登录' });
});

authRouter.post('/logout', requireAuth, (request, response) => {
  const session = sessionFromRequest(request);
  if (session) revokeSession(session);
  clearSessionCookie(response);
  return response.status(204).send();
});
