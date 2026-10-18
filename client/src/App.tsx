import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

const sources = ['百度', 'B 站', '微博', '知乎', '掘金', 'GitHub'];
type ServiceStatus = 'checking' | 'online' | 'offline';
type Keyword = { id: string; value: string; enabled: boolean };
type Topic = { id: string; name: string; aliases: string[]; excludeWords: string[]; enabled: boolean; keywords: Keyword[] };
type TopicDraft = { name: string; aliases: string; excludeWords: string };
type CollectionPreview = { data: Array<{ sourceName: string; title: string; summary: string; url: string }>; errors: Array<{ source: string; keyword: string; message: string }>; stats: { topics: number; keywords: number; results: number } };
type FeedItem = { id: string; sourceName: string; source: string; title: string; summary: string; importanceScore: number; relevanceScore: number; isRead: boolean; aiStatus: string };

const emptyDraft: TopicDraft = { name: '', aliases: '', excludeWords: '' };
const splitInput = (value: string) => value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);

function App() {
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('checking');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [draft, setDraft] = useState<TopicDraft>(emptyDraft);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editingTopic, setEditingTopic] = useState<TopicDraft>(emptyDraft);
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [collection, setCollection] = useState<CollectionPreview | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [feedSort, setFeedSort] = useState<'latest' | 'importance'>('latest');
  const topicPanel = useRef<HTMLElement>(null);

  const checkHealth = async () => {
    setServiceStatus('checking');
    try {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error('health check failed');
      const payload = (await response.json()) as { status?: string };
      setServiceStatus(payload.status === 'ok' ? 'online' : 'offline');
    } catch { setServiceStatus('offline'); }
  };

  const loadTopics = async () => {
    try {
      const response = await fetch('/api/topics');
      if (!response.ok) throw new Error('加载主题失败');
      const payload = (await response.json()) as { data: Topic[] };
      setTopics(payload.data);
      setError('');
    } catch { setError('主题加载失败，请确认后端服务已启动。'); }
  };
  const loadFeed = async () => { try { const query = new URLSearchParams({ page: '1', pageSize: '20', sort: feedSort, ...(unreadOnly ? { unread: 'true' } : {}) }); const response = await fetch(`/api/information?${query}`); if (!response.ok) throw new Error('信息流加载失败'); const payload = await response.json() as { data: FeedItem[] }; setFeed(payload.data); } catch (caught) { setError(caught instanceof Error ? caught.message : '信息流加载失败'); } };

  useEffect(() => { void checkHealth(); void loadTopics(); void loadFeed(); }, [feedSort, unreadOnly]);

  const request = async (url: string, options: RequestInit = {}) => {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const payload = response.status === 204 ? null : await response.json() as { error?: string; data?: unknown };
    if (!response.ok) throw new Error(payload?.error ?? '操作失败');
    return payload;
  };

  const createTopic = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim()) return setError('请填写主题名称。');
    try { await request('/api/topics', { method: 'POST', body: JSON.stringify({ name: draft.name, aliases: splitInput(draft.aliases), excludeWords: splitInput(draft.excludeWords) }) }); setDraft(emptyDraft); await loadTopics(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '主题创建失败'); }
  };

  const updateTopic = async (topicId: string) => {
    try { await request(`/api/topics/${topicId}`, { method: 'PATCH', body: JSON.stringify({ name: editingTopic.name, aliases: splitInput(editingTopic.aliases), excludeWords: splitInput(editingTopic.excludeWords) }) }); setEditingTopicId(null); await loadTopics(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '主题更新失败'); }
  };

  const toggleTopic = async (topic: Topic) => { try { await request(`/api/topics/${topic.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !topic.enabled }) }); await loadTopics(); } catch (caught) { setError(caught instanceof Error ? caught.message : '主题状态更新失败'); } };
  const deleteTopic = async (topic: Topic) => { if (!window.confirm(`删除“${topic.name}”？其关键词也会被删除。`)) return; try { await request(`/api/topics/${topic.id}`, { method: 'DELETE' }); await loadTopics(); } catch (caught) { setError(caught instanceof Error ? caught.message : '主题删除失败'); } };
  const addKeyword = async (topicId: string) => { const value = keywordDrafts[topicId]?.trim(); if (!value) return; try { await request(`/api/topics/${topicId}/keywords`, { method: 'POST', body: JSON.stringify({ value }) }); setKeywordDrafts((current) => ({ ...current, [topicId]: '' })); await loadTopics(); } catch (caught) { setError(caught instanceof Error ? caught.message : '关键词添加失败'); } };
  const previewCollection = async () => { setCollecting(true); try { const response = await fetch('/api/collect/preview?source=fixture&persist=true'); const payload = await response.json() as CollectionPreview & { error?: string }; if (!response.ok) throw new Error(payload.error ?? '采集失败'); setCollection(payload); setError(''); await loadFeed(); } catch (caught) { setError(caught instanceof Error ? caught.message : '采集失败'); } finally { setCollecting(false); } };
  const markRead = async (id: string) => { try { await fetch(`/api/information/${id}/read`, { method: 'PATCH' }); await loadFeed(); } catch (caught) { setError(caught instanceof Error ? caught.message : '标记已读失败'); } };
  const updateKeyword = async (topicId: string, keyword: Keyword, value: string) => { try { await request(`/api/topics/${topicId}/keywords/${keyword.id}`, { method: 'PATCH', body: JSON.stringify({ value }) }); await loadTopics(); } catch (caught) { setError(caught instanceof Error ? caught.message : '关键词更新失败'); } };
  const toggleKeyword = async (topicId: string, keyword: Keyword) => { try { await request(`/api/topics/${topicId}/keywords/${keyword.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !keyword.enabled }) }); await loadTopics(); } catch (caught) { setError(caught instanceof Error ? caught.message : '关键词状态更新失败'); } };
  const deleteKeyword = async (topicId: string, keyword: Keyword) => { try { await request(`/api/topics/${topicId}/keywords/${keyword.id}`, { method: 'DELETE' }); await loadTopics(); } catch (caught) { setError(caught instanceof Error ? caught.message : '关键词删除失败'); } };

  const statusLabel = { checking: '正在连接服务', online: '服务已连接', offline: '服务未连接' }[serviceStatus];
  const enabledTopics = topics.filter((topic) => topic.enabled).length;

  return (
    <main className="shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">S</span><div><strong>SignalDock</strong><span>AI 信息雷达</span></div></div><div className="status-group"><span className={`status status-${serviceStatus}`}><i /> {statusLabel}</span>{serviceStatus === 'offline' && <button className="retry-button" onClick={() => { void checkHealth(); void loadTopics(); }}>重新检查</button>}</div></header>
      <section className="hero"><p className="eyebrow">PERSONAL INFORMATION RADAR</p><h1>把真正重要的信息，<em>留在视线里。</em></h1><p className="intro">围绕关注主题持续收集国内信息，合并重复内容，识别变化，再交给 AI 做初步整理。</p><div className="hero-actions"><button className="primary" onClick={() => topicPanel.current?.scrollIntoView({ behavior: 'smooth' })}>添加关注主题</button><button className="secondary" onClick={() => void previewCollection()} disabled={collecting}>{collecting ? '采集中…' : '试采一轮'}</button><button className="secondary" onClick={() => document.querySelector('.roadmap-panel')?.scrollIntoView({ behavior: 'smooth' })}>查看开发路线</button></div></section>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')}>关闭</button></div>}
      {collection && <section className="panel collection-panel"><div className="panel-heading"><span>最近一次采集</span><span className="muted">{collection.stats.results} 条结果 · {collection.stats.keywords} 个关键词</span></div>{collection.errors.length > 0 && <div className="collection-errors">{collection.errors.map((item) => <span key={`${item.source}-${item.keyword}`}>{item.source} / {item.keyword}：{item.message}</span>)}</div>}<div className="collection-results">{collection.data.length === 0 ? <p className="muted">没有匹配结果，先新增一个启用中的关键词。</p> : collection.data.map((item) => <a className="collection-item" href={item.url} target="_blank" rel="noreferrer" key={item.url}><span>{item.sourceName}</span><strong>{item.title}</strong><small>{item.summary}</small></a>)}</div></section>}
      <section className="panel feed-panel"><div className="panel-heading"><span>信息流</span><div className="feed-controls"><button className={unreadOnly ? 'control-active' : ''} onClick={() => setUnreadOnly(!unreadOnly)}>仅看未读</button><button className={feedSort === 'importance' ? 'control-active' : ''} onClick={() => setFeedSort(feedSort === 'latest' ? 'importance' : 'latest')}>{feedSort === 'latest' ? '按重要程度' : '按最新'}</button></div></div><div className="feed-list">{feed.length === 0 ? <p className="muted">还没有已保存的信息，点击“试采一轮”开始。</p> : feed.map((item) => <article className={`feed-item ${item.isRead ? 'feed-read' : ''}`} key={item.id}><div><span className="feed-source">{item.sourceName} · 相关性 {Math.round(item.relevanceScore * 100)}%</span><h3>{item.title}</h3><p>{item.summary || '暂无摘要'}</p></div><div className="feed-meta"><span>{item.aiStatus === 'fallback' ? '本地分析' : item.aiStatus === 'ai' ? 'AI 分析' : '待分析'}</span>{!item.isRead && <button onClick={() => void markRead(item.id)}>标为已读</button>}</div></article>)}</div></section>
      <section className="overview-grid" ref={topicPanel}>
        <article className="panel focus-panel"><div className="panel-heading"><span>当前关注</span><b>{enabledTopics} 个启用主题</b></div><form className="topic-form" onSubmit={(event) => void createTopic(event)}><input placeholder="主题名称，例如：人工智能" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /><input placeholder="关键词，用逗号分隔" value={draft.aliases} onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} /><input placeholder="排除词，用逗号分隔（可选）" value={draft.excludeWords} onChange={(event) => setDraft({ ...draft, excludeWords: event.target.value })} /><button className="primary" type="submit">新增主题</button></form>{topics.length === 0 && <div className="empty-state"><span className="empty-icon">＋</span><p>还没有关注主题</p><small>添加一个主题，开始收集信息</small></div>}{topics.map((topic) => <article className={`topic-card ${topic.enabled ? '' : 'topic-disabled'}`} key={topic.id}>{editingTopicId === topic.id ? <div className="topic-edit"><input value={editingTopic.name} onChange={(event) => setEditingTopic({ ...editingTopic, name: event.target.value })} /><input value={editingTopic.aliases} onChange={(event) => setEditingTopic({ ...editingTopic, aliases: event.target.value })} /><input value={editingTopic.excludeWords} onChange={(event) => setEditingTopic({ ...editingTopic, excludeWords: event.target.value })} /><button onClick={() => void updateTopic(topic.id)}>保存</button><button onClick={() => setEditingTopicId(null)}>取消</button></div> : <><div className="topic-title"><strong>{topic.name}</strong><span className={topic.enabled ? 'enabled-badge' : 'disabled-badge'}>{topic.enabled ? '启用' : '暂停'}</span><span className="topic-actions"><button onClick={() => { setEditingTopicId(topic.id); setEditingTopic({ name: topic.name, aliases: topic.aliases.join('，'), excludeWords: topic.excludeWords.join('，') }); }}>编辑</button><button onClick={() => void toggleTopic(topic)}>{topic.enabled ? '暂停' : '启用'}</button><button onClick={() => void deleteTopic(topic)}>删除</button></span></div><div className="topic-meta">别名：{topic.aliases.join('、') || '无'}　排除：{topic.excludeWords.join('、') || '无'}</div><div className="keyword-list">{topic.keywords.map((keyword) => <div className={`keyword-row ${keyword.enabled ? '' : 'keyword-disabled'}`} key={keyword.id}><input defaultValue={keyword.value} onBlur={(event) => { if (event.target.value.trim() && event.target.value.trim() !== keyword.value) void updateKeyword(topic.id, keyword, event.target.value.trim()); }} /><button onClick={() => void toggleKeyword(topic.id, keyword)}>{keyword.enabled ? '暂停' : '启用'}</button><button onClick={() => void deleteKeyword(topic.id, keyword)}>删除</button></div>)}<div className="keyword-add"><input placeholder="新增关键词" value={keywordDrafts[topic.id] ?? ''} onChange={(event) => setKeywordDrafts({ ...keywordDrafts, [topic.id]: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addKeyword(topic.id); } }} /><button onClick={() => void addKeyword(topic.id)}>添加关键词</button></div></div></>}</article>)}</article>
        <article className="panel stats-panel"><div className="panel-heading"><span>信息概览</span><span className="muted">今天</span></div><div className="stats"><div><strong>0</strong><span>新信息</span></div><div><strong>{topics.reduce((count, topic) => count + topic.keywords.filter((keyword) => keyword.enabled).length, 0)}</strong><span>启用关键词</span></div><div><strong>{topics.length}</strong><span>来源主题</span></div></div><div className="source-list">{sources.map((source) => <span key={source}>{source}</span>)}</div></article>
      </section>
      <section className="panel roadmap-panel"><div className="panel-heading"><span>开发路线</span><span className="muted">第一版</span></div><div className="roadmap"><div className="roadmap-item active"><i />关注主题和关键词</div><div className="roadmap-item"><i />国内信息源采集</div><div className="roadmap-item"><i />去重、合并和变化检测</div><div className="roadmap-item"><i />AI 分析和信息流</div></div></section>
    </main>
  );
}

export default App;
