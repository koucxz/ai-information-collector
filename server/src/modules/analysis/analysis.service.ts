import { env } from '../../config/env.js';
import { analysisResultSchema, type AnalysisResult, type AnalyzableInformation } from './analysis.types.js';

const clamp = (value: number) => Math.max(0, Math.min(1, value));

const STRONG_WORDS = ['发布', '开源', '融资', '政策', '监管', '安全', '突破', '首次', '上市', '收购', '裁员'];

/** 本地规则打分：标题命中 > 正文命中 > 未命中，再叠加关键词力度与新鲜度，避免所有条目同分 */
export const fallbackAnalyze = (item: AnalyzableInformation, error?: string): AnalysisResult => {
  const text = `${item.title} ${item.summary} ${item.content}`.toLocaleLowerCase();
  const keyword = item.keyword.toLocaleLowerCase();
  const inTitle = Boolean(keyword) && item.title.toLocaleLowerCase().includes(keyword);
  const inBody = Boolean(keyword) && text.includes(keyword);
  const relevanceScore = clamp(inTitle ? 0.95 : inBody ? 0.85 : 0.3);

  const hits = STRONG_WORDS.filter((word) => text.includes(word)).length;
  const ageDays = item.publishedAt ? (Date.now() - new Date(item.publishedAt).getTime()) / 86_400_000 : null;
  const freshness = ageDays === null || Number.isNaN(ageDays) ? 0.04 : ageDays <= 2 ? 0.24 : ageDays <= 7 ? 0.14 : ageDays <= 21 ? 0.05 : 0;
  const importanceScore = clamp(0.3 + Math.min(hits, 3) * 0.12 + freshness);

  const reason = inTitle ? '标题直接命中关注关键词。' : inBody ? '正文提到关注关键词。' : '未命中关键词，按时间与措辞粗略评估。';
  return { relevanceScore: Math.round(relevanceScore * 100) / 100, importanceScore: Math.round(importanceScore * 100) / 100, summary: item.summary || item.content.slice(0, 120), reason, provider: 'fallback', ...(error ? { error } : {}) };
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
