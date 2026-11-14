import { Button, Checkbox, Empty, Input, Pagination, Segmented, Skeleton, Tag, Tooltip } from 'antd';
import { Bookmark, BookmarkCheck, Check, Copy, ExternalLink, EyeOff, FilePlus2, Search, ThumbsUp } from 'lucide-react';
import { originalUrl } from '../../shared/links';
import { formatRelativeTime } from '../../shared/format';
import type {
  FeedbackValue,
  FeedItem,
  FeedMode,
  FeedOverview,
  FeedResponse,
  FeedSort,
  SourceOption,
  Topic
} from '../../shared/types';

type InboxViewProps = {
  overview: FeedOverview;
  feedSort: FeedSort;
  feedMode: FeedMode;
  searchTerm: string;
  sourceFilter: string;
  topicFilter: string;
  sources: SourceOption[];
  topics: Topic[];
  items: FeedItem[];
  loading: boolean;
  feedResponse: FeedResponse;
  page: number;
  onSortChange: (sort: FeedSort) => void;
  onModeChange: (mode: FeedMode) => void;
  onSearchChange: (value: string) => void;
  onSourceChange: (value: string) => void;
  onTopicChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onOpenSettings: () => void;
  selectedIds: string[];
  busy: boolean;
  onToggleSelect: (id: string) => void;
  onSelectPage: () => void;
  onClearSelection: () => void;
  onSaveSelected: () => void;
  onCreateDraft: () => void;
  onToggleSave: (item: FeedItem) => void;
  onFeedback: (item: FeedItem, value: FeedbackValue) => void;
  onMarkRead: (item: FeedItem) => void;
};

export function InboxView(props: InboxViewProps) {
  return (
    <section className="feed-column">
      <div className="page-heading">
        <div>
          <p>当前 {props.overview.all} 条信息 · {props.overview.unread} 条未读 · 按主题自动打标</p>
          <h1>信息流</h1>
        </div>
        <Segmented
          value={props.feedSort}
          options={[
            { label: '推荐', value: 'personalized' },
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
            placeholder="搜索全部信息"
            value={props.searchTerm}
            onChange={(event) => props.onSearchChange(event.target.value)}
          />
          <select aria-label="按主题筛选" value={props.topicFilter} onChange={(event) => props.onTopicChange(event.target.value)}>
            <option value="">全部主题</option>
            {props.topicFilter === '__none__' && <option value="__none__">未分类</option>}
            {props.topics.map((topic) => <option value={topic.id} key={topic.id}>{topic.name}</option>)}
          </select>
          <select aria-label="按来源筛选" value={props.sourceFilter} onChange={(event) => props.onSourceChange(event.target.value)}>
            <option value="">全部来源</option>
            {props.sources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}
          </select>
        </div>
      </div>

      <div className="batch-toolbar">
        <div><strong>整理线索</strong><p>勾选信息后加入收藏夹，或直接新建一篇文章草稿。已选 {props.selectedIds.length} 条</p></div>
        <div>
          <Button onClick={props.onSelectPage} disabled={props.busy || !props.items.length}>选择当前页</Button>
          <Button onClick={props.onClearSelection} disabled={props.busy || !props.selectedIds.length}>清空</Button>
          <Button icon={<Bookmark size={14} />} loading={props.busy} disabled={!props.selectedIds.length} onClick={props.onSaveSelected}>加入收藏夹</Button>
          <Button type="primary" icon={<FilePlus2 size={14} />} loading={props.busy} disabled={!props.selectedIds.length} onClick={props.onCreateDraft}>新建草稿</Button>
        </div>
      </div>

      <div className="feed-list">
        {props.loading && Array.from({ length: 5 }, (_, index) => <div className="feed-skeleton" key={index}><Skeleton active title={{ width: '42%' }} paragraph={{ rows: 2, width: ['68%', '48%'] }} /></div>)}
        {!props.loading && props.items.length === 0 && (
          <Empty
            className="empty-feed"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={props.searchTerm ? '没有匹配结果' : props.topicFilter ? '该主题下暂无信息' : '还没有符合条件的信息'}
          >
            {props.topicFilter
              ? <Button onClick={() => props.onTopicChange('')}>查看全部信息</Button>
              : !props.searchTerm && <Button type="primary" onClick={props.onOpenSettings}>添加关注主题</Button>}
          </Empty>
        )}
        {!props.loading && props.items.map((item) => (
          <article
            className={'feed-row ' + (item.isRead ? 'read ' : '') + (item.importanceScore >= 0.9 ? 'highlighted' : '')}
            key={item.id}
          >
            {!item.isRead && <span className="unread-dot" />}
            <div className="feed-body">
              <div className="feed-meta">
                <Checkbox aria-label={'选择线索：' + item.title} checked={props.selectedIds.includes(item.id)} disabled={props.busy} onChange={() => props.onToggleSelect(item.id)} />
                <span className={'source-label source-' + item.source}>{item.sourceName}</span>
                <span>{formatRelativeTime(item.collectedAt)}</span>
              </div>
              {originalUrl(item.url) ? <a href={originalUrl(item.url)} target="_blank" rel="noopener noreferrer"><h2>{item.title}</h2></a> : <h2>{item.title}</h2>}
              <p>{item.analysisSummary || item.summary || '暂无摘要'}</p>
              <div className="feed-footer">
                <div className="feed-tags">
                  {item.topics.length
                    ? item.topics.map(tag => <button
                        key={tag.id}
                        className={'feed-topic-tag' + (tag.primary ? ' is-primary' : '')}
                        title={'按「' + tag.name + '」筛选'}
                        onClick={() => props.onTopicChange(tag.id)}
                      >{tag.name}</button>)
                    : <Tag>未分类</Tag>}
                </div>
                <div className="feed-actions">
                  <Tooltip title={item.isSaved ? '从收藏夹移除' : '加入收藏夹'}>
                    <Button aria-label={item.isSaved ? '取消收藏' : '加入收藏夹'} type="text" size="small" className={item.isSaved ? 'selected' : ''} icon={item.isSaved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />} onClick={() => props.onToggleSave(item)} />
                  </Tooltip>
                  {originalUrl(item.url) ? <a className="original-link" href={originalUrl(item.url)} target="_blank" rel="noopener noreferrer">查看原文 <ExternalLink size={12} /></a> : <span>原文链接缺失</span>}
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
