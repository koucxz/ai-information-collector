import { Button, Tooltip } from 'antd';
import { ChevronRight, Plus, Settings2, Sparkles } from 'lucide-react';
import type { CollectionResult, FeedOverview, SourceOption, Topic } from '../../shared/types';

type FocusAsideProps = {
  topics: Topic[];
  sources: SourceOption[];
  selectedSources: string[];
  overview: FeedOverview;
  collection: CollectionResult | null;
  liveStatus: string;
  onOpenSettings: () => void;
  onLoadDigest: () => void;
};

export function FocusAside(props: FocusAsideProps) {
  return (
    <aside className="focus-aside">
      <section className="aside-section">
        <div className="aside-title">
          <h3>关注主题</h3>
          <Tooltip title="管理主题"><Button aria-label="管理主题" type="text" icon={<Plus size={14} />} onClick={props.onOpenSettings} /></Tooltip>
        </div>
        <div className="topic-overview">
          {props.topics.length === 0 && <button className="empty-topic" onClick={props.onOpenSettings}>添加第一个关注主题</button>}
          {props.topics.map((topic, index) => (
            <button className={index === 0 && topic.enabled ? 'active' : ''} key={topic.id} onClick={props.onOpenSettings}>
              <span><i className={topic.enabled ? '' : 'paused'} />{topic.name}</span>
              <b>{topic.keywords.filter((keyword) => keyword.enabled).length}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="aside-section">
        <div className="aside-title"><h3>采集状态</h3><span>{props.liveStatus}</span></div>
        <dl className="collection-stats">
          <div><dt>运行来源</dt><dd>{props.selectedSources.length} / {props.sources.length}</dd></div>
          <div><dt>本轮新增</dt><dd>{props.collection?.persistence.saved ?? 0}</dd></div>
          <div><dt>内容变化</dt><dd>{props.collection?.persistence.changes ?? 0}</dd></div>
        </dl>
        <div className="source-dots">
          {props.sources.map((source) => (
            <span className={props.selectedSources.includes(source.id) ? 'enabled' : ''} key={source.id}>{source.name}</span>
          ))}
        </div>
        <Button className="manage-sources" type="text" icon={<Settings2 size={13} />} onClick={props.onOpenSettings}>管理采集设置</Button>
      </section>

      <button className="digest-button" onClick={props.onLoadDigest}>
        <Sparkles size={17} />
        <span>
          <strong>查看今日摘要</strong>
          <small>{props.overview.relevant} 条重点信息，{props.collection?.persistence.changes ?? 0} 条内容变化</small>
        </span>
        <ChevronRight size={14} />
      </button>
    </aside>
  );
}
