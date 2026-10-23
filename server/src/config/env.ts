import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('file:./prisma/dev.db'),
  AI_BASE_URL: z.string().url().default('https://api.siliconflow.cn/v1'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('Qwen/Qwen3-8B'),
  GITHUB_TOKEN: z.string().optional(),
  COLLECTION_SCHEDULE_ENABLED: booleanString,
  COLLECTION_CRON: z.string().default('0 */2 * * *'),
  DIGEST_SCHEDULE_ENABLED: booleanString,
  DIGEST_DAILY_CRON: z.string().default('0 8 * * *'),
  DIGEST_WEEKLY_CRON: z.string().default('0 9 * * 1'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanString,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  NOTIFY_EMAIL: z.string().optional()
});

export const env = envSchema.parse({
  PORT: process.env.PORT,
  CLIENT_URL: process.env.CLIENT_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  COLLECTION_SCHEDULE_ENABLED: process.env.COLLECTION_SCHEDULE_ENABLED,
  COLLECTION_CRON: process.env.COLLECTION_CRON,
  DIGEST_SCHEDULE_ENABLED: process.env.DIGEST_SCHEDULE_ENABLED,
  DIGEST_DAILY_CRON: process.env.DIGEST_DAILY_CRON,
  DIGEST_WEEKLY_CRON: process.env.DIGEST_WEEKLY_CRON,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_SECURE: process.env.SMTP_SECURE,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  NOTIFY_EMAIL: process.env.NOTIFY_EMAIL
});
