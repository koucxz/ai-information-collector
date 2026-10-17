import { env } from '../../config/env.js';
import { analysisResultSchema, type AnalysisResult, type AnalyzableInformation } from './analysis.types.js';

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export const fallbackAnalyze = (item: AnalyzableInformation, error?: string): AnalysisResult => {
  const text = `${item.title} ${item.summary} ${item.content}`.toLocaleLowerCase();
  const keywordHit = text.includes(item.keyword.toLocaleLowerCase());
  const importantWords = ['发布', '安全', '政策', '融资', '重大', '开源', '性能'];
  const importanceScore = clamp((importantWords.some((word) => text.includes(word)) ? 0.75 : 0.45) + (keywordHit ? 0.1 : 0));
  return { relevanceScore: keywordHit ? 0.9 : 0.35, importanceScore, summary: item.summary || item.content.slice(0, 120), reason: keywordHit ? '标题或正文直接命中关注关键词。' : '根据标题和正文做本地规则判断。', provider: 'fallback', ...(error ? { error } : {}) };
};

const parseModelContent = (content: string) => {
  const json = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  return analysisResultSchema.parse(JSON.parse(json));
};

export const analyzeInformation = async (item: AnalyzableInformation): Promise<AnalysisResult> => {
  if (!env.AI_API_KEY) return fallbackAnalyze(item, '未配置 AI_API_KEY');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${env.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AI_API_KEY}` }, body: JSON.stringify({ model: env.AI_MODEL, temperature: 0.1, messages: [{ role: 'system', content: '你是信息筛选器。只返回 JSON，字段为 relevanceScore、importanceScore、summary、reason。分数范围是 0 到 1。' }, { role: 'user', content: JSON.stringify({ keyword: item.keyword, title: item.title, summary: item.summary, content: item.content.slice(0, 4000) }) }] }) });
    if (!response.ok) throw new Error(`AI 服务返回 HTTP ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 返回内容为空');
    return { ...parseModelContent(content), provider: 'ai' };
  } catch (error) {
    return fallbackAnalyze(item, error instanceof Error ? error.message : 'AI 请求失败');
  } finally { clearTimeout(timeout); }
};
