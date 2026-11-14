import { useCallback, useEffect, useState } from 'react';
import { Button, Checkbox, Empty, Input, Segmented, Skeleton, Tag, Tooltip } from 'antd';
import { BookmarkMinus, ExternalLink, FilePlus2, RefreshCw, Search } from 'lucide-react';
import { request } from '../../shared/api';
import { useApiNotice } from '../../shared/notify';
import { originalUrl } from '../../shared/links';
import { formatRelativeTime } from '../../shared/format';
import type { FeedItem, FeedResponse, SourceOption, Topic } from '../../shared/types';

type Props = {
  topics: Topic[];
  sources: SourceOption[];
  revision: number;
  onNavigate: (view: 'inbox' | 'posts') => void;
  onCreateDraft: (itemIds: string[]) => void;
};

/**
 * 收藏夹：对标 Karakeep / Folo / NewsNow 的书签清单。
 * 只做「收藏 → 按标签筛选 → 勾选用作写作素材」三件事，不做评分、状态机或推荐理由。
 */
export function SavedView(props: Props) {
  const notice = useApiNotice();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [topicFilter, setTopicFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState<'latest' | 'importance'>('latest');
  const [localRevision, setLocalRevision] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams({ saved: 'true', pageSize: '50', sort, ...(searchTerm.trim() ? { q: searchTerm.trim() } : {}), ...(sourceFilter ? { source: sourceFilter } : {}), ...(topicFilter ? { topicId: topicFilter } : {}) });
    try {
      const result = await request<FeedResponse>('/api/information?' + query, { feature: '收藏夹' });
      setItems(result.data);
      setSelectedIds((current) => current.filter((id) => result.data.some((item) => item.id === id)));
    } catch (caught) {
      notice.error(caught instanceof Error ? caught.message : '「收藏夹」加载失败，请稍后重试');
    } finally { setLoading(false); }
  }, [searchTerm, sort, sourceFilter, topicFilter, notice.error]);

  useEffect(() => { void load(); }, [load, props.revision, localRevision]);

  const remove = async (item: FeedItem) => {
    setBusy(true);
    try {
      await request('/api/information/' + item.id + '/save', { method: 'PATCH', body: JSON.stringify({ saved: false }), feature: '取消收藏' });
      notice.success('已从收藏夹移除');
      setLocalRevision((value) => value + 1);
    } catch (caught) {
      notice.error(caught instanceof Error ? caught.message : '「取消收藏」失败，请稍后重试');
    } finally { setBusy(false); }
  };

  return <main className="workspace-view saved-view">
    <header className="view-heading">
      <div>
        <p>共 {items.length} 条收藏 · 按主题整理写作素材</p>
        <h1>收藏夹</h1>
        <span>在信息流里点书签收藏线索；勾选多条后可以直接新建文章草稿，原文链接会一起带过去。</span>
      </div>
      <div className="view-heading-actions">
        <Button onClick={() => props.onNavigate('inbox')}>去信息流</Button>
        <Button icon={<FilePlus2 size={14} />} onClick={() => props.onCreateDraft([])}>新建空白草稿</Button>
      </div>
    </header>

    <div className="saved-toolbar">
      <Input allowClear aria-label="搜索收藏" prefix={<Search size={14} />} placeholder="搜索收藏的线索" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
      <select aria-label="按主题筛选收藏" value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>
        <option value="">全部主题</option>
        <option value="__none__">未分类</option>
        {props.topics.map((topic) => <option value={topic.id} key={topic.id}>{topic.name}</option>)}
      </select>
      <select aria-label="按来源筛选收藏" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
        <option value="">全部来源</option>
        {props.sources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}
      </select>
      <Segmented value={sort} onChange={(value) => setSort(String(value) as 'latest' | 'importance')} options={[{ label: '最新收藏', value: 'latest' }, { label: '最重要', value: 'importance' }]} />
      <Tooltip title="刷新"><Button aria-label="刷新收藏夹" icon={<RefreshCw size={14} />} onClick={() => setLocalRevision((value) => value + 1)} /></Tooltip>
    </div>

    <div className="saved-summary">
      <span>已选 <strong>{selectedIds.length}</strong> 条线索</span>
      <div>
        <Button onClick={() => setSelectedIds(items.map((item) => item.id))} disabled={!items.length}>全选</Button>
        <Button onClick={() => setSelectedIds([])} disabled={!selectedIds.length}>清空</Button>
        <Button type="primary" icon={<FilePlus2 size={14} />} disabled={!selectedIds.length} onClick={() => props.onCreateDraft(selectedIds)}>用选中素材新建草稿</Button>
      </div>
    </div>

    <div className="saved-list">
      {loading && Array.from({ length: 4 }, (_, index) => <div className="saved-skeleton" key={index}><Skeleton active title={{ width: '45%' }} paragraph={{ rows: 2 }} /></div>)}
      {!loading && !items.length && <Empty description={searchTerm || topicFilter || sourceFilter ? '当前筛选下没有收藏' : '收藏夹还是空的'}>
        <Button type="primary" onClick={() => props.onNavigate('inbox')}>去信息流挑线索</Button>
      </Empty>}
      {!loading && items.map((item) => <article className="saved-row" key={item.id}>
        <Checkbox aria-label={'选择素材：' + item.title} checked={selectedIds.includes(item.id)} onChange={() => setSelectedIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />
        <div className="saved-row-main">
          <div className="saved-row-meta">
            <span className={'source-label source-' + item.source}>{item.sourceName}</span>
            <span>{formatRelativeTime(item.collectedAt)}</span>
            {item.topics.length ? item.topics.map((tag) => <Tag key={tag.id} color={tag.primary ? 'green' : 'default'}>{tag.name}</Tag>) : <Tag>未分类</Tag>}
          </div>
          {originalUrl(item.url) ? <a href={originalUrl(item.url)} target="_blank" rel="noopener noreferrer"><h2>{item.title} <ExternalLink size={12} /></h2></a> : <h2>{item.title}</h2>}
          <p>{item.analysisSummary || item.summary || '暂无摘要'}</p>
        </div>
        <Tooltip title="从收藏夹移除"><Button aria-label={'移除收藏：' + item.title} icon={<BookmarkMinus size={14} />} disabled={busy} onClick={() => void remove(item)} /></Tooltip>
      </article>)}
    </div>
  </main>;
}
