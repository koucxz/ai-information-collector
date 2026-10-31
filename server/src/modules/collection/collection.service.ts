import { analyzeInformation } from '../analysis/analysis.service.js';
import { topicStore } from '../../db/client.js';
import { collectTopics } from './collector.service.js';
import { historyStore } from './history.store.js';
import { informationStore } from './information.store.js';
import { createSourceAdapters } from './source.registry.js';
import { collectionRunStore } from './collection-run.store.js';

export const runCollection = async (sources: string[]) => {
  const runId = collectionRunStore.start(sources);
  const { adapters, unknown } = createSourceAdapters(sources);
  try {
    if (unknown.length) throw new Error(`不支持的信息源：${unknown.join('、')}`);
    const collection = await collectTopics(topicStore.list(), adapters);
    const saved = informationStore.saveResults(collection.data);
    const history = historyStore.capture(collection.data);
    let processed = 0; let ai = 0; let fallback = 0;
    for (const result of collection.data) {
      const item = informationStore.findByResult(result);
      if (!item || item.aiStatus !== 'pending') continue;
      const analysis = await analyzeInformation(item);
      informationStore.updateAnalysis(item.id, analysis);
      processed += 1;
      if (analysis.provider === 'ai') ai += 1; else fallback += 1;
    }
    const outcome = { ...collection, persistence: { ...saved, ...history }, analysis: { processed, ai, fallback }, runId };
    collectionRunStore.complete(runId, outcome);
    return outcome;
  } catch (error) {
    collectionRunStore.fail(runId, error instanceof Error ? error.message : '采集任务失败');
    throw error;
  }
};

