import { notificationChannelStore, type NotificationChannelType } from '../../db/client.js';

const payloadFor = (type: NotificationChannelType, title: string, text: string) => {
  if (type === 'feishu') return { msg_type: 'text', content: { text: `${title}\n${text}` } };
  if (type === 'wecom') return { msgtype: 'text', text: { content: `${title}\n${text}` } };
  if (type === 'dingtalk') return { msgtype: 'text', text: { content: `${title}\n${text}` } };
  return { title, text };
};

export const sendToChannel = async (channel: { id: string; type: NotificationChannelType; endpoint: string }, digest: { title: string; text: string }) => {
  try {
    const response = await fetch(channel.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadFor(channel.type, digest.title, digest.text)) });
    if (!response.ok) throw new Error(`Webhook 返回 HTTP ${response.status}`);
    notificationChannelStore.recordDelivery({ channelId: channel.id, status: 'sent', responseCode: response.status });
    return { sent: true, channelId: channel.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook 投递失败';
    notificationChannelStore.recordDelivery({ channelId: channel.id, status: 'failed', error: message });
    return { sent: false, channelId: channel.id, error: message };
  }
};

export const broadcastDigest = async (digest: { title: string; text: string }) => {
  const channels = notificationChannelStore.list().filter((channel) => channel.enabled) as Array<{ id: string; type: NotificationChannelType; endpoint: string }>;
  return Promise.all(channels.map((channel) => sendToChannel(channel, digest)));
};
