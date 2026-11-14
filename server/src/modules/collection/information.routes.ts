import { Router } from 'express';
import { informationStore } from './information.store.js';
import { wordsForTopic } from './topic-filter.js';
import { ensureTopicTags } from './topic-tagger.js';

/** 解析 topicId：未传 = 不筛选；__none__ = 未分类；传入不存在的主题 = 400，避免前端静默展示全量数据。 */
const parseTopicFilter = (value: unknown): { words?: string[]; topicId?: string; unclassified?: boolean } | { error: string } => {
  if (typeof value !== 'string' || !value.trim()) return {};
  const id = value.trim();
  if (id === '__none__') return { words: [], unclassified: true };
  const words = wordsForTopic(id);
  return words === undefined ? { error: '主题不存在' } : { words, topicId: id };
};

export const informationRouter = Router();
// 主题改名 / 关键词增删后自动重打标；配置未变化时只有一次哈希比较的开销
informationRouter.use((_request, _response, next) => { ensureTopicTags(); next(); });
informationRouter.get('/', (request, response) => {
  const filter = parseTopicFilter(request.query.topicId);
  if ('error' in filter) return response.status(400).json({ error: filter.error });
  const page = Math.max(1, Number(request.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(request.query.pageSize) || 10));
  const sort = request.query.sort === 'importance' || request.query.sort === 'personalized' ? request.query.sort : 'latest';
  const unread = request.query.unread === 'true';
  const saved = request.query.saved === 'true';
  const archived = request.query.archived === undefined ? false : request.query.archived === 'true';
  const query = typeof request.query.q === 'string' ? request.query.q : undefined;
  const source = typeof request.query.source === 'string' ? request.query.source : undefined;
  const minImportance = request.query.minImportance === undefined ? undefined : Number(request.query.minImportance);
  const minRelevance = request.query.minRelevance === undefined ? undefined : Number(request.query.minRelevance);
  if ([minImportance, minRelevance].some((value) => value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1))) return response.status(400).json({ error: '筛选参数无效' });
  return response.json(informationStore.feed({ page, pageSize, sort, unread, saved, archived, query, source, minImportance, minRelevance, topicWords: filter.words, topicId: filter.topicId, unclassified: filter.unclassified }));
});
// 手动触发一次全量重打标，便于主题配置调整后立刻看到结果
informationRouter.post('/retag', (_request, response) => {
  const summary = ensureTopicTags(true);
  return response.json({ data: { ...summary, generatedAt: new Date().toISOString() } });
});
// 概览合并为一次查询，避免首屏并发三次拉取信息流；topicId 让计数与当前筛选保持一致
informationRouter.get('/overview', (request, response) => {
  const filter = parseTopicFilter(request.query.topicId);
  if ('error' in filter) return response.status(400).json({ error: filter.error });
  return response.json(informationStore.overview(filter.words, filter.topicId, filter.unclassified));
});
informationRouter.get('/:id', (request, response) => {
  const item = informationStore.findById(request.params.id);
  if (!item) return response.status(404).json({ error: '信息不存在' });
  return response.json({ data: item });
});
informationRouter.patch('/:id/read', (request, response) => {
  const isRead = request.body?.isRead === undefined ? true : request.body.isRead === true;
  return informationStore.setRead(request.params.id, isRead) ? response.json({ data: { id: request.params.id, isRead } }) : response.status(404).json({ error: '信息不存在' });
});
informationRouter.patch('/:id/save', (request, response) => {
  const isSaved = request.body?.saved === true;
  return informationStore.setSaved(request.params.id, isSaved) ? response.json({ data: { id: request.params.id, isSaved } }) : response.status(404).json({ error: '信息不存在' });
});
informationRouter.patch('/:id/archive', (request, response) => {
  const isArchived = request.body?.archived === true;
  return informationStore.setArchived(request.params.id, isArchived) ? response.json({ data: { id: request.params.id, isArchived } }) : response.status(404).json({ error: '信息不存在' });
});
informationRouter.put('/:id/feedback', (request, response) => {
  const value = request.body?.value;
  if (!['helpful', 'irrelevant', 'duplicate'].includes(value)) return response.status(400).json({ error: '反馈参数无效' });
  const item = informationStore.setFeedback(request.params.id, value);
  return item ? response.json({ data: item }) : response.status(404).json({ error: '信息不存在' });
});
informationRouter.get('/:id/event', (request, response) => {
  const event = informationStore.event(request.params.id);
  return event ? response.json({ data: event }) : response.status(404).json({ error: '信息不存在' });
});
