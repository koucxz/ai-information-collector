import { topicStore } from '../../db/client.js';

type TopicWithKeywords = {
  id: string;
  name: string;
  aliases?: string[];
  keywords: Array<{ value: string }>;
};

/**
 * 信息条目没有 topic_id，采集时写入的 keyword 就是主题关键词 / 别名 / 主题名。
 * 因此按主题筛选等价于按这些查询词匹配 information_items.keyword。
 * 停用、删除过的关键词也要算进来，否则历史信息会在筛选后凭空消失。
 */
export const topicQueryWords = (topic: TopicWithKeywords): string[] => {
  const values = [
    ...topic.keywords.map((keyword) => keyword.value),
    ...(topic.aliases ?? []),
    topic.name
  ];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
};

/** 返回 undefined 表示没有按主题筛选；返回空数组表示主题存在但没有任何可匹配的历史查询词。 */
export const wordsForTopic = (topicId: string): string[] | undefined => {
  const topic = topicStore.list().find((item) => item.id === topicId);
  return topic ? topicQueryWords(topic) : undefined;
};

export const normalizeWords = (words: string[]) => words.map((word) => word.trim().toLocaleLowerCase()).filter(Boolean);
