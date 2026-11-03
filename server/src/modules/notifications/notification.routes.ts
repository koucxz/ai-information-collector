import { Router } from 'express';
import { buildDigest, sendDigest, type DigestPeriod } from './digest.service.js';
import { notificationChannelStore, type NotificationChannelType } from '../../db/client.js';
import { broadcastDigest, sendToChannel } from './channel.service.js';
import { z } from 'zod';
import { parsePublicHttpUrl } from '../../security/url.js';

export const notificationRouter = Router();
const periodFrom = (value: unknown): DigestPeriod | undefined => value === 'daily' || value === 'weekly' ? value : undefined;

notificationRouter.get('/digest', (request, response) => {
  const period = periodFrom(request.query.period ?? 'daily');
  return period ? response.json({ data: buildDigest(period) }) : response.status(400).json({ error: '摘要周期无效' });
});

notificationRouter.post('/digest/send', async (request, response) => {
  const period = periodFrom(request.body?.period ?? 'daily');
  if (!period) return response.status(400).json({ error: '摘要周期无效' });
  try { return response.json({ data: await sendDigest(period) }); }
  catch (error) { return response.status(502).json({ error: error instanceof Error ? error.message : '邮件发送失败' }); }
});

const channelSchema = z.object({ name: z.string().trim().min(1).max(80), type: z.enum(['feishu', 'wecom', 'dingtalk', 'webhook']), endpoint: z.string().trim().refine((value) => Boolean(parsePublicHttpUrl(value)), '通知地址必须是公开的 HTTP(S) 地址'), enabled: z.boolean().optional() }).strict();
const redactChannel = (channel: ReturnType<typeof notificationChannelStore.findById>) => channel ? { ...channel, endpoint: (() => { try { const url = new URL(channel.endpoint); return `${url.origin}/***`; } catch { return '***'; } })() } : channel;
notificationRouter.get('/channels', (_request, response) => response.json({ data: notificationChannelStore.list().map(redactChannel) }));
notificationRouter.post('/channels', (request, response) => { const parsed = channelSchema.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: '通知渠道参数无效' }); return response.status(201).json({ data: redactChannel(notificationChannelStore.create(parsed.data)) }); });
notificationRouter.patch('/channels/:id', (request, response) => { const parsed = channelSchema.partial().safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: '通知渠道参数无效' }); const channel = notificationChannelStore.update(request.params.id, parsed.data); return channel ? response.json({ data: redactChannel(channel) }) : response.status(404).json({ error: '通知渠道不存在' }); });
notificationRouter.delete('/channels/:id', (request, response) => notificationChannelStore.delete(request.params.id) ? response.status(204).send() : response.status(404).json({ error: '通知渠道不存在' }));
notificationRouter.get('/deliveries', (request, response) => response.json({ data: notificationChannelStore.deliveries(Number(request.query.limit) || 50) }));
notificationRouter.post('/channels/:id/test', async (request, response) => { const channel = notificationChannelStore.findById(request.params.id) as ({ id: string; type: NotificationChannelType; endpoint: string } | undefined); if (!channel) return response.status(404).json({ error: '通知渠道不存在' }); return response.json({ data: await sendToChannel(channel, { title: 'SignalDock 通知测试', text: '通知渠道配置正常。' }) }); });
notificationRouter.post('/broadcast', async (_request, response) => { const digest = buildDigest('daily'); return response.json({ data: await broadcastDigest(digest) }); });

