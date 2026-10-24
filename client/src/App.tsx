import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Bell, Check, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, Layers3, Pencil, Plus, Radar, RefreshCw, Search, Sparkles, ThumbsUp, Trash2, X } from 'lucide-react';
import { io } from 'socket.io-client';

type ServiceStatus = 'checking' | 'online' | 'offline';
type FeedbackValue = 'helpful' | 'irrelevant' | 'duplicate';
type Keyword = { id: string; value: string; enabled: boolean };
type Topic = { id: string; name: string; aliases: string[]; excludeWords: string[]; enabled: boolean; keywords: Keyword[] };
type SourceOption = { id: string; name: string };
type FeedItem = { id: string; sourceName: string; source: string; title: string; summary: string; url: string; collectedAt: string; importanceScore: number; relevanceScore: number; isRead: boolean; aiStatus: string; analysisSummary: string; analysisReason: string; feedback: FeedbackValue | null };
type FeedResponse = { data: FeedItem[]; page: number; pageSize: number; total: number; totalPages: number };
type CollectionResult = { errors: Array<{ source: string; keyword: string; message: string }>; stats: { topics: number; keywords: number; results: number }; persistence: { saved: number; duplicates: number; changes: number }; analysis: { processed: number; ai: number; fallback: number } };
type EventDetail = { title: string; firstSeenAt: string; lastSeenAt: string; sourceCount: number; sources: FeedItem[] };
type Digest = { title: string; total: number; unread: number; changes: number; sourceCounts: Record<string, number>; topItems: Array<{ id: string; title: string; sourceName: string; importanceScore: number; summary: string }> };
type CollectionEvent = { status: 'started' | 'completed' | 'failed'; stats?: { results: number; saved: number; changes: number }; error?: string };

const splitInput = (value: string) => value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const payload = response.status === 204 ? null : await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload?.error ?? '操作失败');
  return payload as T;
}

function App() {
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('checking');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [feedResponse, setFeedResponse] = useState<FeedResponse>({ data: [], page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [feedSort, setFeedSort] = useState<'latest' | 'importance' | 'personalized'>('personalized');
  const [topicName, setTopicName] = useState('');
  const [topicAliases, setTopicAliases] = useState('');
  const [topicExcludes, setTopicExcludes] = useState('');
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const [collecting, setCollecting] = useState(false);
  const [collection, setCollection] = useState<CollectionResult | null>(null);
  const [liveStatus, setLiveStatus] = useState('等待采集');
  const [error, setError] = useState('');
  const [eventDetail, setEventDetail] = useState<EventDetail | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);

  const loadFeed = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page), pageSize: '10', sort: feedSort, ...(unreadOnly ? { unread: 'true' } : {}), ...(sourceFilter ? { source: sourceFilter } : {}) });
    try { setFeedResponse(await request<FeedResponse>(`/api/information?${query}`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '信息流加载失败'); }
  }, [feedSort, page, sourceFilter, unreadOnly]);

  const loadTopics = useCallback(async () => {
    try { setTopics((await request<{ data: Topic[] }>('/api/topics')).data); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '主题加载失败'); }
  }, []);

  const checkHealth = useCallback(async () => {
    setServiceStatus('checking');
    try { const result = await request<{ status: string }>('/api/health'); setServiceStatus(result.status === 'ok' ? 'online' : 'offline'); }
    catch { setServiceStatus('offline'); }
  }, []);

  useEffect(() => {
    void checkHealth(); void loadTopics();
    void request<{ data: SourceOption[] }>('/api/collect/sources').then(({ data }) => {
      setSources(data);
      setSelectedSources(data.filter((source) => source.id !== 'fixture').map((source) => source.id));
    }).catch((caught) => setError(caught instanceof Error ? caught.message : '来源加载失败'));
  }, [checkHealth, loadTopics]);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  useEffect(() => {
    const socket = io();
    socket.on('collection:status', (event: CollectionEvent) => {
      if (event.status === 'started') setLiveStatus('正在采集');
      if (event.status === 'failed') { setLiveStatus('采集失败'); setError(event.error ?? '采集失败'); }
      if (event.status === 'completed') { setLiveStatus(`已更新 ${event.stats?.saved ?? 0} 条`); void loadFeed(); }
    });
    return () => { socket.disconnect(); };
  }, [loadFeed]);

  const enabledKeywordCount = useMemo(() => topics.reduce((count, topic) => count + topic.keywords.filter((keyword) => keyword.enabled).length, 0), [topics]);

  const runCollection = async () => {
    if (!selectedSources.length) return setError('至少选择一个信息源。');
    setCollecting(true); setLiveStatus('正在采集');
    try {
      const result = await request<CollectionResult>('/api/collect/run', { method: 'POST', body: JSON.stringify({ sources: selectedSources }) });
      setCollection(result); setLiveStatus(`已更新 ${result.persistence.saved} 条`); setPage(1); await loadFeed();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '采集失败'); setLiveStatus('采集失败'); }
    finally { setCollecting(false); }
  };

  const createTopic = async (event: FormEvent) => {
    event.preventDefault();
    if (!topicName.trim()) return;
    try {
      await request('/api/topics', { method: 'POST', body: JSON.stringify({ name: topicName, aliases: splitInput(topicAliases), excludeWords: splitInput(topicExcludes) }) });
      setTopicName(''); setTopicAliases(''); setTopicExcludes(''); await loadTopics();
    } catch (caught) { setError(caught instanceof Error ? caught.message : '主题创建失败'); }
  };

  const patchTopic = async (topic: Topic, update: Partial<Topic>) => { try { await request(`/api/topics/${topic.id}`, { method: 'PATCH', body: JSON.stringify(update) }); await loadTopics(); } catch (caught) { setError(caught instanceof Error ? caught.message : '主题更新失败'); } };
  const editTopic = async (topic: Topic) => { const name = window.prompt('主题名称', topic.name)?.trim(); if (name && name !== topic.name) await patchTopic(topic, { name }); };
  const deleteTopic = async (topic: Topic) => { if (!window.confirm(`删除“${topic.name}”及其关键词？`)) return; try { await request(`/api/topics/${topic.id}`, { method: 'DELETE' }); await loadTopics(); } catch (caught) { setError(caught instanceof Error ? caught.message : '主题删除失败'); } };
  const addKeyword = async (topic: Topic) => { const value = keywordDrafts[topic.id]?.trim(); if (!value) return; try { await request(`/api/topics/${topic.id}/keywords`, { method: 'POST', body: JSON.stringify({ value }) }); setKeywordDrafts((current) => ({ ...current, [topic.id]: '' })); await loadTopics(); } catch (caught) { setError(caught instanceof Error ? caught.message : '关键词添加失败'); } };
  const patchKeyword = async (topic: Topic, keyword: Keyword, update: Partial<Keyword>) => { try { await request(`/api/topics/${topic.id}/keywords/${keyword.id}`, { method: 'PATCH', body: JSON.stringify(update) }); await loadTopics(); } catch (caught) { setError(caught instanceof Error ? caught.message : '关键词更新失败'); } };
  const editKeyword = async (topic: Topic, keyword: Keyword) => { const value = window.prompt('关键词', keyword.value)?.trim(); if (value && value !== keyword.value) await patchKeyword(topic, keyword, { value }); };
  const deleteKeyword = async (topic: Topic, keyword: Keyword) => { try { await request(`/api/topics/${topic.id}/keywords/${keyword.id}`, { method: 'DELETE' }); await loadTopics(); } catch (caught) { setError(caught instanceof Error ? caught.message : '关键词删除失败'); } };
  const markRead = async (item: FeedItem) => { try { await request(`/api/information/${item.id}/read`, { method: 'PATCH' }); await loadFeed(); } catch (caught) { setError(caught instanceof Error ? caught.message : '标记已读失败'); } };
  const sendFeedback = async (item: FeedItem, value: FeedbackValue) => { try { await request(`/api/information/${item.id}/feedback`, { method: 'PUT', body: JSON.stringify({ value }) }); await loadFeed(); } catch (caught) { setError(caught instanceof Error ? caught.message : '反馈提交失败'); } };
  const analyze = async (item: FeedItem) => { try { await request(`/api/information/${item.id}/analyze`, { method: 'POST' }); await loadFeed(); } catch (caught) { setError(caught instanceof Error ? caught.message : '分析失败'); } };
  const openEvent = async (item: FeedItem) => { try { setEventDetail((await request<{ data: EventDetail }>(`/api/information/${item.id}/event`)).data); } catch (caught) { setError(caught instanceof Error ? caught.message : '事件详情加载失败'); } };
  const loadDigest = async () => { try { setDigest((await request<{ data: Digest }>('/api/notifications/digest?period=daily')).data); } catch (caught) { setError(caught instanceof Error ? caught.message : '摘要加载失败'); } };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand"><span className="brand-mark"><Radar size={19} /></span><div><strong>SignalDock</strong><span>个人信息雷达</span></div></div>
        <div className="header-actions"><span className={`service-status ${serviceStatus}`}><i />{serviceStatus === 'online' ? '服务正常' : serviceStatus === 'checking' ? '连接中' : '服务离线'}</span><button className="icon-button" title="重新检查服务" onClick={() => void checkHealth()}><RefreshCw size={16} /></button><button className="primary-button" title="立即采集" onClick={() => void runCollection()} disabled={collecting}><RefreshCw size={16} className={collecting ? 'spin' : ''} />{collecting ? '采集中' : '立即采集'}</button></div>
      </header>

      {error && <div className="alert" role="alert"><span>{error}</span><button title="关闭" onClick={() => setError('')}><X size={16} /></button></div>}

      <section className="dashboard-summary">
        <div><span>信息总数</span><strong>{feedResponse.total}</strong></div><div><span>启用关键词</span><strong>{enabledKeywordCount}</strong></div><div><span>已选来源</span><strong>{selectedSources.length}</strong></div><div><span>运行状态</span><strong className="summary-status">{liveStatus}</strong></div>
      </section>

      <section className="workspace">
        <div className="content-column">
          <div className="section-heading"><div><h1>信息流</h1><p>按来源聚合、分析并持续更新</p></div><button className="secondary-button" title="查看今日摘要" onClick={() => void loadDigest()}><Bell size={15} />今日摘要</button></div>
          <div className="toolbar">
            <label><Search size={15} /><select value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value); setPage(1); }}><option value="">全部来源</option>{sources.filter((source) => source.id !== 'fixture').map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}</select></label>
            <select value={feedSort} onChange={(event) => { setFeedSort(event.target.value as typeof feedSort); setPage(1); }}><option value="personalized">为我排序</option><option value="latest">最新优先</option><option value="importance">重要优先</option></select>
            <label className="toggle"><input type="checkbox" checked={unreadOnly} onChange={(event) => { setUnreadOnly(event.target.checked); setPage(1); }} /><span />仅看未读</label>
          </div>

          <div className="feed-list">
            {feedResponse.data.length === 0 && <div className="empty-state"><Radar size={30} /><strong>还没有符合条件的信息</strong><span>添加关注主题并运行一次采集</span></div>}
            {feedResponse.data.map((item) => <article className={`feed-row ${item.isRead ? 'read' : ''}`} key={item.id}>
              <div className="feed-main"><div className="feed-kicker"><span>{item.sourceName}</span><span>{formatTime(item.collectedAt)}</span><span>相关 {Math.round(item.relevanceScore * 100)}%</span><span>重要 {Math.round(item.importanceScore * 100)}%</span></div><a href={item.url || undefined} target="_blank" rel="noreferrer"><h2>{item.title}</h2></a><p>{item.analysisSummary || item.summary || '暂无摘要'}</p><div className="feed-actions"><button className={item.feedback === 'helpful' ? 'active' : ''} onClick={() => void sendFeedback(item, 'helpful')}><ThumbsUp size={14} />有用</button><button className={item.feedback === 'irrelevant' ? 'active' : ''} onClick={() => void sendFeedback(item, 'irrelevant')}><EyeOff size={14} />无关</button><button className={item.feedback === 'duplicate' ? 'active' : ''} onClick={() => void sendFeedback(item, 'duplicate')}><Copy size={14} />重复</button><button onClick={() => void openEvent(item)}><Layers3 size={14} />事件来源</button></div></div>
              <div className="row-tools"><button title="重新分析" onClick={() => void analyze(item)}><Sparkles size={16} /></button>{!item.isRead && <button title="标为已读" onClick={() => void markRead(item)}><Check size={16} /></button>}</div>
            </article>)}
          </div>
          {feedResponse.totalPages > 1 && <div className="pagination"><button title="上一页" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><span>{page} / {feedResponse.totalPages}</span><button title="下一页" disabled={page >= feedResponse.totalPages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div>}
        </div>

        <aside className="side-column">
          <section className="side-section"><div className="side-heading"><h2>采集来源</h2><span>{selectedSources.length}/{sources.length}</span></div><div className="source-options">{sources.map((source) => <label key={source.id}><input type="checkbox" checked={selectedSources.includes(source.id)} onChange={(event) => setSelectedSources((current) => event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id))} /><span>{source.name}</span></label>)}</div>{collection && <div className="run-result"><strong>上次采集</strong><span>发现 {collection.stats.results} 条，新增 {collection.persistence.saved} 条，变化 {collection.persistence.changes} 条</span>{collection.errors.length > 0 && <small>{collection.errors.length} 个来源请求失败，可稍后重试</small>}</div>}</section>

          <section className="side-section"><div className="side-heading"><h2>关注主题</h2><span>{topics.filter((topic) => topic.enabled).length} 个启用</span></div><form className="topic-create" onSubmit={(event) => void createTopic(event)}><input value={topicName} onChange={(event) => setTopicName(event.target.value)} placeholder="主题名称" /><input value={topicAliases} onChange={(event) => setTopicAliases(event.target.value)} placeholder="别名，逗号分隔" /><input value={topicExcludes} onChange={(event) => setTopicExcludes(event.target.value)} placeholder="排除词，可选" /><button className="secondary-button" type="submit"><Plus size={15} />新增主题</button></form>
            <div className="topic-list">{topics.length === 0 && <p className="side-empty">尚未添加主题</p>}{topics.map((topic) => <div className={`topic-item ${topic.enabled ? '' : 'disabled'}`} key={topic.id}><div className="topic-line"><button className="topic-toggle" title={topic.enabled ? '暂停主题' : '启用主题'} onClick={() => void patchTopic(topic, { enabled: !topic.enabled })}><span /></button><strong>{topic.name}</strong><div className="topic-tools"><button title="编辑主题" onClick={() => void editTopic(topic)}><Pencil size={13} /></button><button title="删除主题" onClick={() => void deleteTopic(topic)}><Trash2 size={13} /></button></div></div>{(topic.aliases.length > 0 || topic.excludeWords.length > 0) && <p className="topic-meta">{topic.aliases.length > 0 ? `别名：${topic.aliases.join('、')}` : ''}{topic.excludeWords.length > 0 ? ` · 排除：${topic.excludeWords.join('、')}` : ''}</p>}<div className="keyword-list">{topic.keywords.map((keyword) => <span className={keyword.enabled ? '' : 'disabled'} key={keyword.id}>{keyword.value}<button title="编辑关键词" onClick={() => void editKeyword(topic, keyword)}><Pencil size={11} /></button><button title={keyword.enabled ? '暂停关键词' : '启用关键词'} onClick={() => void patchKeyword(topic, keyword, { enabled: !keyword.enabled })}>{keyword.enabled ? <Eye size={11} /> : <EyeOff size={11} />}</button><button title="删除关键词" onClick={() => void deleteKeyword(topic, keyword)}><X size={11} /></button></span>)}<div className="keyword-add"><input value={keywordDrafts[topic.id] ?? ''} onChange={(event) => setKeywordDrafts((current) => ({ ...current, [topic.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addKeyword(topic); } }} placeholder="新增关键词" /><button title="添加关键词" onClick={() => void addKeyword(topic)}><Plus size={13} /></button></div></div></div>)}</div>
          </section>
        </aside>
      </section>

      {eventDetail && <div className="modal-backdrop" onMouseDown={() => setEventDetail(null)}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><span>{eventDetail.sourceCount} 个来源</span><h2>{eventDetail.title}</h2></div><button title="关闭" onClick={() => setEventDetail(null)}><X size={18} /></button></div><p className="modal-period">首次发现 {formatTime(eventDetail.firstSeenAt)} · 最近更新 {formatTime(eventDetail.lastSeenAt)}</p><div className="modal-list">{eventDetail.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><span>{source.sourceName}</span><strong>{source.title}</strong></a>)}</div></section></div>}
      {digest && <div className="modal-backdrop" onMouseDown={() => setDigest(null)}><section className="modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-heading"><div><span>变化 {digest.changes} 条 · 未读 {digest.unread} 条</span><h2>{digest.title}</h2></div><button title="关闭" onClick={() => setDigest(null)}><X size={18} /></button></div><div className="digest-sources">{Object.entries(digest.sourceCounts).map(([source, count]) => <span key={source}>{source} {count}</span>)}</div><div className="modal-list">{digest.topItems.length === 0 ? <p className="side-empty">今天还没有新信息</p> : digest.topItems.map((item) => <div key={item.id}><span>{item.sourceName} · 重要 {Math.round(item.importanceScore * 100)}%</span><strong>{item.title}</strong><p>{item.summary}</p></div>)}</div></section></div>}
    </main>
  );
}

export default App;
