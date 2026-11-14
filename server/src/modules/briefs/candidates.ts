import { createHash } from 'node:crypto';
import { db } from '../../db/client.js';

export type SignalDimension = { key: string; label: string; value: number; note: string };
/** 评分全部来自库内真实字段，不使用大模型，也不做主观判断。 */
export type BriefSignal = {
  score: number;
  dimensions: SignalDimension[];
  why: string;
  window: string;
  angle: 'guide' | 'engineering';
  clues: number;
  sources: number;
  freshnessHours: number;
  method: 'rules';
};
export type TopicCandidate = BriefSignal & {
  id: string;
  keyword: string;
  title: string;
  headline: string;
  itemIds: string[];
  sampleTitles: string[];
  used: boolean;
};

export type SignalItem = {
  id: string;
  keyword: string;
  source: string;
  sourceName: string;
  title: string;
  collectedAt: string;
  importanceScore: number;
  relevanceScore: number;
  eventKey: string;
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const ENGINEERING = /部署|运维|架构|源码|性能|容器|工程|数据库|监控|迁移|故障|api|sdk|docker|k8s|linux|nginx|redis/i;

/** 六维信号：每条都能在信息流里查到出处，避免「AI 编一个推荐理由」。 */
export const buildSignal = (items: SignalItem[], keyword = ''): BriefSignal => {
  const now = Date.now();
  const stamps = items.map(item => Date.parse(item.collectedAt)).filter(Number.isFinite);
  const newest = stamps.length ? Math.max(...stamps) : now;
  const freshnessHours = Math.max(0, Math.round((now - newest) / 3_600_000));
  const average = (field: 'importanceScore' | 'relevanceScore') =>
    items.length ? items.reduce((sum, item) => sum + (Number(item[field]) || 0), 0) / items.length : 0;
  const sourceCount = new Set(items.map(item => item.source)).size;
  const eventCount = new Set(items.map(item => item.eventKey).filter(Boolean)).size;
  const importance = average('importanceScore');
  const relevance = average('relevanceScore');
  const dimensions: SignalDimension[] = [
    { key: 'clues', label: '线索量', value: clamp(Math.log2(items.length + 1) / Math.log2(80) * 100), note: `${items.length} 条` },
    { key: 'sources', label: '跨来源', value: clamp(sourceCount / 8 * 100), note: `${sourceCount} 个来源` },
    { key: 'freshness', label: '新鲜度', value: clamp(100 - freshnessHours / 24 * 100), note: `${freshnessHours} 小时前` },
    { key: 'importance', label: '重要性', value: clamp(importance * 100), note: importance.toFixed(2) },
    { key: 'relevance', label: '相关性', value: clamp(relevance * 100), note: relevance.toFixed(2) },
    { key: 'diversity', label: '事件多样性', value: clamp(items.length ? eventCount / items.length * 100 : 0), note: `${eventCount} 个事件` }
  ];
  const weights: Record<string, number> = { clues: 0.2, sources: 0.15, freshness: 0.2, importance: 0.2, relevance: 0.15, diversity: 0.1 };
  const score = clamp(dimensions.reduce((sum, dimension) => sum + dimension.value * weights[dimension.key], 0));
  const window = freshnessHours < 24
    ? `抢跑窗口 · 最近 ${freshnessHours} 小时仍有更新`
    : freshnessHours < 72 ? '抢跑窗口 · 3 天内'
      : freshnessHours < 168 ? '持续话题 · 本周可写'
        : '长期话题 · 可从容起稿';
  const context = `${keyword} ${items.slice(0, 3).map(item => item.title).join(' ')}`;
  const angle: BriefSignal['angle'] = ENGINEERING.test(context) ? 'engineering' : 'guide';
  const why = `近 30 天围绕「${keyword || '本轮关注'}」有 ${items.length} 条线索，来自 ${sourceCount} 个来源，最近一条在 ${freshnessHours} 小时前；平均重要性 ${importance.toFixed(2)}、相关性 ${relevance.toFixed(2)}，${eventCount > 1 ? `分属 ${eventCount} 个不同事件，不是同一篇被反复转载` : '但多为同一事件的重复报道，需要补充独立信源'}。以上均由采集记录直接计算，未做事实判断。`;
  return { score, dimensions, why, window, angle, clues: items.length, sources: sourceCount, freshnessHours, method: 'rules' };
};

type Row = {
  id: string; keyword: string; source: string; sourceName: string; title: string; collectedAt: string;
  importanceScore: number; relevanceScore: number; eventKey: string;
};

/** 把近 30 天的采集记录按关键词聚成「今天值得写什么」的候选，规则可解释、零 AI 依赖。 */
export const topicCandidates = () => {
  const since = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
  const rows = db.prepare(`SELECT id, keyword, source, source_name AS sourceName, title,
    collected_at AS collectedAt, importance_score AS importanceScore,
    relevance_score AS relevanceScore, event_key AS eventKey
    FROM information_items WHERE is_archived = 0 AND collected_at >= ?
    ORDER BY collected_at DESC LIMIT 2000`).all(since) as unknown as Row[];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = (row.keyword || '未分类').trim() || '未分类';
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const used = new Set<string>();
  for (const row of db.prepare('SELECT document_json FROM editorial_briefs').all() as Array<{ document_json: string }>) {
    try {
      const document = JSON.parse(row.document_json) as { sources?: Array<{ id: string }> };
      for (const source of document.sources ?? []) used.add(source.id);
    } catch { /* 跳过损坏的历史文档 */ }
  }
  const data: TopicCandidate[] = [...groups.entries()]
    .filter(([, items]) => items.length >= 2)
    .map(([keyword, items]) => {
      const signal = buildSignal(items, keyword);
      const chosen = items.slice(0, 8);
      const angleLabel = signal.angle === 'guide' ? '选型指南' : '工程解读';
      const anchor = items[0].title.replace(/\s+/g, ' ').slice(0, 30);
      return {
        ...signal,
        id: createHash('sha1').update(`${keyword}|${items[0].id}`).digest('hex').slice(0, 16),
        keyword,
        title: `${keyword} · ${angleLabel}：从「${anchor}」等 ${items.length} 条线索切入`.slice(0, 160),
        headline: items[0].title,
        itemIds: chosen.map(item => item.id),
        sampleTitles: items.slice(0, 3).map(item => item.title),
        used: chosen.every(item => used.has(item.id))
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  return {
    data,
    generatedAt: new Date().toISOString(),
    windowDays: 30,
    method: 'rules' as const,
    note: '评分由线索量、跨来源、新鲜度、重要性、相关性、事件多样性六项规则计算，不使用大模型；推荐理由只复述采集记录，不代替事实核验。'
  };
};
