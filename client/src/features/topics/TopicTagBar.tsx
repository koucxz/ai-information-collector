import { Settings2 } from 'lucide-react';
import type { Topic } from '../../shared/types';

const MAX_TOPICS = 10;

type TopicTagBarProps = {
  topics: Topic[];
  loading: boolean;
  selectedTopicId: string;
  totalCount: number;
  topicCounts: Record<string, number>;
  onSelectTopic: (topicId: string) => void;
  onManage: () => void;
};

/** 顶部主题标签即筛选器：点击按主题过滤信息流，再点一次或点「全部」恢复。 */
export function TopicTagBar(props: TopicTagBarProps) {
  const visible = props.topics.slice(0, MAX_TOPICS);
  const extra = props.topics.length - visible.length;
  const countOf = (id: string) => props.topicCounts[id] ?? 0;
  return (
    <div className="topic-tagbar" aria-label="按主题筛选信息">
      <span className="topic-tagbar-label">主题筛选</span>
      <div className="topic-tagbar-list">
        <button
          className={'topic-tag topic-tag-all' + (props.selectedTopicId ? '' : ' is-active')}
          aria-pressed={!props.selectedTopicId}
          onClick={() => props.onSelectTopic('')}
          title="显示全部信息"
        >
          全部 <em>{props.totalCount}</em>
        </button>
        {props.loading && <span className="topic-tag is-placeholder">加载中…</span>}
        {!props.loading && visible.length === 0 && <button className="topic-tag is-empty" onClick={props.onManage}>+ 添加关注主题</button>}
        {!props.loading && visible.map((topic) => (
          <button
            key={topic.id}
            className={'topic-tag' + (props.selectedTopicId === topic.id ? ' is-active' : '') + (topic.enabled ? '' : ' is-paused')}
            aria-pressed={props.selectedTopicId === topic.id}
            onClick={() => props.onSelectTopic(props.selectedTopicId === topic.id ? '' : topic.id)}
            title={`${props.selectedTopicId === topic.id ? '取消筛选' : '只看'}「${topic.name}」· ${topic.keywords.filter((keyword) => keyword.enabled).length} 个关键词 · ${countOf(topic.id)} 条信息`}
          >
            <i />{topic.name}<em>{countOf(topic.id)}</em>
          </button>
        ))}
        {!props.loading && extra > 0 && <span className="topic-tag-more" title={`另有 ${extra} 个主题，可在列表的「按主题筛选」下拉中选择`}>+{extra}</span>}
        <button className="topic-tag-manage" onClick={props.onManage} aria-label="管理关注主题" title="管理关注主题">
          <Settings2 size={12} />管理
        </button>
      </div>
    </div>
  );
}
