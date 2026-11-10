import { z } from 'zod';

export const sectionSchema = z.object({ title: z.string().trim().min(1).max(200), detail: z.string().max(1200), sourceIds: z.array(z.string().min(1)).max(20) }).strict();
export const taskSchema = z.object({ id: z.string().min(1).max(100), title: z.string().trim().min(1).max(300), done: z.boolean(), date: z.string().refine(value => value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value), '日期无效') }).strict();
export const draftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  reader: z.string().max(300),
  angle: z.enum(['guide', 'engineering']),
  rationale: z.string().max(1500),
  outline: z.array(sectionSchema).min(1).max(10),
  checks: z.array(z.string().min(1).max(500)).min(1).max(10),
  tasks: z.array(z.string().trim().min(1).max(300)).min(1).max(10)
}).strict();
export const generationSchema = z.object({ itemIds: z.array(z.string().min(1).max(100)).min(2).max(20).refine(ids => new Set(ids).size === ids.length, '不能重复选择来源') }).strict();
export const updateSchema = z.object({
  version: z.number().int().positive(), title: draftSchema.shape.title.optional(), reader: draftSchema.shape.reader.optional(),
  angle: draftSchema.shape.angle.optional(), outline: draftSchema.shape.outline.optional(),
  tasks: z.array(taskSchema).min(1).max(30).refine(tasks => new Set(tasks.map(t => t.id)).size === tasks.length, '行动编号重复').optional(),
  archived: z.boolean().optional()
}).strict().refine(value => Object.keys(value).length > 1, '更新内容不能为空');
export type SourceSnapshot = { id: string; title: string; sourceName: string; url: string; summary: string };
export type BriefDocument = Omit<z.infer<typeof draftSchema>, 'tasks'> & { tasks: z.infer<typeof taskSchema>[]; sources: SourceSnapshot[]; provider: 'ai' | 'fallback'; archived: boolean };
export type Brief = BriefDocument & { id: string; version: number; createdAt: string; updatedAt: string };
