import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  AI_BASE_URL: z.string().url().default('https://api.siliconflow.cn/v1'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('Qwen/Qwen3-8B'),
  GITHUB_TOKEN: z.string().optional()
});

export const env = envSchema.parse({
  PORT: process.env.PORT,
  CLIENT_URL: process.env.CLIENT_URL,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_MODEL: process.env.AI_MODEL,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN
});
