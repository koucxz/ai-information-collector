import { Plus } from 'lucide-react';
import type { Topic } from '../../shared/types';

const MAX_TOPICS = 10;

type TopicTagBarProps = {
  topics: Topic[];
  loading: boolean;
  onManage: () => void;
};

/** 顶部以标签形式展示关注主题，最多 10 个，点击可进入设置页管理。 */
export function TopicTagBar(props: TopicTagBarProps) {
  const visible = props.topics.slice(0, MAX_TOPICS);
  const extra = props.topics.length - visible.length;
  return (
    <div className="topic-tagbar" aria-label="关注主题">
      <span className="topic-tagbar-label">关注主题</span>
      <div className="topic-tagbar-list">
        {props.loading && <span className="topic-tag is-placeholder">加载中…</span>}
        {!props.loading && visible.length === 0 && <button className="topic-tag is-empty" onClick={props.onManage}>+ 添加关注主题</button>}
        {!props.loading && visible.map((topic) => (
          <button
            key={topic.id}
            className={'topic-tag' + (topic.enabled ? '' : ' is-paused')}
            onClick={props.onManage}
            title={`${topic.name} · ${topic.keywords.filter((keyword) => keyword.enabled).length} 个关键词`}
          >
            <i />{topic.name}
          </button>
        ))}
        {!props.loading && extra > 0 && <span className="topic-tag-more" title={`另有 ${extra} 个主题`}>+{extra}</span>}
        {!props.loading && visible.length > 0 && <button className="topic-tag-add" aria-label="管理关注主题" onClick={props.onManage}><Plus size={13} /></button>}
      </div>
    </div>
  );
}
