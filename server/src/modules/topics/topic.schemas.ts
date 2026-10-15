import { z } from 'zod';

const listField = z.array(z.string().trim().min(1).max(80)).max(30).default([]);

export const topicCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  aliases: listField,
  excludeWords: listField,
  enabled: z.boolean().optional().default(true)
}).strict();

export const topicUpdateSchema = topicCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  '至少提供一个可更新字段'
);

export const keywordCreateSchema = z.object({
  value: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional().default(true)
}).strict();

export const keywordUpdateSchema = keywordCreateSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  '至少提供一个可更新字段'
);

export const topicIdSchema = z.string().uuid();
export const keywordIdSchema = z.string().uuid();
