import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { App as AntApp, ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { io } from 'socket.io-client';
import { AppHeader } from './app/AppHeader';
import { AppModals } from './app/AppModals';
import { InboxView } from './features/inbox/InboxView';
import { TopicTagBar } from './features/topics/TopicTagBar';
import { SettingsPage } from './features/settings/SettingsPage';
import type { SettingsView } from './features/settings/SettingsPage';
import { ApiError, request } from './shared/api';
import { useApiNotice } from './shared/notify';
import { splitInput } from './shared/format';
import type {
  CollectionEvent, CollectionResult, Digest, EditingValue, EventDetail, FeedbackValue,
  FeedItem, FeedMode, FeedOverview, FeedResponse, FeedSort, Keyword, ServiceStatus, SourceOption, Topic
} from './shared/types';
import { LoginView } from './auth/LoginView';
import { EditorialWorkspace } from './features/editorial/EditorialWorkspace';
import type { EditorialBrief, WorkspaceView } from './shared/types';

function SignalDock() {
  const { modal } = AntApp.useApp();
  const notice = useApiNotice();
  // 错误统一走 antd 轻提示；api 层的连接错误已自带「功能名称」
  const setError = notice.error;
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('checking');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [feedResponse, setFeedResponse] = useState<FeedResponse>({ data: [], page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [feedLoading, setFeedLoading] = useState(true);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [overview, setOverview] = useState<FeedOverview>({ all: 0, unread: 0, relevant: 0, globalAll: 0, globalUnread: 0, topicCounts: {} });
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [feedMode, setFeedMode] = useState<FeedMode>('all');
  const [feedSort, setFeedSort] = useState<FeedSort>('personalized');
  const [searchTerm, setSearchTerm] = useState('');
  const [topicName, setTopicName] = useState('');
  const [topicAliases, setTopicAliases] = useState('');
  const [topicExcludes, setTopicExcludes] = useState('');
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EditingValue | null>(null);
  const [editValue, setEditValue] = useState('');
  const [collecting, setCollecting] = useState(false);
  const [eventDetail, setEventDetail] = useState<EventDetail | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [digestOpen, setDigestOpen] = useState(false);
  const [digestLoading, setDigestLoading] = useState(false);
  const digestCache = useRef<{ data: Digest; at: number } | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>('inbox');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [briefId, setBriefId] = useState('');
  const [briefRevision, setBriefRevision] = useState(0);
  const [editorialDirty, setEditorialDirty] = useState(false);
  const navigate = (view: WorkspaceView) => {
    const leavingEditor = !['topics', 'actions'].includes(view) && ['topics', 'actions'].includes(activeView);
    if (leavingEditor && editorialDirty && !window.confirm('有尚未保存的修改，离开会放弃这些修改，继续吗？')) return;
    setActiveView(view);
  };
  // 顶部主题标签与列表内的主题下拉共用同一个筛选状态
  const selectTopic = (topicId: string) => {
    setTopicFilter(topicId);
    setPage(1);
    if (activeView !== 'inbox') navigate('inbox');
  };
  const generateTopics = async () => {
    if (generating || selectedIds.length < 2) return;
    setGenerating(true); setError('');
    try {
      const result = await request<{ data: EditorialBrief[]; reused: boolean }>('/api/briefs/generate', { method: 'POST', body: JSON.stringify({ itemIds: selectedIds }) });
      setBriefId(result.data[0]?.id || ''); setBriefRevision(v => v + 1); setActiveView('topics');
    } catch (caught) { setError(caught instanceof Error ? caught.message : '选题生成失败'); }
    finally { setGenerating(false); }
  };

  const feedRequest = useRef(0);
  // 慢连接较多：刷新时保留已有列表，避免每次都闪一遍骨架屏
  const hasFeed = useRef(false);
  const loadFeed = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++feedRequest.current;
    if (!hasFeed.current) setFeedLoading(true);
    const query = new URLSearchParams({
      page: String(page),
      pageSize: '10',
      sort: feedSort,
      ...(searchTerm.trim() ? { q: searchTerm.trim() } : {}),
      ...(feedMode === 'unread' ? { unread: 'true' } : {}),
      ...(feedMode === 'relevant' ? { minRelevance: '0.8' } : {}),
      ...(sourceFilter ? { source: sourceFilter } : {}),
      ...(topicFilter ? { topicId: topicFilter } : {})
    });
    try {
      const data = await request<FeedResponse>('/api/information?' + query, { signal, feature: '信息流' });
      if (requestId === feedRequest.current && !signal?.aborted) { hasFeed.current = true; setFeedResponse(data); }
    } catch (caught) {
      if (!signal?.aborted && requestId === feedRequest.current) setError(caught instanceof Error ? caught.message : '信息流加载失败');
    } finally {
      if (!signal?.aborted && requestId === feedRequest.current) setFeedLoading(false);
    }
  }, [feedMode, feedSort, page, sourceFilter, searchTerm, topicFilter]);

  const loadOverview = useCallback(async () => {
    const query = topicFilter ? '?topicId=' + encodeURIComponent(topicFilter) : '';
    try {
      setOverview(await request<FeedOverview>('/api/information/overview' + query));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '概览加载失败');
    }
  }, [topicFilter]);

  const loadTopics = useCallback(async () => {
    setTopicsLoading(true);
    try {
      const list = (await request<{ data: Topic[] }>('/api/topics')).data;
      setTopics(list);
      // 主题被删除后，不能再让列表停留在一个不存在的筛选值上
      setTopicFilter((current) => current && !list.some((topic) => topic.id === current) ? '' : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '主题加载失败');
    } finally {
      setTopicsLoading(false);
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
      setSelectedSources(data.map((source) => source.id));
    }).catch((caught) => setError(caught instanceof Error ? caught.message : '来源加载失败'));
  }, [checkHealth, loadOverview, loadTopics]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void loadFeed(controller.signal), 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [loadFeed]);

  useEffect(() => {
    const socket = io({ withCredentials: true });
    socket.on('collection:status', (event: CollectionEvent) => {
      if (event.status === 'failed') setError('「采集任务」' + (event.error ?? '执行失败'));
      if (event.status === 'completed') {
        digestCache.current = null;
        void loadFeed();
        void loadOverview();
      }
    });
    const checkSession = () => { void request('/api/auth/me').catch(error => { if (error instanceof ApiError && error.status === 401) window.dispatchEvent(new Event('signaldock:unauthorized')); }); };
    socket.on('connect_error', checkSession);
    socket.on('disconnect', reason => { if (reason === 'io server disconnect') checkSession(); });
    return () => { socket.disconnect(); };
  }, [loadFeed, loadOverview]);

  const enabledKeywordCount = useMemo(
    () => topics.reduce((count, topic) => count + topic.keywords.filter((keyword) => keyword.enabled).length, 0),
    [topics]
  );
  const visibleItems = feedResponse.data;

  const runCollection = async () => {
    if (!selectedSources.length) {
      setError('「立即采集」请至少选择一个信息源');
      return;
    }
    setCollecting(true);
    try {
      const result = await request<CollectionResult>('/api/collect/run', {
        method: 'POST',
        body: JSON.stringify({ sources: selectedSources })
      });
      notice.success(`采集完成：新增 ${result.persistence.saved} 条，重复 ${result.persistence.duplicates} 条 · 勾选线索可继续提炼选题`);
      digestCache.current = null;
      setPage(1);
      await Promise.all([loadFeed(), loadOverview()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '采集失败');
    } finally {
      setCollecting(false);
    }
  };

  const createTopic = async (event: FormEvent) => {
    event.preventDefault();
    if (!topicName.trim()) return;
    try {
      await request('/api/topics', {
        method: 'POST',
        body: JSON.stringify({
          name: topicName,
          aliases: splitInput(topicAliases),
          excludeWords: splitInput(topicExcludes),
          sourceIds: selectedSources,
          frequencyMinutes: 120,
          notificationLevel: 'important'
        })
      });
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
      await request('/api/topics/' + topic.id, { method: 'PATCH', body: JSON.stringify(update) });
      await loadTopics();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '主题更新失败');
    }
  };

  const confirmDeleteTopic = (topic: Topic) => {
    modal.confirm({
      title: '删除“' + topic.name + '”？',
      content: '该主题下的关键词会一并删除。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true, 'aria-label': '确认删除主题' },
      cancelButtonProps: { 'aria-label': '取消删除主题' },
      async onOk() {
        try {
          await request('/api/topics/' + topic.id, { method: 'DELETE' });
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
      await request('/api/topics/' + topic.id + '/keywords', {
        method: 'POST',
        body: JSON.stringify({ value })
      });
      setKeywordDrafts((current) => ({ ...current, [topic.id]: '' }));
      await loadTopics();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '关键词添加失败');
    }
  };

  const patchKeyword = async (topic: Topic, keyword: Keyword, update: Partial<Keyword>) => {
    try {
      await request('/api/topics/' + topic.id + '/keywords/' + keyword.id, {
        method: 'PATCH',
        body: JSON.stringify(update)
      });
      await loadTopics();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '关键词更新失败');
    }
  };

  const deleteKeyword = async (topic: Topic, keyword: Keyword) => {
    try {
      await request('/api/topics/' + topic.id + '/keywords/' + keyword.id, { method: 'DELETE' });
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
      await request('/api/information/' + item.id + '/read', { method: 'PATCH' });
      await Promise.all([loadFeed(), loadOverview()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '标记已读失败');
    }
  };

  const sendFeedback = async (item: FeedItem, value: FeedbackValue) => {
    try {
      await request('/api/information/' + item.id + '/feedback', {
        method: 'PUT',
        body: JSON.stringify({ value })
      });
      await loadFeed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '反馈提交失败');
    }
  };

  const openEvent = async (item: FeedItem) => {
    try {
      setEventDetail((await request<{ data: EventDetail }>('/api/information/' + item.id + '/event')).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '事件详情加载失败');
    }
  };

  // 点击即打开弹窗，先展示加载态；5 分钟内重复点击直接命中缓存，不再等接口
  const loadDigest = useCallback(async () => {
    setDigestOpen(true);
    const cached = digestCache.current;
    if (cached && Date.now() - cached.at < 5 * 60_000) {
      setDigest(cached.data);
      setDigestLoading(false);
      return;
    }
    setDigestLoading(true);
    try {
      const data = (await request<{ data: Digest }>('/api/notifications/digest?period=daily')).data;
      digestCache.current = { data, at: Date.now() };
      setDigest(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '摘要加载失败');
      if (!digestCache.current) setDigestOpen(false);
    } finally {
      setDigestLoading(false);
    }
  }, []);

  const changeMode = (mode: FeedMode) => {
    setFeedMode(mode);
    setPage(1);
  };

  const topicSettingsProps = {
    sources,
    selectedSources,
    topicName,
    topicAliases,
    topicExcludes,
    topics,
    enabledKeywordCount,
    keywordDrafts,
    onSelectedSourcesChange: setSelectedSources,
    onTopicNameChange: setTopicName,
    onTopicAliasesChange: setTopicAliases,
    onTopicExcludesChange: setTopicExcludes,
    onCreateTopic: (event: FormEvent) => void createTopic(event),
    onPatchTopic: (topic: Topic, update: Partial<Topic>) => void patchTopic(topic, update),
    onDeleteTopic: confirmDeleteTopic,
    onPatchKeyword: (topic: Topic, keyword: Keyword, update: Partial<Keyword>) => void patchKeyword(topic, keyword, update),
    onDeleteKeyword: (topic: Topic, keyword: Keyword) => void deleteKeyword(topic, keyword),
    onAddKeyword: (topic: Topic) => void addKeyword(topic),
    onKeywordDraftChange: (topicId: string, value: string) => setKeywordDrafts((current) => ({ ...current, [topicId]: value })),
    onStartEdit: (value: EditingValue, nextEditValue: string) => { setEditing(value); setEditValue(nextEditValue); }
  };

  return (
    <div className="app-frame">
      <AppHeader
        serviceStatus={serviceStatus}
        unreadCount={overview.globalUnread}
        collecting={collecting}
        onCheckHealth={() => void checkHealth()}
        onLoadDigest={() => void loadDigest()}
        onRunCollection={() => void runCollection()}
        activeView={activeView}
        onNavigate={navigate}
        onLogout={() => {
          if (editorialDirty && !window.confirm('尚有未保存的修改，确定退出吗？')) return;
          void request('/api/auth/logout', { method: 'POST' }).then(() => window.dispatchEvent(new Event('signaldock:unauthorized'))).catch(caught => setError(caught instanceof Error ? caught.message : '退出失败'));
        }}
      />
      <TopicTagBar
        topics={topics}
        loading={topicsLoading}
        selectedTopicId={topicFilter}
        totalCount={overview.globalAll}
        topicCounts={overview.topicCounts}
        onSelectTopic={selectTopic}
        onManage={() => navigate('manage')}
      />
      {activeView === 'inbox' ? <main className="focus-layout">
        <InboxView
          overview={overview}
          feedSort={feedSort}
          feedMode={feedMode}
          searchTerm={searchTerm}
          sourceFilter={sourceFilter}
          topicFilter={topicFilter}
          sources={sources}
          topics={topics}
          items={visibleItems}
          loading={feedLoading}
          feedResponse={feedResponse}
          page={page}
          onSortChange={(sort) => { setFeedSort(sort); setPage(1); }}
          onModeChange={changeMode}
          onSearchChange={value => { setSearchTerm(value); setPage(1); }}
          onSourceChange={(source) => { setSourceFilter(source); setPage(1); }}
          onTopicChange={(topicId) => { setTopicFilter(topicId); setPage(1); }}
          onPageChange={setPage}
          onOpenSettings={() => navigate('manage')}
          onOpenEvent={(item) => void openEvent(item)}
          selectedIds={selectedIds}
          generating={generating}
          onToggleSelect={id => {
            if (!selectedIds.includes(id) && selectedIds.length >= 20) { setError('「提炼选题」最多选择 20 条线索'); return; }
            setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
          }}
          onSelectPage={() => setSelectedIds(current => [...new Set([...current, ...visibleItems.map(item => item.id)])].slice(0, 20))}
          onClearSelection={() => setSelectedIds([])}
          onGenerate={() => void generateTopics()}
          onFeedback={(item, value) => void sendFeedback(item, value)}
          onMarkRead={(item) => void markRead(item)}
        />
      </main> : activeView === 'topics' || activeView === 'actions' ? <EditorialWorkspace view={activeView} selectedId={briefId} revision={briefRevision} onSelect={setBriefId} onNavigate={navigate} onDirty={setEditorialDirty} /> : <SettingsPage view={activeView as SettingsView} onNavigate={navigate} onError={setError} topicSettings={topicSettingsProps} />}
      <AppModals
        editing={editing}
        editValue={editValue}
        eventDetail={eventDetail}
        digest={digest}
        digestOpen={digestOpen}
        digestLoading={digestLoading}
        onEditValueChange={setEditValue}
        onSaveEdit={() => void saveEdit()}
        onCloseEdit={() => setEditing(null)}
        onCloseEvent={() => setEventDetail(null)}
        onCloseDigest={() => setDigestOpen(false)}
      />
    </div>
  );
}

function App() {
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'anonymous'>('checking');
  useEffect(() => {
    const expired = () => setAuthState('anonymous');
    window.addEventListener('signaldock:unauthorized', expired);
    void request('/api/auth/me').then(() => setAuthState('authenticated')).catch(() => setAuthState('anonymous'));
    return () => window.removeEventListener('signaldock:unauthorized', expired);
  }, []);
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
      <AntApp>{authState === 'checking' ? <div className="auth-loading-shell" role="status" aria-label="加载中"><Spin size="large" /></div> : authState === 'authenticated' ? <SignalDock /> : <LoginView onLogin={() => setAuthState('authenticated')} />}</AntApp>
    </ConfigProvider>
  );
}

export default App;
