import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  // 允许的前端来源，逗号分隔多域名；填 * 表示不校验来源
  CLIENT_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('file:./prisma/dev.db'),
  AI_BASE_URL: z.string().url().default('https://api.siliconflow.cn/v1'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('Qwen/Qwen3-8B'),
  GITHUB_TOKEN: z.string().optional(),
  // 是否放行 *.vercel.app 预览域名（前端换成自定义域名后可关闭）
  ALLOW_VERCEL_PREVIEW: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true')
});

export const env = envSchema.parse({
  PORT: process.env.PORT,
  CLIENT_URL: process.env.CLIENT_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  ALLOW_VERCEL_PREVIEW: process.env.ALLOW_VERCEL_PREVIEW
});

export const allowedOrigins = env.CLIENT_URL.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
