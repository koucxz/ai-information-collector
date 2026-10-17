import { z } from 'zod';

export const analysisResultSchema = z.object({
  relevanceScore: z.number().min(0).max(1),
  importanceScore: z.number().min(0).max(1),
  summary: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(500)
});

export type AnalysisResult = z.infer<typeof analysisResultSchema> & { provider: 'ai' | 'fallback'; error?: string };
export type AnalyzableInformation = { title: string; summary: string; content: string; keyword: string };
