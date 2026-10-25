import { Button, Empty, Input, Pagination, Segmented, Tag, Tooltip } from 'antd';
import { Check, Copy, EyeOff, Layers3, Search, Sparkles, ThumbsUp } from 'lucide-react';
import { formatRelativeTime } from '../../shared/format';
import type {
  FeedbackValue,
  FeedItem,
  FeedMode,
  FeedOverview,
  FeedResponse,
  FeedSort,
  SourceOption
} from '../../shared/types';

type InboxViewProps = {
  overview: FeedOverview;
  feedSort: FeedSort;
  feedMode: FeedMode;
  searchTerm: string;
  sourceFilter: string;
  sources: SourceOption[];
  items: FeedItem[];
  feedResponse: FeedResponse;
  page: number;
  onSortChange: (sort: FeedSort) => void;
  onModeChange: (mode: FeedMode) => void;
  onSearchChange: (value: string) => void;
  onSourceChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onOpenSettings: () => void;
  onOpenEvent: (item: FeedItem) => void;
  onAnalyze: (item: FeedItem) => void;
  onFeedback: (item: FeedItem, value: FeedbackValue) => void;
  onMarkRead: (item: FeedItem) => void;
};

export function InboxView(props: InboxViewProps) {
  return (
    <section className="feed-column">
      <div className="page-heading">
        <div>
          <p>共收集 {props.overview.all} 条信息，{props.overview.relevant} 条值得关注</p>
          <h1>信息流</h1>
        </div>
        <Segmented
          value={props.feedSort}
          options={[
            { label: '为我排序', value: 'personalized' },
            { label: '最新', value: 'latest' },
            { label: '重要', value: 'importance' }
          ]}
          onChange={(value) => props.onSortChange(value as FeedSort)}
        />
      </div>

      <div className="filterbar">
        <div className="filter-tabs">
          <button className={props.feedMode === 'all' ? 'active' : ''} onClick={() => props.onModeChange('all')}>全部信息 <b>{props.overview.all}</b></button>
          <button className={props.feedMode === 'unread' ? 'active' : ''} onClick={() => props.onModeChange('unread')}>未读 <b>{props.overview.unread}</b></button>
          <button className={props.feedMode === 'relevant' ? 'active' : ''} onClick={() => props.onModeChange('relevant')}>高相关 <b>{props.overview.relevant}</b></button>
        </div>
        <div className="feed-tools">
          <Input
            allowClear
            aria-label="搜索信息"
            prefix={<Search size={14} />}
            placeholder="搜索当前页"
            value={props.searchTerm}
            onChange={(event) => props.onSearchChange(event.target.value)}
          />
          <select aria-label="按来源筛选" value={props.sourceFilter} onChange={(event) => props.onSourceChange(event.target.value)}>
            <option value="">全部来源</option>
            {props.sources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}
          </select>
        </div>
      </div>

      <div className="feed-list">
        {props.items.length === 0 && (
          <Empty
            className="empty-feed"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={props.searchTerm ? '当前页面没有匹配结果' : '还没有符合条件的信息'}
          >
            {!props.searchTerm && <Button type="primary" onClick={props.onOpenSettings}>添加关注主题</Button>}
          </Empty>
        )}
        {props.items.map((item) => (
          <article
            className={'feed-row ' + (item.isRead ? 'read ' : '') + (item.importanceScore >= 0.9 ? 'highlighted' : '')}
            key={item.id}
          >
            {!item.isRead && <span className="unread-dot" />}
            <div className="feed-body">
              <div className="feed-meta">
                <span className={'source-label source-' + item.source}>{item.sourceName}</span>
                <span>{formatRelativeTime(item.collectedAt)}</span>
                <button onClick={() => props.onOpenEvent(item)}><Layers3 size={12} />事件来源</button>
              </div>
              <a href={item.url || undefined} target="_blank" rel="noreferrer"><h2>{item.title}</h2></a>
              <p>{item.analysisSummary || item.summary || '暂无摘要'}</p>
              <div className="feed-footer">
                <div className="feed-tags">
                  {item.keyword && <Tag>{item.keyword}</Tag>}
                  {item.aiStatus && <Tag>{item.aiStatus === 'fallback' ? '本地分析' : 'AI 分析'}</Tag>}
                </div>
                <div className="feed-actions">
                  <Tooltip title="重新分析"><Button aria-label="重新分析" type="text" size="small" icon={<Sparkles size={13} />} onClick={() => props.onAnalyze(item)} /></Tooltip>
                  <Tooltip title="有用"><Button aria-label="标记有用" type="text" size="small" className={item.feedback === 'helpful' ? 'selected' : ''} icon={<ThumbsUp size={13} />} onClick={() => props.onFeedback(item, 'helpful')} /></Tooltip>
                  <Tooltip title="无关"><Button aria-label="标记无关" type="text" size="small" className={item.feedback === 'irrelevant' ? 'selected' : ''} icon={<EyeOff size={13} />} onClick={() => props.onFeedback(item, 'irrelevant')} /></Tooltip>
                  <Tooltip title="重复"><Button aria-label="标记重复" type="text" size="small" className={item.feedback === 'duplicate' ? 'selected' : ''} icon={<Copy size={13} />} onClick={() => props.onFeedback(item, 'duplicate')} /></Tooltip>
                </div>
              </div>
            </div>
            <div className="score-column">
              <strong>{Math.round(item.importanceScore * 100)}</strong>
              <span>重要度</span>
              {!item.isRead && <Tooltip title="标为已读"><Button aria-label="标为已读" icon={<Check size={13} />} onClick={() => props.onMarkRead(item)} /></Tooltip>}
            </div>
          </article>
        ))}
      </div>

      {props.feedResponse.totalPages > 1 && (
        <Pagination
          className="feed-pagination"
          current={props.page}
          pageSize={props.feedResponse.pageSize}
          total={props.feedResponse.total}
          showSizeChanger={false}
          onChange={props.onPageChange}
        />
      )}
    </section>
  );
}
