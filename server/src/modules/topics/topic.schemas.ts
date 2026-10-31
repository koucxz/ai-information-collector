import { z } from 'zod';

const listField = z.array(z.string().trim().min(1).max(80)).max(30);
const topicFields = {
  name: z.string().trim().min(1).max(80),
  aliases: listField,
  excludeWords: listField,
  sourceIds: listField,
  frequencyMinutes: z.number().int().min(5).max(10080),
  notificationLevel: z.enum(['all', 'important', 'none']),
  description: z.string().trim().max(240),
  enabled: z.boolean()
};

export const topicCreateSchema = z.object({
  name: topicFields.name,
  aliases: topicFields.aliases.default([]),
  excludeWords: topicFields.excludeWords.default([]),
  sourceIds: topicFields.sourceIds.default([]),
  frequencyMinutes: topicFields.frequencyMinutes.default(120),
  notificationLevel: topicFields.notificationLevel.default('important'),
  description: topicFields.description.default(''),
  enabled: topicFields.enabled.default(true)
}).strict();

export const topicUpdateSchema = z.object(topicFields).partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  '至少提供一个可更新字段'
);

const keywordFields = {
  value: z.string().trim().min(1).max(120),
  enabled: z.boolean()
};

export const keywordCreateSchema = z.object({
  value: keywordFields.value,
  enabled: keywordFields.enabled.default(true)
}).strict();

export const keywordUpdateSchema = z.object(keywordFields).partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  '至少提供一个可更新字段'
);

export const topicIdSchema = z.string().uuid();
export const keywordIdSchema = z.string().uuid();
