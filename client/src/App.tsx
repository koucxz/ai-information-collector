import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Toaster, toast } from 'sonner';

type ServiceStatus = 'checking' | 'online' | 'offline';
type SourceInfo = { key: string; name: string; kind: string; description: string; enabled: boolean };
type Keyword = { id: string; value: string; enabled: boolean };
type Topic = { id: string; name: string; aliases: string[]; excludeWords: string[]; enabled: boolean; createdAt: string; keywords: Keyword[] };
type TopicDraft = { name: string; aliases: string; excludeWords: string };
type CollectionPreview = {
  data: Array<{ sourceName: string; title: string; summary: string; url: string }>;
  errors: Array<{ source: string; keyword: string; message: string }>;
  stats: { topics: number; keywords: number; results: number; bySource?: Record<string, number> };
  persistence?: { saved: number; duplicates: number; snapshots: number; changes: number };
};
type FeedItem = { id: string; sourceName: string; source: string; title: string; summary: string; importanceScore: number; relevanceScore: number; isRead: boolean; aiStatus: string; collectedAt: string; publishedAt: string | null };
type ConfirmOptions = { title: string; description?: string; confirmText?: string; onConfirm: () => Promise<void> };

const emptyDraft: TopicDraft = { name: '', aliases: '', excludeWords: '' };
/* 中英文逗号、顿号、换行都当作分隔符：用户从表格里粘贴一列关键词也能直接拆开 */
const SEPARATOR = /[,，、\n]/;
const splitInput = (value: string) => value.split(SEPARATOR).map((item) => item.trim()).filter(Boolean);

/* 信息流时间：设计稿是「12 分钟前」这种相对时间，不用绝对时间戳 */
const relativeTime = (iso?: string | null) => {
  if (!iso) return '';
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return '';
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} 天前` : new Date(timestamp).toLocaleDateString('zh-CN');
};

// 后端地址：默认走同源（Vercel 用 rewrites 把 /api 反代到腾讯云）。
// 如需直连后端域名，构建时设置 VITE_API_BASE=https://api.example.com
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
const apiUrl = (path: string) => `${API_BASE}${path}`;

/* 统一图标集：24 网格 / 1.9 描边 / currentColor，避免用字符图标导致基线错位 */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const IconRadar = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" {...stroke} aria-hidden="true">
    <path d="M12 3a9 9 0 1 1-6.36 2.64" />
    <path d="M12 7.2a4.8 4.8 0 1 0 3.4 1.4" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);
const IconPlus = () => (<svg width="15" height="15" viewBox="0 0 24 24" {...stroke} strokeWidth={2.1} aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>);
const IconRefresh = () => (<svg width="15" height="15" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" /><path d="M20.5 3.5V10h-6.2" /></svg>);
const IconSort = () => (<svg width="14" height="14" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M7 4v16M4 17l3 3 3-3" /><path d="M17 20V4M14 7l3-3 3 3" /></svg>);
const IconEdit = () => (<svg width="13" height="13" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M4 20h4L20 8l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>);
const IconPause = () => (<svg width="13" height="13" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg>);
const IconPlay = () => (<svg width="13" height="13" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M8 5l11 7-11 7V5z" /></svg>);
const IconTrash = () => (<svg width="13" height="13" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9L17.5 7" /></svg>);
const IconClose = () => (<svg width="11" height="11" viewBox="0 0 24 24" {...stroke} strokeWidth={2.2} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>);
/* 异步按钮的加载态：和图标集同一套描边风格 */
const IconSpinner = ({ size = 13 }: { size?: number }) => (
  <svg className="spin" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth="2.6" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
  </svg>
);

function App() {
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('checking');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [draft, setDraft] = useState<TopicDraft>(emptyDraft);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editingTopic, setEditingTopic] = useState<TopicDraft>(emptyDraft);
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [flashCreate, setFlashCreate] = useState(false);
  const [collection, setCollection] = useState<CollectionPreview | null>(() => {
    try {
      const cached = localStorage.getItem('signaldock:lastCollection');
      return cached ? (JSON.parse(cached) as CollectionPreview) : null;
    } catch { return null; }
  });
  const [collecting, setCollecting] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [feedSort, setFeedSort] = useState<'latest' | 'importance'>('latest');
  const [feedMeta, setFeedMeta] = useState({ page: 1, total: 0, totalPages: 1, unread: 0, today: 0 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [sourceList, setSourceList] = useState<SourceInfo[]>([]);
  /* 每个异步操作一个 key，按钮据此显示 spinner 并禁用，避免重复提交 */
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const createPanel = useRef<HTMLElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<number | null>(null);

  const isPending = (key: string) => Boolean(pending[key]);
  const run = async (key: string, action: () => Promise<void>) => {
    if (pending[key]) return;
    setPending((current) => ({ ...current, [key]: true }));
    try { await action(); }
    finally {
      setPending((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  /* 顶部「新增主题」原来只滚到「当前关注」，滚完看不出任何变化 —— 现在滚到表单、聚焦名称并闪一圈高亮 */
  const focusCreateForm = () => {
    createPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashCreate(false);
    window.setTimeout(() => setFlashCreate(true), 20);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashCreate(false), 1800);
    window.setTimeout(() => nameInput.current?.focus({ preventScroll: true }), 260);
  };

  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  // 反代链路可能有瞬时抖动（容器重启、TLS 握手、跨域预检），失败重试 3 次再判定离线
  const checkHealth = async () => {
    setServiceStatus('checking');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
        if (!response.ok) throw new Error('health check failed');
        const payload = (await response.json()) as { status?: string };
        if (payload.status === 'ok') { setServiceStatus('online'); return; }
      } catch { /* 落到下一次重试 */ }
      if (attempt < 2) await new Promise((resolve) => { setTimeout(resolve, 700); });
    }
    setServiceStatus('offline');
  };

  const loadTopics = async () => {
    try {
      const response = await fetch(apiUrl('/api/topics'));
      if (!response.ok) throw new Error('加载主题失败');
      const payload = (await response.json()) as { data: Topic[] };
      setTopics(payload.data);
      setError('');
    } catch { setError('主题加载失败，请确认后端服务已启动。'); }
  };
  // 采集改成多源后一次可能几百条，按页取、点「加载更多」追加，未读/今日数由后端按全库给
  const loadFeed = async (page = 1, append = false) => {
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: '20', sort: feedSort, ...(unreadOnly ? { unread: 'true' } : {}) });
      const response = await fetch(apiUrl(`/api/information?${query}`));
      if (!response.ok) throw new Error('信息流加载失败');
      const payload = await response.json() as { data: FeedItem[]; total: number; totalPages: number; unreadTotal: number; todayTotal: number };
      setFeed((current) => (append ? [...current, ...payload.data] : payload.data));
      setFeedMeta({ page, total: payload.total, totalPages: payload.totalPages, unread: payload.unreadTotal, today: payload.todayTotal });
    } catch (caught) { setError(netMessage(caught, '信息流加载失败')); }
  };

  const loadMore = () => {
    if (loadingMore || feedMeta.page >= feedMeta.totalPages) return;
    setLoadingMore(true);
    void loadFeed(feedMeta.page + 1, true).finally(() => setLoadingMore(false));
  };

  // 最近一次采集存在服务端，换设备或刷新后仍能看到；失败时退回本地缓存
  const loadLastCollection = async () => {
    try {
      const response = await fetch(apiUrl('/api/collect/last'), { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as { data: CollectionPreview | null };
      if (payload.data) setCollection(payload.data);
    } catch { /* 保留本地缓存 */ }
  };

  // 信息源清单由后端下发，前端不再写死「百度/B站/微博…」
  const loadSources = async () => {
    try {
      const response = await fetch(apiUrl('/api/collect/sources'), { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as { data: SourceInfo[] };
      setSourceList(payload.data);
    } catch { /* 拿不到就只显示采集到的来源 */ }
  };

  useEffect(() => { void checkHealth(); void loadTopics(); void loadFeed(); void loadLastCollection(); void loadSources(); }, [feedSort, unreadOnly]);

  const request = async (url: string, options: RequestInit = {}) => {
    const response = await fetch(apiUrl(url), { headers: { 'Content-Type': 'application/json' }, ...options });
    const payload = response.status === 204 ? null : await response.json() as { error?: string; data?: unknown };
    if (!response.ok) throw new Error(payload?.error ?? '操作失败');
    return payload;
  };

  const createTopic = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) { toast.error('请先填写主题名称。'); nameInput.current?.focus(); return; }
    void run('topic:create', async () => {
      try {
        await request('/api/topics', { method: 'POST', body: JSON.stringify({ name, aliases: splitInput(draft.aliases), excludeWords: splitInput(draft.excludeWords) }) });
        setDraft(emptyDraft);
        await loadTopics();
        setError('');
        toast.success(`已创建主题「${name}」`);
      } catch (caught) { toast.error(netMessage(caught, '主题创建失败')); }
    });
  };

  const updateTopic = (topicId: string) => { void run(`topic:update:${topicId}`, async () => {
    try { await request(`/api/topics/${topicId}`, { method: 'PATCH', body: JSON.stringify({ name: editingTopic.name, excludeWords: splitInput(editingTopic.excludeWords) }) }); setEditingTopicId(null); await loadTopics(); toast.success('主题已保存'); }
    catch (caught) { toast.error(netMessage(caught, '主题更新失败')); }
  }); };

  const toggleTopic = (topic: Topic) => { void run(`topic:toggle:${topic.id}`, async () => {
    try { await request(`/api/topics/${topic.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !topic.enabled }) }); await loadTopics(); toast.success(`已${topic.enabled ? '暂停' : '启用'}「${topic.name}」`); }
    catch (caught) { toast.error(netMessage(caught, '主题状态更新失败')); }
  }); };

  const deleteTopic = (topic: Topic) => setConfirmOptions({
    title: `删除主题「${topic.name}」？`,
    description: '该主题下的关键词会一起删除，已收集的信息不受影响。此操作不可撤销。',
    confirmText: '删除主题',
    onConfirm: async () => {
      await request(`/api/topics/${topic.id}`, { method: 'DELETE' });
      await loadTopics();
      toast.success(`已删除主题「${topic.name}」`);
    }
  });

  const handleConfirm = async () => {
    if (!confirmOptions) return;
    setConfirmBusy(true);
    try { await confirmOptions.onConfirm(); setConfirmOptions(null); }
    catch (caught) { toast.error(netMessage(caught, '操作失败，请重试')); }
    finally { setConfirmBusy(false); }
  };

  /* 关键词录入：支持一次传多个（粘贴/逗号分隔），已存在的先剔掉再提交，避免连续报 400 */
  const addKeywordValues = async (topic: Topic, input: string | string[]) => {
    const existing = new Set(topic.keywords.map((keyword) => keyword.value.trim().toLowerCase()));
    const values = (Array.isArray(input) ? input : splitInput(input)).map((value) => value.trim()).filter(Boolean);
    const fresh: string[] = [];
    values.forEach((value) => {
      const key = value.toLowerCase();
      if (existing.has(key)) return;
      existing.add(key);
      fresh.push(value);
    });
    setKeywordDrafts((current) => ({ ...current, [topic.id]: '' }));
    if (values.length === 0) return;
    if (fresh.length === 0) { toast.info(`「${values[0]}」已经在关键词里了`); return; }
    await run(`kw:add:${topic.id}`, async () => {
      try {
        for (const value of fresh) {
          await request(`/api/topics/${topic.id}/keywords`, { method: 'POST', body: JSON.stringify({ value }) });
        }
        await loadTopics();
        setError('');
        toast.success(fresh.length === 1 ? `已添加关键词「${fresh[0]}」` : `已添加 ${fresh.length} 个关键词`);
      } catch (caught) { toast.error(netMessage(caught, '关键词添加失败')); }
    });
  };

  /* 输入过程中遇到分隔符就即时落库，尾巴上没打完的部分留在输入框里继续编辑 */
  const onKeywordInput = (topic: Topic, value: string) => {
    if (SEPARATOR.test(value)) {
      const parts = value.split(SEPARATOR);
      const rest = parts.pop() ?? '';
      setKeywordDrafts((current) => ({ ...current, [topic.id]: rest }));
      if (parts.some((part) => part.trim())) void addKeywordValues(topic, parts);
      return;
    }
    setKeywordDrafts((current) => ({ ...current, [topic.id]: value }));
  };
  const previewCollection = async () => { setCollecting(true); try { const response = await fetch(apiUrl('/api/collect/preview?source=all&persist=true')); const payload = await response.json() as CollectionPreview & { error?: string }; if (!response.ok) throw new Error(payload.error ?? '采集失败'); setCollection(payload); try { localStorage.setItem('signaldock:lastCollection', JSON.stringify(payload)); } catch { /* 存储不可用时仅本次有效 */ } setError(''); await loadFeed(); toast.success(`采集完成：命中 ${payload.stats.results} 条，新增 ${payload.persistence?.saved ?? payload.data.length} 条`); } catch (caught) { toast.error(netMessage(caught, '采集失败')); } finally { setCollecting(false); } };
  const markRead = (id: string) => { void run(`read:${id}`, async () => { try { await fetch(apiUrl(`/api/information/${id}/read`), { method: 'PATCH' }); setFeed((current) => current.map((item) => (item.id === id ? { ...item, isRead: true } : item))); setFeedMeta((meta) => ({ ...meta, unread: Math.max(0, meta.unread - 1) })); } catch (caught) { toast.error(netMessage(caught, '标记已读失败')); } }); };
  const toggleKeyword = (topicId: string, keyword: Keyword) => { void run(`kw:toggle:${keyword.id}`, async () => { try { await request(`/api/topics/${topicId}/keywords/${keyword.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !keyword.enabled }) }); await loadTopics(); } catch (caught) { toast.error(netMessage(caught, '关键词状态更新失败')); } }); };
  const deleteKeyword = (topicId: string, keyword: Keyword) => { void run(`kw:del:${keyword.id}`, async () => { try { await request(`/api/topics/${topicId}/keywords/${keyword.id}`, { method: 'DELETE' }); await loadTopics(); toast.success(`已删除关键词「${keyword.value}」`); } catch (caught) { toast.error(netMessage(caught, '关键词删除失败')); } }); };

  const netMessage = (caught: unknown, fallback: string) => {
  if (caught instanceof TypeError) return '网络请求失败，请检查后端服务是否可访问。';
  return caught instanceof Error && caught.message ? caught.message : fallback;
};

const statusLabel = { checking: '正在连接服务', online: '服务已连接', offline: '服务未连接' }[serviceStatus];
  const enabledTopics = topics.filter((topic) => topic.enabled).length;
  const enabledKeywords = topics.reduce((count, topic) => count + topic.keywords.filter((keyword) => keyword.enabled).length, 0);
  const draftKeywords = splitInput(draft.aliases);
  const unreadCount = feedMeta.unread;
  const todayNew = feedMeta.today;
  // 启用的排在前面，暂停的沉到底部（设计稿的顺序）
  const sortedTopics = [...topics].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.createdAt.localeCompare(b.createdAt));

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><IconRadar /></span>
          <span className="brand-name">SignalDock</span>
          <span className="brand-sub">AI 信息雷达</span>
        </div>
        <div className="topbar-right">
          <span className={`status status-${serviceStatus}`}><i />{statusLabel}</span>
          <button className="icon-btn" onClick={() => { void checkHealth(); void loadTopics(); void loadFeed(); }} title="重新检查服务状态">
            <IconRefresh />
          </button>
        </div>
      </header>

      <div className="wrap">
        <div className="page-head">
          <div>
            <h1>信息流</h1>
            <p>{topics.length > 0 ? `围绕 ${enabledTopics} 个关注主题持续收集，合并重复内容，识别变化后交给你` : '还没有关注主题，添加一个就能开始收集'}</p>
          </div>
          <button className="btn btn-primary" onClick={focusCreateForm} aria-controls="create-topic-form">
            <IconPlus />新增主题
          </button>
        </div>

        <div className="stat-row">
          <div className="stat"><span className="stat-label">今日新信息</span><span className="stat-value">{todayNew}<small>条</small></span></div>
          <div className="stat"><span className="stat-label">启用关键词</span><span className="stat-value">{enabledKeywords}<small>个</small></span></div>
          <div className="stat"><span className="stat-label">关注主题</span><span className="stat-value">{topics.length}<small>个</small></span></div>
        </div>

        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} title="关闭"><IconClose /></button></div>}

        <div className="grid">
          <section className="card feed-card">
            <div className="card-head">
              <h2>全部信息<span className="count">{feedMeta.total}</span></h2>
              <div className="seg">
                <button className={unreadOnly ? '' : 'active'} onClick={() => setUnreadOnly(false)}>全部</button>
                <button className={unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(true)}>未读{unreadCount > 0 ? ` ${unreadCount}` : ''}</button>
              </div>
              <button className="icon-btn" onClick={() => setFeedSort(feedSort === 'latest' ? 'importance' : 'latest')} title={feedSort === 'latest' ? '当前：按最新，点击切换为按重要程度' : '当前：按重要程度，点击切换为按最新'}>
                <IconSort />
              </button>
              <button className="btn btn-ghost" onClick={() => void previewCollection()} disabled={collecting}>
                {collecting ? <IconSpinner /> : <IconRefresh />}{collecting ? '采集中…' : '试采一轮'}
              </button>
            </div>

            <div className="feed">
              {feed.length === 0 && (
                <div className="empty-state">
                  <span className="empty-icon"><IconPlus /></span>
                  <p>{unreadOnly ? '没有未读信息' : '还没有已保存的信息'}</p>
                  <small>{unreadOnly ? '切换回「全部」看看' : '点击「试采一轮」开始收集'}</small>
                </div>
              )}
              {feed.map((item) => (
                <article className={`item ${item.isRead ? 'read' : ''}`} key={item.id}>
                  <div className="item-main">
                    <div className="item-top">
                      <span className="src">{item.sourceName}</span>
                      <span className="dot-sep">·</span>
                      <span>{relativeTime(item.publishedAt ?? item.collectedAt)}</span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.summary || '暂无摘要'}</p>
                  </div>
                  <div className="item-side">
                    <span className={item.aiStatus === 'ai' ? 'chip chip-ai' : 'chip chip-local'}>{item.aiStatus === 'ai' ? 'AI 分析' : item.aiStatus === 'fallback' ? '本地分析' : '待分析'}</span>
                    <span className="rel">相关性 <b>{Math.round(item.relevanceScore * 100)}%</b></span>
                    {!item.isRead && (
                      <button className="btn-mini" onClick={() => void markRead(item.id)} disabled={isPending(`read:${item.id}`)}>
                        {isPending(`read:${item.id}`) ? <><IconSpinner size={10} />标记中</> : '标为已读'}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {feedMeta.page < feedMeta.totalPages && (
                <div className="load-more">
                  <button className="btn btn-ghost" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? <IconSpinner /> : null}{loadingMore ? '加载中…' : `加载更多（还有 ${feedMeta.total - feed.length} 条）`}
                  </button>
                </div>
              )}
            </div>
          </section>

          <div className="side">
            <section className="card" id="topics">
              <div className="card-head">
                <h2>当前关注<span className="count">{topics.length}</span></h2>
                <span className="head-meta">{enabledTopics} 个启用</span>
              </div>

              {topics.length === 0 && (
                <div className="empty-state compact">
                  <span className="empty-icon"><IconPlus /></span>
                  <p>还没有关注主题</p>
                  <small>在下方添加第一个</small>
                </div>
              )}

              {sortedTopics.map((topic) => {
                const activeKeywords = topic.keywords.filter((keyword) => keyword.enabled);
                const toggling = isPending(`topic:toggle:${topic.id}`);
                return (
                  <div className="topic" key={topic.id}>
                    <div className="topic-head">
                      <strong>{topic.name}</strong>
                      <span className={toggling ? 'pill busy' : topic.enabled ? 'pill' : 'pill off'}>
                        {toggling ? <><IconSpinner size={9} />处理中</> : topic.enabled ? '启用' : '暂停'}
                      </span>
                      <div className="topic-actions">
                        <button title="编辑主题" disabled={toggling} onClick={() => { setEditingTopicId(topic.id); setEditingTopic({ name: topic.name, aliases: '', excludeWords: topic.excludeWords.join('，') }); }}><IconEdit /></button>
                        <button title={topic.enabled ? '暂停主题' : '启用主题'} disabled={toggling} onClick={() => toggleTopic(topic)}>
                          {toggling ? <IconSpinner size={12} /> : topic.enabled ? <IconPause /> : <IconPlay />}
                        </button>
                        <button title="删除主题" disabled={toggling} onClick={() => deleteTopic(topic)}><IconTrash /></button>
                      </div>
                    </div>

                    {/* 收起态只显示关键词胶囊（设计稿）；增删与启停都在「编辑」里做 */}
                    <div className="chips">
                      {activeKeywords.length === 0
                        ? <span className="kw muted">无启用关键词</span>
                        : activeKeywords.map((keyword) => (
                          <span className={`kw ${topic.enabled ? '' : 'muted'}`} key={keyword.id}>{keyword.value}</span>
                        ))}
                    </div>

                    {editingTopicId === topic.id && (
                      <div className="topic-edit">
                        <label className="field-label" htmlFor={`topic-name-${topic.id}`}>主题名称</label>
                        <input id={`topic-name-${topic.id}`} className="field" value={editingTopic.name} onChange={(event) => setEditingTopic({ ...editingTopic, name: event.target.value })} placeholder="主题名称" />
                        <label className="field-label">关键词</label>
                        <div className="kw-edit">
                          {topic.keywords.map((keyword) => {
                            const busy = isPending(`kw:toggle:${keyword.id}`) || isPending(`kw:del:${keyword.id}`);
                            return (
                              <span className={`kw kw-editable ${keyword.enabled ? '' : 'kw-off'}`} key={keyword.id}>
                                <button className="kw-name" disabled={busy} title={keyword.enabled ? '点击暂停该关键词' : '点击启用该关键词'} onClick={() => toggleKeyword(topic.id, keyword)}>
                                  {isPending(`kw:toggle:${keyword.id}`) ? <IconSpinner size={10} /> : keyword.value}
                                </button>
                                <button className="kw-del" disabled={busy} title="删除关键词" onClick={() => deleteKeyword(topic.id, keyword)}>
                                  {isPending(`kw:del:${keyword.id}`) ? <IconSpinner size={10} /> : <IconClose />}
                                </button>
                              </span>
                            );
                          })}
                          <form className="kw-add" onSubmit={(event) => { event.preventDefault(); void addKeywordValues(topic, keywordDrafts[topic.id] ?? ''); }}>
                            <input
                              className="kw-input"
                              placeholder="输入关键词，回车添加"
                              aria-label="添加关键词"
                              value={keywordDrafts[topic.id] ?? ''}
                              disabled={isPending(`kw:add:${topic.id}`)}
                              onChange={(event) => onKeywordInput(topic, event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                                  event.preventDefault();
                                  void addKeywordValues(topic, keywordDrafts[topic.id] ?? '');
                                }
                                if (event.key === 'Escape') {
                                  event.preventDefault();
                                  setKeywordDrafts((current) => ({ ...current, [topic.id]: '' }));
                                }
                              }}
                              onBlur={() => { const value = (keywordDrafts[topic.id] ?? '').trim(); if (value) void addKeywordValues(topic, value); }}
                            />
                            <button className="kw-submit" type="submit" title="添加关键词" disabled={isPending(`kw:add:${topic.id}`) || !(keywordDrafts[topic.id] ?? '').trim()}>
                              {isPending(`kw:add:${topic.id}`) ? <IconSpinner size={11} /> : <IconPlus />}
                            </button>
                          </form>
                        </div>
                        <p className="kw-hint">回车、逗号或点「+」都能添加；粘贴多个会自动拆成多个关键词。</p>
                        <label className="field-label" htmlFor={`topic-exclude-${topic.id}`}>排除词（可选）</label>
                        <input id={`topic-exclude-${topic.id}`} className="field" value={editingTopic.excludeWords} onChange={(event) => setEditingTopic({ ...editingTopic, excludeWords: event.target.value })} placeholder="逗号分隔，如：招聘，广告" />
                        <div className="edit-actions">
                          <button className="btn btn-mini" onClick={() => updateTopic(topic.id)} disabled={isPending(`topic:update:${topic.id}`)}>
                            {isPending(`topic:update:${topic.id}`) ? <><IconSpinner size={10} />保存中</> : '保存'}
                          </button>
                          <button className="btn btn-mini" onClick={() => setEditingTopicId(null)} disabled={isPending(`topic:update:${topic.id}`)}>取消</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>

            <section className={`card create-card${flashCreate ? ' flash' : ''}`} ref={createPanel}>
              <div className="card-head">
                <h2>新增主题</h2>
                <span className="head-meta">填名称即可，关键词可选</span>
              </div>
              <form className="form" id="create-topic-form" onSubmit={createTopic}>
                <label className="field-label" htmlFor="topic-name">主题名称</label>
                <input id="topic-name" ref={nameInput} className="field" placeholder="例如：人工智能" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                <label className="field-label" htmlFor="topic-keywords">关键词</label>
                <input id="topic-keywords" className="field" placeholder="逗号分隔，例如：大模型，RAG，Agent" value={draft.aliases} onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} />
                <p className="field-hint">
                  {draftKeywords.length > 0
                    ? `将添加 ${draftKeywords.length} 个关键词：${draftKeywords.slice(0, 4).join('、')}${draftKeywords.length > 4 ? '…' : ''}`
                    : '逗号、顿号或换行分隔，保存时自动拆成多个关键词'}
                </p>
                <input className="field" placeholder="排除词，逗号分隔（可选）" value={draft.excludeWords} onChange={(event) => setDraft({ ...draft, excludeWords: event.target.value })} />
                <button className="btn btn-primary" type="submit" disabled={isPending('topic:create')}>
                  {isPending('topic:create') ? <><IconSpinner />保存中…</> : <><IconPlus />保存主题</>}
                </button>
              </form>
            </section>

            <section className="card">
              <div className="card-head">
                <h2>最近一次采集</h2>
                <span className="head-meta">{collection ? `${collection.stats.results} 条结果${collection.persistence ? ` · ${collection.persistence.duplicates} 重复` : ''}` : '暂无记录'}</span>
              </div>
              {collection ? (
                <div className="collect">
                  <div className="collect-top">
                    <span className="chip chip-local">{collection.stats.bySource ? `${Object.keys(collection.stats.bySource).length} 个来源` : 'fixture'}</span>
                    <span>{collection.persistence ? `已入库 ${collection.persistence.saved} 条，识别 ${collection.persistence.changes} 处变化` : `${collection.stats.keywords} 个关键词，匹配 ${collection.data.length} 条`}</span>
                  </div>
                  {collection.stats.bySource && Object.keys(collection.stats.bySource).length > 0 && (
                    <p className="collect-by">
                      {Object.entries(collection.stats.bySource).map(([key, count]) => `${sourceList.find((source) => source.key === key)?.name ?? key} ${count}`).join(' · ')}
                    </p>
                  )}
                  <div className="collect-list">
                    {collection.data.slice(0, 4).map((item) => (
                      <a className="collect-item" href={item.url} target="_blank" rel="noreferrer" key={item.url}>
                        <span>{item.sourceName}</span>
                        <strong>{item.title}</strong>
                      </a>
                    ))}
                  </div>
                  {collection.errors.length > 0 && (
                    <div className="collect-errors">{collection.errors.map((item) => <span key={`${item.source}-${item.keyword}`}>{item.source} / {item.keyword}：{item.message}</span>)}</div>
                  )}
                </div>
              ) : <p className="hint">还没有采集记录，点信息流右上角「试采一轮」。</p>}
            </section>

            <section className="card">
              <div className="card-head"><h2>信息来源</h2><span className="head-meta">{sourceList.length} 个</span></div>
              <div className="sources">
                {sourceList.map((source) => {
                  const count = collection?.stats.bySource?.[source.key];
                  // 本轮没参与的源（如按需启用的 360 搜索、演示数据）用虚线弱化，避免看起来像「采到 0 条」
                  const idle = Boolean(collection?.stats.bySource) && count === undefined;
                  return (
                    <span className={`kw${idle ? ' muted' : ''}`} key={source.key} title={`${source.description}${count ? ` · 本轮 ${count} 条` : ' · 本轮未参与'}`}>
                      {source.name}{count ? ` ${count}` : ''}
                    </span>
                  );
                })}
              </div>
            </section>
          </div>
        </div>

        <footer className="footer">
          <div className="steps">
            <span className="step done"><i />关注主题</span><span className="step-line" />
            <span className="step done"><i />信息源采集</span><span className="step-line" />
            <span className="step current"><i />去重与变化检测</span><span className="step-line" />
            <span className="step"><i />AI 分析</span>
          </div>
        </footer>
      </div>

      {/* 轻提示：sonner（可堆叠、可带操作按钮），配色对齐白底主题 */}
      <Toaster position="bottom-center" theme="dark" offset={24} gap={8} visibleToasts={3} toastOptions={{ duration: 2600 }} />

      {/* 确认弹窗：Radix Dialog，替掉 window.confirm，自带焦点陷阱与 Esc 关闭 */}
      <Dialog.Root open={Boolean(confirmOptions)} onOpenChange={(open) => { if (!open && !confirmBusy) setConfirmOptions(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dlg-overlay" />
          <Dialog.Content className="dlg" aria-describedby="dlg-desc">
            <Dialog.Title className="dlg-title">{confirmOptions?.title}</Dialog.Title>
            {confirmOptions?.description && <Dialog.Description id="dlg-desc" className="dlg-desc">{confirmOptions.description}</Dialog.Description>}
            <div className="dlg-actions">
              <Dialog.Close asChild>
                <button className="btn btn-ghost" disabled={confirmBusy}>取消</button>
              </Dialog.Close>
              <button className="btn btn-danger" onClick={() => void handleConfirm()} disabled={confirmBusy}>
                {confirmBusy ? <><IconSpinner />处理中…</> : (confirmOptions?.confirmText ?? '确认')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}

export default App;
