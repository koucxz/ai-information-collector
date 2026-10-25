import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { io } from 'socket.io-client';
import { AppHeader } from './app/AppHeader';
import { AppModals } from './app/AppModals';
import { FocusAside } from './features/inbox/FocusAside';
import { InboxView } from './features/inbox/InboxView';
import { TopicSettingsDrawer } from './features/topics/TopicSettingsDrawer';
import { request } from './shared/api';
import { splitInput } from './shared/format';
import type {
  CollectionEvent, CollectionResult, Digest, EditingValue, EventDetail, FeedbackValue,
  FeedItem, FeedMode, FeedResponse, FeedSort, Keyword, ServiceStatus, SourceOption, Topic
} from './shared/types';

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
  const [feedSort, setFeedSort] = useState<FeedSort>('personalized');
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
      setFeedResponse(await request<FeedResponse>('/api/information?' + query));
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
        setLiveStatus('刚刚更新 ' + (event.stats?.saved ?? 0) + ' 条');
        void loadFeed();
        void loadOverview();
      }
    });
    return () => { socket.disconnect(); };
  }, [loadFeed, loadOverview]);

  const enabledKeywordCount = useMemo(
    () => topics.reduce((count, topic) => count + topic.keywords.filter((keyword) => keyword.enabled).length, 0),
    [topics]
  );
  const visibleItems = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    if (!query) return feedResponse.data;
    return feedResponse.data.filter((item) => (
      [item.title, item.summary, item.analysisSummary, item.keyword, item.sourceName]
        .some((value) => value.toLocaleLowerCase().includes(query))
    ));
  }, [feedResponse.data, searchTerm]);

  const runCollection = async () => {
    if (!selectedSources.length) {
      setError('至少选择一个信息源。');
      return;
    }
    setCollecting(true);
    setLiveStatus('正在采集');
    try {
      const result = await request<CollectionResult>('/api/collect/run', {
        method: 'POST',
        body: JSON.stringify({ sources: selectedSources })
      });
      setCollection(result);
      setLiveStatus('刚刚更新 ' + result.persistence.saved + ' 条');
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
      await request('/api/topics', {
        method: 'POST',
        body: JSON.stringify({
          name: topicName,
          aliases: splitInput(topicAliases),
          excludeWords: splitInput(topicExcludes)
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

  const analyze = async (item: FeedItem) => {
    try {
      await request('/api/information/' + item.id + '/analyze', { method: 'POST' });
      await Promise.all([loadFeed(), loadOverview()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '分析失败');
    }
  };

  const openEvent = async (item: FeedItem) => {
    try {
      setEventDetail((await request<{ data: EventDetail }>('/api/information/' + item.id + '/event')).data);
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
      <AppHeader
        feedMode={feedMode}
        serviceStatus={serviceStatus}
        unreadCount={overview.unread}
        collecting={collecting}
        onChangeMode={changeMode}
        onCheckHealth={() => void checkHealth()}
        onLoadDigest={() => void loadDigest()}
        onRunCollection={() => void runCollection()}
      />
      {error && <Alert className="page-alert" type="error" message={error} closable onClose={() => setError('')} showIcon />}
      <main className="focus-layout">
        <InboxView
          overview={overview}
          feedSort={feedSort}
          feedMode={feedMode}
          searchTerm={searchTerm}
          sourceFilter={sourceFilter}
          sources={sources}
          items={visibleItems}
          feedResponse={feedResponse}
          page={page}
          onSortChange={(sort) => { setFeedSort(sort); setPage(1); }}
          onModeChange={changeMode}
          onSearchChange={setSearchTerm}
          onSourceChange={(source) => { setSourceFilter(source); setPage(1); }}
          onPageChange={setPage}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenEvent={(item) => void openEvent(item)}
          onAnalyze={(item) => void analyze(item)}
          onFeedback={(item, value) => void sendFeedback(item, value)}
          onMarkRead={(item) => void markRead(item)}
        />
        <FocusAside
          topics={topics}
          sources={sources}
          selectedSources={selectedSources}
          overview={overview}
          collection={collection}
          liveStatus={liveStatus}
          onOpenSettings={() => setSettingsOpen(true)}
          onLoadDigest={() => void loadDigest()}
        />
      </main>
      <TopicSettingsDrawer
        open={settingsOpen}
        sources={sources}
        selectedSources={selectedSources}
        topicName={topicName}
        topicAliases={topicAliases}
        topicExcludes={topicExcludes}
        topics={topics}
        enabledKeywordCount={enabledKeywordCount}
        keywordDrafts={keywordDrafts}
        onClose={() => setSettingsOpen(false)}
        onSelectedSourcesChange={setSelectedSources}
        onTopicNameChange={setTopicName}
        onTopicAliasesChange={setTopicAliases}
        onTopicExcludesChange={setTopicExcludes}
        onCreateTopic={(event) => void createTopic(event)}
        onPatchTopic={(topic, update) => void patchTopic(topic, update)}
        onDeleteTopic={confirmDeleteTopic}
        onPatchKeyword={(topic, keyword, update) => void patchKeyword(topic, keyword, update)}
        onDeleteKeyword={(topic, keyword) => void deleteKeyword(topic, keyword)}
        onAddKeyword={(topic) => void addKeyword(topic)}
        onKeywordDraftChange={(topicId, value) => setKeywordDrafts((current) => ({ ...current, [topicId]: value }))}
        onStartEdit={(value, nextEditValue) => { setEditing(value); setEditValue(nextEditValue); }}
      />
      <AppModals
        editing={editing}
        editValue={editValue}
        eventDetail={eventDetail}
        digest={digest}
        onEditValueChange={setEditValue}
        onSaveEdit={() => void saveEdit()}
        onCloseEdit={() => setEditing(null)}
        onCloseEvent={() => setEventDetail(null)}
        onCloseDigest={() => setDigest(null)}
      />
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
