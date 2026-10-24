import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  Checkbox,
  ConfigProvider,
  Drawer,
  Empty,
  Input,
  Modal,
  Pagination,
  Segmented,
  Switch,
  Tag,
  Tooltip
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  Bell,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Layers3,
  Pencil,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  ThumbsUp,
  Trash2
} from 'lucide-react';
import { io } from 'socket.io-client';

type ServiceStatus = 'checking' | 'online' | 'offline';
type FeedbackValue = 'helpful' | 'irrelevant' | 'duplicate';
type FeedMode = 'all' | 'unread' | 'relevant';
type Keyword = { id: string; value: string; enabled: boolean };
type Topic = { id: string; name: string; aliases: string[]; excludeWords: string[]; enabled: boolean; keywords: Keyword[] };
type SourceOption = { id: string; name: string };
type FeedItem = { id: string; sourceName: string; source: string; keyword: string; title: string; summary: string; url: string; collectedAt: string; importanceScore: number; relevanceScore: number; isRead: boolean; aiStatus: string; analysisSummary: string; analysisReason: string; feedback: FeedbackValue | null };
type FeedResponse = { data: FeedItem[]; page: number; pageSize: number; total: number; totalPages: number };
type CollectionResult = { errors: Array<{ source: string; keyword: string; message: string }>; stats: { topics: number; keywords: number; results: number }; persistence: { saved: number; duplicates: number; changes: number }; analysis: { processed: number; ai: number; fallback: number } };
type EventDetail = { title: string; firstSeenAt: string; lastSeenAt: string; sourceCount: number; sources: FeedItem[] };
type Digest = { title: string; total: number; unread: number; changes: number; sourceCounts: Record<string, number>; topItems: Array<{ id: string; title: string; sourceName: string; importanceScore: number; summary: string }> };
type CollectionEvent = { status: 'started' | 'completed' | 'failed'; stats?: { results: number; saved: number; changes: number }; error?: string };
type EditingValue = { kind: 'topic'; topic: Topic } | { kind: 'keyword'; topic: Topic; keyword: Keyword };

const splitInput = (value: string) => value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const formatRelativeTime = (value: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} 天前`;
  return formatTime(value);
};

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const payload = response.status === 204 ? null : await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload?.error ?? '操作失败');
  return payload as T;
}

function SignalDock() {
  const { modal } = AntApp.useApp();
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('checking');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [feedResponse, setFeedResponse] = useState<FeedResponse>({ data: [], page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [overview, setOverview] = useState({ all: 0, unread: 0, relevant: 0 });
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState('');
  const [feedMode, setFeedMode] = useState<FeedMode>('all');
  const [feedSort, setFeedSort] = useState<'latest' | 'importance' | 'personalized'>('personalized');
  const [searchTerm, setSearchTerm] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [topicName, setTopicName] = useState('');
  const [topicAliases, setTopicAliases] = useState('');
  const [topicExcludes, setTopicExcludes] = useState('');
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EditingValue | null>(null);
  const [editValue, setEditValue] = useState('');
  const [collecting, setCollecting] = useState(false);
  const [collection, setCollection] = useState<CollectionResult | null>(null);
  const [liveStatus, setLiveStatus] = useState('等待首次采集');
  const [error, setError] = useState('');
  const [eventDetail, setEventDetail] = useState<EventDetail | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);

  const loadFeed = useCallback(async () => {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: '10',
      sort: feedSort,
      ...(feedMode === 'unread' ? { unread: 'true' } : {}),
      ...(feedMode === 'relevant' ? { minRelevance: '0.8' } : {}),
      ...(sourceFilter ? { source: sourceFilter } : {})
    });
    try {
      setFeedResponse(await request<FeedResponse>(`/api/information?${query}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '信息流加载失败');
    }
  }, [feedMode, feedSort, page, sourceFilter]);

  const loadOverview = useCallback(async () => {
    try {
      const [all, unread, relevant] = await Promise.all([
        request<FeedResponse>('/api/information?page=1&pageSize=1'),
        request<FeedResponse>('/api/information?page=1&pageSize=1&unread=true'),
        request<FeedResponse>('/api/information?page=1&pageSize=1&minRelevance=0.8')
      ]);
      setOverview({ all: all.total, unread: unread.total, relevant: relevant.total });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '概览加载失败');
    }
  }, []);

  const loadTopics = useCallback(async () => {
    try {
      setTopics((await request<{ data: Topic[] }>('/api/topics')).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '主题加载失败');
    }
  }, []);

  const checkHealth = useCallback(async () => {
    setServiceStatus('checking');
    try {
      const result = await request<{ status: string }>('/api/health');
      setServiceStatus(result.status === 'ok' ? 'online' : 'offline');
    } catch {
      setServiceStatus('offline');
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    void loadTopics();
    void loadOverview();
    void request<{ data: SourceOption[] }>('/api/collect/sources').then(({ data }) => {
      setSources(data);
      setSelectedSources(data.filter((source) => source.id !== 'fixture').map((source) => source.id));
    }).catch((caught) => setError(caught instanceof Error ? caught.message : '来源加载失败'));
  }, [checkHealth, loadOverview, loadTopics]);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  useEffect(() => {
    const socket = io();
    socket.on('collection:status', (event: CollectionEvent) => {
      if (event.status === 'started') setLiveStatus('正在采集');
      if (event.status === 'failed') {
        setLiveStatus('采集失败');
        setError(event.error ?? '采集失败');
      }
      if (event.status === 'completed') {
        setLiveStatus(`刚刚更新 ${event.stats?.saved ?? 0} 条`);
        void loadFeed();
        void loadOverview();
      }
    });
    return () => { socket.disconnect(); };
  }, [loadFeed, loadOverview]);

  const enabledKeywordCount = useMemo(() => topics.reduce((count, topic) => count + topic.keywords.filter((keyword) => keyword.enabled).length, 0), [topics]);
  const visibleItems = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    if (!query) return feedResponse.data;
    return feedResponse.data.filter((item) => [item.title, item.summary, item.analysisSummary, item.keyword, item.sourceName].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [feedResponse.data, searchTerm]);
  const visibleSources = sources;

  const runCollection = async () => {
    if (!selectedSources.length) return setError('至少选择一个信息源。');
    setCollecting(true);
    setLiveStatus('正在采集');
    try {
      const result = await request<CollectionResult>('/api/collect/run', { method: 'POST', body: JSON.stringify({ sources: selectedSources }) });
      setCollection(result);
      setLiveStatus(`刚刚更新 ${result.persistence.saved} 条`);
      setPage(1);
      await Promise.all([loadFeed(), loadOverview()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '采集失败');
      setLiveStatus('采集失败');
    } finally {
      setCollecting(false);
    }
  };

  const createTopic = async (event: FormEvent) => {
    event.preventDefault();
    if (!topicName.trim()) return;
    try {
      await request('/api/topics', { method: 'POST', body: JSON.stringify({ name: topicName, aliases: splitInput(topicAliases), excludeWords: splitInput(topicExcludes) }) });
      setTopicName('');
      setTopicAliases('');
      setTopicExcludes('');
      await loadTopics();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '主题创建失败');
    }
  };

  const patchTopic = async (topic: Topic, update: Partial<Topic>) => {
    try {
      await request(`/api/topics/${topic.id}`, { method: 'PATCH', body: JSON.stringify(update) });
      await loadTopics();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '主题更新失败');
    }
  };

  const confirmDeleteTopic = (topic: Topic) => {
    modal.confirm({
      title: `删除“${topic.name}”？`,
      content: '该主题下的关键词会一并删除。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true, 'aria-label': '确认删除主题' },
      cancelButtonProps: { 'aria-label': '取消删除主题' },
      async onOk() {
        try {
          await request(`/api/topics/${topic.id}`, { method: 'DELETE' });
          await loadTopics();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : '主题删除失败');
        }
      }
    });
  };

  const addKeyword = async (topic: Topic) => {
    const value = keywordDrafts[topic.id]?.trim();
    if (!value) return;
    try {
      await request(`/api/topics/${topic.id}/keywords`, { method: 'POST', body: JSON.stringify({ value }) });
      setKeywordDrafts((current) => ({ ...current, [topic.id]: '' }));
      await loadTopics();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '关键词添加失败');
    }
  };

  const patchKeyword = async (topic: Topic, keyword: Keyword, update: Partial<Keyword>) => {
    try {
      await request(`/api/topics/${topic.id}/keywords/${keyword.id}`, { method: 'PATCH', body: JSON.stringify(update) });
      await loadTopics();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '关键词更新失败');
    }
  };

  const deleteKeyword = async (topic: Topic, keyword: Keyword) => {
    try {
      await request(`/api/topics/${topic.id}/keywords/${keyword.id}`, { method: 'DELETE' });
      await loadTopics();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '关键词删除失败');
    }
  };

  const saveEdit = async () => {
    const value = editValue.trim();
    if (!editing || !value) return;
    if (editing.kind === 'topic') await patchTopic(editing.topic, { name: value });
    else await patchKeyword(editing.topic, editing.keyword, { value });
    setEditing(null);
  };

  const markRead = async (item: FeedItem) => {
    try {
      await request(`/api/information/${item.id}/read`, { method: 'PATCH' });
      await Promise.all([loadFeed(), loadOverview()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '标记已读失败');
    }
  };

  const sendFeedback = async (item: FeedItem, value: FeedbackValue) => {
    try {
      await request(`/api/information/${item.id}/feedback`, { method: 'PUT', body: JSON.stringify({ value }) });
      await loadFeed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '反馈提交失败');
    }
  };

  const analyze = async (item: FeedItem) => {
    try {
      await request(`/api/information/${item.id}/analyze`, { method: 'POST' });
      await Promise.all([loadFeed(), loadOverview()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '分析失败');
    }
  };

  const openEvent = async (item: FeedItem) => {
    try {
      setEventDetail((await request<{ data: EventDetail }>(`/api/information/${item.id}/event`)).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '事件详情加载失败');
    }
  };

  const loadDigest = async () => {
    try {
      setDigest((await request<{ data: Digest }>('/api/notifications/digest?period=daily')).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '摘要加载失败');
    }
  };

  const changeMode = (mode: FeedMode) => {
    setFeedMode(mode);
    setPage(1);
  };

  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Radar size={18} /></span>
          <strong>SignalDock</strong>
        </div>
        <nav className="main-nav" aria-label="主导航">
          <button className={feedMode !== 'relevant' ? 'active' : ''} onClick={() => changeMode('all')}>信息流</button>
          <button className={feedMode === 'relevant' ? 'active' : ''} onClick={() => changeMode('relevant')}>重点</button>
          <button onClick={() => void loadDigest()}>摘要</button>
        </nav>
        <div className="top-actions">
          <button className={`service-state ${serviceStatus}`} onClick={() => void checkHealth()}>
            <i />{serviceStatus === 'online' ? '采集器在线' : serviceStatus === 'checking' ? '正在连接' : '服务离线'}
          </button>
          <Badge dot={overview.unread > 0} offset={[-3, 4]}>
            <Tooltip title="今日摘要"><Button className="square-button" aria-label="今日摘要" icon={<Bell size={15} />} onClick={() => void loadDigest()} /></Tooltip>
          </Badge>
          <Button type="primary" icon={<RefreshCw size={14} className={collecting ? 'spin' : ''} />} loading={collecting} onClick={() => void runCollection()}>
            立即采集
          </Button>
        </div>
      </header>

      {error && <Alert className="page-alert" type="error" message={error} closable onClose={() => setError('')} showIcon />}

      <main className="focus-layout">
        <section className="feed-column">
          <div className="page-heading">
            <div>
              <p>共收集 {overview.all} 条信息，{overview.relevant} 条值得关注</p>
              <h1>信息流</h1>
            </div>
            <Segmented
              value={feedSort}
              options={[
                { label: '为我排序', value: 'personalized' },
                { label: '最新', value: 'latest' },
                { label: '重要', value: 'importance' }
              ]}
              onChange={(value) => { setFeedSort(value as typeof feedSort); setPage(1); }}
            />
          </div>

          <div className="filterbar">
            <div className="filter-tabs">
              <button className={feedMode === 'all' ? 'active' : ''} onClick={() => changeMode('all')}>全部信息 <b>{overview.all}</b></button>
              <button className={feedMode === 'unread' ? 'active' : ''} onClick={() => changeMode('unread')}>未读 <b>{overview.unread}</b></button>
              <button className={feedMode === 'relevant' ? 'active' : ''} onClick={() => changeMode('relevant')}>高相关 <b>{overview.relevant}</b></button>
            </div>
            <div className="feed-tools">
              <Input
                allowClear
                aria-label="搜索信息"
                prefix={<Search size={14} />}
                placeholder="搜索当前页"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              <select aria-label="按来源筛选" value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value); setPage(1); }}>
                <option value="">全部来源</option>
                {visibleSources.map((source) => <option value={source.id} key={source.id}>{source.name}</option>)}
              </select>
            </div>
          </div>

          <div className="feed-list">
            {visibleItems.length === 0 && (
              <Empty className="empty-feed" image={Empty.PRESENTED_IMAGE_SIMPLE} description={searchTerm ? '当前页面没有匹配结果' : '还没有符合条件的信息'}>
                {!searchTerm && <Button type="primary" onClick={() => setSettingsOpen(true)}>添加关注主题</Button>}
              </Empty>
            )}
            {visibleItems.map((item) => (
              <article className={`feed-row ${item.isRead ? 'read' : ''} ${item.importanceScore >= 0.9 ? 'highlighted' : ''}`} key={item.id}>
                {!item.isRead && <span className="unread-dot" />}
                <div className="feed-body">
                  <div className="feed-meta">
                    <span className={`source-label source-${item.source}`}>{item.sourceName}</span>
                    <span>{formatRelativeTime(item.collectedAt)}</span>
                    <button onClick={() => void openEvent(item)}><Layers3 size={12} />事件来源</button>
                  </div>
                  <a href={item.url || undefined} target="_blank" rel="noreferrer"><h2>{item.title}</h2></a>
                  <p>{item.analysisSummary || item.summary || '暂无摘要'}</p>
                  <div className="feed-footer">
                    <div className="feed-tags">
                      {item.keyword && <Tag>{item.keyword}</Tag>}
                      {item.aiStatus && <Tag>{item.aiStatus === 'fallback' ? '本地分析' : 'AI 分析'}</Tag>}
                    </div>
                    <div className="feed-actions">
                      <Tooltip title="重新分析"><Button aria-label="重新分析" type="text" size="small" icon={<Sparkles size={13} />} onClick={() => void analyze(item)} /></Tooltip>
                      <Tooltip title="有用"><Button aria-label="标记有用" type="text" size="small" className={item.feedback === 'helpful' ? 'selected' : ''} icon={<ThumbsUp size={13} />} onClick={() => void sendFeedback(item, 'helpful')} /></Tooltip>
                      <Tooltip title="无关"><Button aria-label="标记无关" type="text" size="small" className={item.feedback === 'irrelevant' ? 'selected' : ''} icon={<EyeOff size={13} />} onClick={() => void sendFeedback(item, 'irrelevant')} /></Tooltip>
                      <Tooltip title="重复"><Button aria-label="标记重复" type="text" size="small" className={item.feedback === 'duplicate' ? 'selected' : ''} icon={<Copy size={13} />} onClick={() => void sendFeedback(item, 'duplicate')} /></Tooltip>
                    </div>
                  </div>
                </div>
                <div className="score-column">
                  <strong>{Math.round(item.importanceScore * 100)}</strong>
                  <span>重要度</span>
                  {!item.isRead && <Tooltip title="标为已读"><Button aria-label="标为已读" icon={<Check size={13} />} onClick={() => void markRead(item)} /></Tooltip>}
                </div>
              </article>
            ))}
          </div>

          {feedResponse.totalPages > 1 && (
            <Pagination
              className="feed-pagination"
              current={page}
              pageSize={feedResponse.pageSize}
              total={feedResponse.total}
              showSizeChanger={false}
              onChange={setPage}
            />
          )}
        </section>

        <aside className="focus-aside">
          <section className="aside-section">
            <div className="aside-title">
              <h3>关注主题</h3>
              <Tooltip title="管理主题"><Button aria-label="管理主题" type="text" icon={<Plus size={14} />} onClick={() => setSettingsOpen(true)} /></Tooltip>
            </div>
            <div className="topic-overview">
              {topics.length === 0 && <button className="empty-topic" onClick={() => setSettingsOpen(true)}>添加第一个关注主题</button>}
              {topics.map((topic, index) => (
                <button className={index === 0 && topic.enabled ? 'active' : ''} key={topic.id} onClick={() => setSettingsOpen(true)}>
                  <span><i className={topic.enabled ? '' : 'paused'} />{topic.name}</span>
                  <b>{topic.keywords.filter((keyword) => keyword.enabled).length}</b>
                </button>
              ))}
            </div>
          </section>

          <section className="aside-section">
            <div className="aside-title">
              <h3>采集状态</h3>
              <span>{liveStatus}</span>
            </div>
            <dl className="collection-stats">
              <div><dt>运行来源</dt><dd>{selectedSources.length} / {visibleSources.length}</dd></div>
              <div><dt>本轮新增</dt><dd>{collection?.persistence.saved ?? 0}</dd></div>
              <div><dt>内容变化</dt><dd>{collection?.persistence.changes ?? 0}</dd></div>
            </dl>
            <div className="source-dots">
              {visibleSources.map((source) => <span className={selectedSources.includes(source.id) ? 'enabled' : ''} key={source.id}>{source.name}</span>)}
            </div>
            <Button className="manage-sources" type="text" icon={<Settings2 size={13} />} onClick={() => setSettingsOpen(true)}>管理采集设置</Button>
          </section>

          <button className="digest-button" onClick={() => void loadDigest()}>
            <Sparkles size={17} />
            <span><strong>查看今日摘要</strong><small>{overview.relevant} 条重点信息，{collection?.persistence.changes ?? 0} 条内容变化</small></span>
            <ChevronRight size={14} />
          </button>
        </aside>
      </main>

      <Drawer title="关注与采集设置" size={440} open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <section className="drawer-section">
          <div className="drawer-heading"><div><h2>采集来源</h2><p>选择每次运行时需要检索的平台</p></div><span>{selectedSources.length} 个已启用</span></div>
          <Checkbox.Group
            className="source-checkboxes"
            options={sources.map((source) => ({ label: source.name, value: source.id }))}
            value={selectedSources}
            onChange={(values) => setSelectedSources(values.map(String))}
          />
        </section>

        <section className="drawer-section">
          <div className="drawer-heading"><div><h2>新增主题</h2><p>主题用于组织关键词和排除词</p></div></div>
          <form className="topic-form" onSubmit={(event) => void createTopic(event)}>
            <Input value={topicName} onChange={(event) => setTopicName(event.target.value)} placeholder="主题名称，例如 AI Agent" />
            <Input value={topicAliases} onChange={(event) => setTopicAliases(event.target.value)} placeholder="别名，使用逗号分隔" />
            <Input value={topicExcludes} onChange={(event) => setTopicExcludes(event.target.value)} placeholder="排除词，可选" />
            <Button type="primary" htmlType="submit" icon={<Plus size={14} />} disabled={!topicName.trim()}>新增主题</Button>
          </form>
        </section>

        <section className="drawer-section topic-management">
          <div className="drawer-heading"><div><h2>关注主题</h2><p>{enabledKeywordCount} 个关键词正在参与采集</p></div></div>
          {topics.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关注主题" />}
          {topics.map((topic) => (
            <div className={`topic-editor ${topic.enabled ? '' : 'disabled'}`} key={topic.id}>
              <div className="topic-editor-head">
                <Switch size="small" checked={topic.enabled} onChange={(enabled) => void patchTopic(topic, { enabled })} />
                <strong>{topic.name}</strong>
                <div>
                  <Tooltip title="编辑主题"><Button aria-label={`编辑主题 ${topic.name}`} type="text" icon={<Pencil size={13} />} onClick={() => { setEditing({ kind: 'topic', topic }); setEditValue(topic.name); }} /></Tooltip>
                  <Tooltip title="删除主题"><Button aria-label={`删除主题 ${topic.name}`} type="text" danger icon={<Trash2 size={13} />} onClick={() => confirmDeleteTopic(topic)} /></Tooltip>
                </div>
              </div>
              {(topic.aliases.length > 0 || topic.excludeWords.length > 0) && <p className="topic-detail">{topic.aliases.length > 0 ? `别名：${topic.aliases.join('、')}` : ''}{topic.excludeWords.length > 0 ? ` · 排除：${topic.excludeWords.join('、')}` : ''}</p>}
              <div className="keyword-editor-list">
                {topic.keywords.map((keyword) => (
                  <span className={keyword.enabled ? '' : 'disabled'} key={keyword.id}>
                    {keyword.value}
                    <button title="编辑关键词" onClick={() => { setEditing({ kind: 'keyword', topic, keyword }); setEditValue(keyword.value); }}><Pencil size={11} /></button>
                    <button title={keyword.enabled ? '暂停关键词' : '启用关键词'} onClick={() => void patchKeyword(topic, keyword, { enabled: !keyword.enabled })}>{keyword.enabled ? <Eye size={11} /> : <EyeOff size={11} />}</button>
                    <button title="删除关键词" onClick={() => void deleteKeyword(topic, keyword)}><Trash2 size={11} /></button>
                  </span>
                ))}
              </div>
              <Input
                className="keyword-input"
                size="small"
                value={keywordDrafts[topic.id] ?? ''}
                onChange={(event) => setKeywordDrafts((current) => ({ ...current, [topic.id]: event.target.value }))}
                onPressEnter={() => void addKeyword(topic)}
                placeholder="输入关键词后回车"
                suffix={<button title="添加关键词" onClick={() => void addKeyword(topic)}><Plus size={13} /></button>}
              />
            </div>
          ))}
        </section>
      </Drawer>

      <Modal title={editing?.kind === 'topic' ? '编辑主题' : '编辑关键词'} open={Boolean(editing)} okText="保存" cancelText="取消" onOk={() => void saveEdit()} onCancel={() => setEditing(null)} okButtonProps={{ disabled: !editValue.trim(), 'aria-label': '保存修改' }}>
        <Input autoFocus value={editValue} onChange={(event) => setEditValue(event.target.value)} onPressEnter={() => void saveEdit()} />
      </Modal>

      <Modal title={eventDetail?.title} open={Boolean(eventDetail)} footer={null} width={640} onCancel={() => setEventDetail(null)}>
        {eventDetail && (
          <div className="detail-modal">
            <p>首次发现 {formatTime(eventDetail.firstSeenAt)} · 最近更新 {formatTime(eventDetail.lastSeenAt)} · {eventDetail.sourceCount} 个来源</p>
            <div className="modal-list">
              {eventDetail.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><span className={`source-label source-${source.source}`}>{source.sourceName}</span><strong>{source.title}</strong><ChevronRight size={14} /></a>)}
            </div>
          </div>
        )}
      </Modal>

      <Modal title={digest?.title ?? '今日摘要'} open={Boolean(digest)} footer={null} width={680} onCancel={() => setDigest(null)}>
        {digest && (
          <div className="detail-modal digest-modal">
            <p>共 {digest.total} 条 · 未读 {digest.unread} 条 · 内容变化 {digest.changes} 条</p>
            <div className="digest-sources">{Object.entries(digest.sourceCounts).map(([source, count]) => <Tag key={source}>{source} {count}</Tag>)}</div>
            <div className="modal-list">
              {digest.topItems.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今天还没有新信息" /> : digest.topItems.map((item) => <div key={item.id}><span>{item.sourceName} · 重要度 {Math.round(item.importanceScore * 100)}</span><strong>{item.title}</strong><p>{item.summary}</p></div>)}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#16734a',
          colorInfo: '#16734a',
          colorText: '#182230',
          colorTextSecondary: '#667085',
          colorBorder: '#d8dee7',
          colorBgLayout: '#f7f8fa',
          borderRadius: 6,
          fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
          fontSize: 13,
          controlHeight: 34
        },
        components: {
          Button: { fontWeight: 500 },
          Segmented: { itemSelectedBg: '#ffffff', trackBg: '#eef1f4' },
          Drawer: { paddingLG: 20 }
        }
      }}
    >
      <AntApp><SignalDock /></AntApp>
    </ConfigProvider>
  );
}

export default App;
