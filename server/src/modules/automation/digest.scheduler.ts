import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../../config/env.js';
import { sendDigest } from '../notifications/digest.service.js';

export const startDigestScheduler = (): ScheduledTask[] => {
  if (!env.DIGEST_SCHEDULE_ENABLED) return [];
  return [
    cron.schedule(env.DIGEST_DAILY_CRON, () => { void sendDigest('daily'); }),
    cron.schedule(env.DIGEST_WEEKLY_CRON, () => { void sendDigest('weekly'); })
  ];
};

