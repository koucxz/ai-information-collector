import { cleanForMatch, matchesAnyTerm } from './text-match.js';

/**
 * 采集关键词 → 检索用词。
 * 中文关键词在外文站点上直接检索通常没有结果，这里补一层常见英文说法；
 * 反过来英文关键词在中文媒体里也补上中文写法。
 */
const ALIAS_RULES: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /大模型|大語言模型|大语言模型/, terms: ['large language model', 'llm', 'foundation model', '大模型'] },
  { pattern: /多模态|多模態/, terms: ['multimodal', 'vision language', 'vlm', '多模态'] },
  { pattern: /人工智能|artificial intelligence/, terms: ['artificial intelligence', 'machine learning', 'ai', '人工智能'] },
  { pattern: /编程|編程|coding/, terms: ['ai coding', 'coding assistant', 'copilot', 'code completion', '编程'] },
  { pattern: /部署|运维|devops/, terms: ['devops', 'deployment', 'kubernetes', '运维', '部署'] },
  { pattern: /智能体|智能體|agent/, terms: ['agentic', 'ai agent', 'agent', '智能体'] },
  { pattern: /检索增强|檢索增強|rag/, terms: ['retrieval augmented generation', 'retrieval-augmented', 'vector database', '检索增强'] },
  { pattern: /提示词|提示詞|prompt/, terms: ['prompt engineering', '提示词'] }
];

/** 同一关键词的多种检索写法：原词 + 中英别名 + 常见的模型家族写法。 */
export const queryVariants = (keyword: string): string[] => {
  const value = keyword.trim();
  if (!value) return [];
  const variants = new Set<string>([value]);
  const lower = cleanForMatch(value);
  for (const rule of ALIAS_RULES) {
    if (rule.pattern.test(lower)) rule.terms.forEach((term) => variants.add(term));
  }
  if (/(^|[^a-z])gpt([^a-z]|$)/i.test(lower)) ['chatgpt', 'gpt-4', 'gpt-5', 'gpt-4o'].forEach((term) => variants.add(term));
  if (/(^|[^a-z])qwen([^a-z]|$)/i.test(lower)) ['qwen2', 'qwen2.5', 'qwen3', 'qwen3-vl'].forEach((term) => variants.add(term));
  return [...variants];
};

/** 外文站点优先用英文写法检索；没有英文写法时退回原词。 */
export const primaryQuery = (keyword: string): string => {
  const variants = queryVariants(keyword);
  return variants.find((value) => !/[\u3400-\u9fff]/u.test(value)) ?? variants[0] ?? keyword;
};

/** 标题 / 摘要是否命中该关键词的任意一种写法。 */
export const matchesQuery = (text: string, keyword: string): boolean => {
  const variants = queryVariants(keyword);
  if (!variants.length) return false;
  return matchesAnyTerm(text, variants);
};
