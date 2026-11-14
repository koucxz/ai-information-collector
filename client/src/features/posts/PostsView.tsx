import { useCallback, useEffect, useRef, useState } from 'react';
import { App as AntApp, Button, Dropdown, Empty, Input, Segmented, Skeleton, Tag, Tooltip } from 'antd';
import { Archive, CheckCircle2, Copy, Download, ExternalLink, FilePlus2, Link2, MoreHorizontal, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import { request } from '../../shared/api';
import { useApiNotice } from '../../shared/notify';
import { originalUrl } from '../../shared/links';
import { formatRelativeTime } from '../../shared/format';
import { MarkdownView } from '../../shared/markdown';
import type { BriefStatus, EditorialBrief } from '../../shared/types';

type Props = {
  selectedId: string;
  revision: number;
  onSelect: (id: string) => void;
  onDirty: (dirty: boolean) => void;
  onNavigate: (view: 'inbox' | 'saved') => void;
};

const editable = (brief: EditorialBrief) => ({
  title: brief.title, content: brief.content ?? '', tags: brief.tags ?? [],
  tasks: brief.tasks, archived: brief.archived
});
const statusOf = (brief: EditorialBrief) => {
  if (brief.archived) return { label: '已归档', color: 'default' };
  if (brief.status === 'published') return { label: '已发布', color: 'green' };
  return { label: '草稿', color: 'blue' };
};
const postMarkdown = (brief: EditorialBrief) => {
  const tags = brief.tags?.length ? `标签：${brief.tags.join(' / ')}\n\n` : '';
  const sources = brief.sources.length
    ? `\n\n## 来源\n\n${brief.sources.map((source, index) => `${index + 1}. [${source.title}](${originalUrl(source.url)}) · ${source.sourceName}`).join('\n')}`
    : '';
  const digest = brief.digest ? `> ${brief.digest}\n\n` : '';
  return `# ${brief.title}\n\n${digest}${tags}${(brief.content ?? '').trim()}${sources}\n`;
};

/**
 * 文章：左边是文章列表，右边是编辑器（正文 + Markdown 预览 + 来源引用）。
 * 发布只是记录状态，不往任何平台推送；导出 Markdown 后自行发布。
 */
export function PostsView(props: Props) {
  const { modal } = AntApp.useApp();
  const notice = useApiNotice();
  const [briefs, setBriefs] = useState<EditorialBrief[]>([]);
  const briefsRef = useRef<EditorialBrief[]>([]);
  const [base, setBase] = useState<EditorialBrief | null>(null);
  const [draft, setDraft] = useState<EditorialBrief | null>(null);
  const draftRef = useRef<EditorialBrief | null>(null);
  draftRef.current = draft;
  const [currentId, setCurrentId] = useState(props.selectedId);
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('active');
  const [newTag, setNewTag] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [localRevision, setLocalRevision] = useState(0);
  const writeTimer = useRef<number | undefined>(undefined);

  const dirty = !!draft && !!base && JSON.stringify(editable(draft)) !== JSON.stringify(editable(base));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => { props.onDirty(dirty); }, [dirty, props.onDirty]);
  useEffect(() => () => props.onDirty(false), [props.onDirty]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const applyBriefs = useCallback((next: EditorialBrief[]) => { briefsRef.current = next; setBriefs(next); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await request<{ data: EditorialBrief[] }>('/api/briefs', { feature: '文章' })).data;
      applyBriefs(list);
      const chosen = list.find((item) => item.id === currentIdRef.current) || list[0] || null;
      setBase(chosen); setDraft(chosen);
      if (chosen) { setCurrentId(chosen.id); props.onSelect(chosen.id); }
    } catch (caught) {
      notice.error(caught instanceof Error ? caught.message : '「文章」加载失败，请稍后重试');
    } finally { setLoading(false); }
  }, [applyBriefs, notice.error, props.onSelect]);
  useEffect(() => { void load(); }, [load, props.revision, localRevision]);
  useEffect(() => { setCurrentId(props.selectedId); }, [props.selectedId]);

  const pick = (id: string) => {
    if (busy || id === currentId) return;
    const choose = () => {
      const chosen = briefsRef.current.find((item) => item.id === id) || null;
      setCurrentId(id); props.onSelect(id); setBase(chosen); setDraft(chosen);
    };
    if (dirtyRef.current) {
      modal.confirm({ title: '有尚未保存的修改', content: '切换文章会放弃这些修改，继续吗？', okText: '放弃修改', cancelText: '继续编辑', onOk: choose });
    } else choose();
  };

  const save = async (extra?: { status?: BriefStatus; archived?: boolean }) => {
    const current = draftRef.current;
    if (!current || busy) return;
    if (!current.title.trim()) { notice.error('请先写上文章标题'); return; }
    setBusy(true);
    try {
      const { data } = await request<{ data: EditorialBrief }>('/api/briefs/' + current.id, {
        method: 'PATCH', feature: '文章编辑',
        body: JSON.stringify({
          version: current.version, title: current.title, content: current.content ?? '',
          tags: current.tags ?? [], tasks: current.tasks, ...(extra ?? {})
        })
      });
      setDraft(data); setBase(data);
      applyBriefs(briefsRef.current.map((item) => item.id === data.id ? data : item));
      notice.success(extra?.status === 'published' ? '已标记为发布，正文与来源引用已保留'
        : extra?.status === 'draft' ? '已撤销发布标记，回到草稿'
          : extra?.archived === true ? '文章已归档，可随时恢复'
            : extra?.archived === false ? '文章已恢复' : '「文章编辑」修改已保存');
    } catch (caught) {
      notice.error(caught instanceof Error ? caught.message : '「文章编辑」保存失败，当前内容已保留');
    } finally { setBusy(false); }
  };

  // 写稿在服务端后台跑，页面隔 2.5 秒问一次；用户没在改这篇才把正文铺回编辑器
  const watchWrite = useCallback((id: string) => {
    window.clearTimeout(writeTimer.current);
    const tick = async () => {
      try {
        const { data } = await request<{ data: EditorialBrief }>('/api/briefs/' + id, { feature: '文章' });
        applyBriefs(briefsRef.current.map((item) => item.id === data.id ? data : item));
        if (data.writing) { writeTimer.current = window.setTimeout(() => void tick(), 2500); return; }
        if (currentIdRef.current === id && !dirtyRef.current) { setDraft(data); setBase(data); }
        if (data.writeNote) notice.error(data.writeNote);
        else notice.success('正文已按素材写好，可以接着改');
      } catch {
        writeTimer.current = window.setTimeout(() => void tick(), 4000);
      }
    };
    writeTimer.current = window.setTimeout(() => void tick(), 2000);
  }, [applyBriefs, notice]);

  useEffect(() => {
    if (!draft?.writing) return;
    watchWrite(draft.id);
    return () => window.clearTimeout(writeTimer.current);
  }, [draft?.id, draft?.writing, watchWrite]);

  const createBlank = async () => {
    const doCreate = async () => {
      setBusy(true);
      try {
        const { data } = await request<{ data: EditorialBrief }>('/api/briefs', { method: 'POST', feature: '新建草稿', body: JSON.stringify({ itemIds: [] }) });
        applyBriefs([data, ...briefsRef.current]);
        setBase(data); setDraft(data); setCurrentId(data.id); props.onSelect(data.id); setFilter('active'); setMode('edit');
        notice.success('已新建空白草稿，写好正文后保存');
      } catch (caught) {
        notice.error(caught instanceof Error ? caught.message : '「新建草稿」失败，请稍后重试');
      } finally { setBusy(false); }
    };
    if (dirtyRef.current) {
      modal.confirm({ title: '有尚未保存的修改', content: '新建草稿会放弃当前未保存的修改，继续吗？', okText: '放弃修改', cancelText: '继续编辑', onOk: () => void doCreate() });
    } else void doCreate();
  };

  const exportText = async (copy: boolean) => {
    const current = draftRef.current;
    if (!current) return;
    const text = postMarkdown(current);
    if (copy) {
      try { await navigator.clipboard.writeText(text); notice.success('「正文导出」已复制到剪贴板'); }
      catch { notice.error('浏览器未允许复制，请改用导出文件'); }
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${current.title.replace(/[\\/:*?"<>|]/g, '_') || 'article'}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice.success('「正文导出」Markdown 已下载');
  };

  const publish = () => {
    const current = draftRef.current;
    if (!current) return;
    const body = (current.content ?? '').trim();
    if (body.length < 120) {
      modal.confirm({
        title: '正文还比较短',
        content: `现在正文 ${body.length} 字。标记发布只是记录状态，仍然继续吗？`,
        okText: '仍然标记发布', cancelText: '继续写',
        onOk: () => void save({ status: 'published' })
      });
    } else void save({ status: 'published' });
  };

  const remove = () => {
    const current = draftRef.current;
    if (!current || busy) return;
    modal.confirm({
      title: '删除这篇文章？',
      content: `「${current.title}」删除后不会进入归档，也无法恢复。`,
      okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          await request('/api/briefs/' + current.id, { method: 'DELETE', feature: '删除文章' });
          const rest = briefsRef.current.filter((item) => item.id !== current.id);
          applyBriefs(rest);
          const next = rest[0] ?? null;
          setBase(next); setDraft(next); setCurrentId(next?.id ?? ''); props.onSelect(next?.id ?? '');
          notice.success('文章已删除');
        } catch (caught) {
          notice.error(caught instanceof Error ? caught.message : '「删除文章」失败，请稍后重试');
        } finally { setBusy(false); }
      }
    });
  };

  const rewrite = () => {
    const current = draftRef.current;
    if (!current || busy) return;
    if (!current.sources.length) { notice.error('这篇还没有来源素材，先从收藏夹选素材新建草稿'); return; }
    const run = async () => {
      setBusy(true);
      try {
        const { data } = await request<{ data: EditorialBrief }>('/api/briefs/' + current.id + '/rewrite', { method: 'POST', feature: '自动写稿' });
        setDraft(data); setBase(data);
        applyBriefs(briefsRef.current.map((item) => item.id === data.id ? data : item));
        setMode('edit');
        notice.success('已开始写稿，完成后正文会自动填进来');
      } catch (caught) {
        notice.error(caught instanceof Error ? caught.message : '「自动写稿」失败，原正文已保留');
      } finally { setBusy(false); }
    };
    if (dirtyRef.current) {
      modal.confirm({ title: '会覆盖当前正文', content: '这篇文章有未保存的修改，重新生成会覆盖正文，继续吗？', okText: '覆盖重写', cancelText: '取消', onOk: () => void run() });
    } else void run();
  };

  const insertSources = () => {
    const current = draftRef.current;
    if (!current) return;
    if (!current.sources.length) { notice.error('这篇草稿还没有来源引用，可以先从收藏夹选素材新建'); return; }
    const block = `\n\n## 来源\n\n${current.sources.map((source, index) => `${index + 1}. [${source.title}](${originalUrl(source.url)}) · ${source.sourceName}`).join('\n')}\n`;
    setDraft({ ...current, content: (current.content ?? '').trimEnd() + block });
    setMode('edit');
    notice.success('已在正文末尾插入来源引用');
  };

  const addTag = () => {
    const value = newTag.trim();
    if (!value || !draft) return;
    if ((draft.tags ?? []).includes(value) || (draft.tags ?? []).length >= 10) { setNewTag(''); return; }
    setDraft({ ...draft, tags: [...(draft.tags ?? []), value] });
    setNewTag('');
  };

  const filtered = briefs.filter((item) => filter === 'all' || (filter === 'archived' ? item.archived : filter === 'published' ? !item.archived && item.status === 'published' : !item.archived && item.status !== 'published'));
  const content = draft?.content ?? '';
  const words = content.replace(/\s/g, '').length;

  if (loading) return <main className="workspace-view posts-view posts-loading" role="status" aria-label="加载中"><Skeleton active title={{ width: '38%' }} paragraph={{ rows: 10 }} /></main>;

  return <main className="workspace-view posts-view">
    <header className="view-heading">
      <div>
        <p>共 {briefs.length} 篇文章 · 草稿与已发布</p>
        <h1>文章</h1>
        <span>左边选文章，右边写正文。勾选素材新建时会先按素材写一版。</span>
      </div>
      <div className="view-heading-actions">
        <Button onClick={() => props.onNavigate('saved')}>从收藏夹选素材</Button>
        <Button type="primary" icon={<FilePlus2 size={14} />} loading={busy} onClick={() => void createBlank()}>新建草稿</Button>
      </div>
    </header>

    <div className="posts-layout">
      <aside className="posts-library" aria-label="文章列表">
        <Segmented block size="small" value={filter} onChange={(value) => setFilter(String(value))} options={[{ label: '草稿', value: 'active' }, { label: '已发布', value: 'published' }, { label: '归档', value: 'archived' }, { label: '全部', value: 'all' }]} />
        <div className="posts-library-list">
          {filtered.map((item) => {
            const status = statusOf(item);
            return <button key={item.id} className={'post-card' + (currentId === item.id ? ' is-current' : '')} onClick={() => pick(item.id)}>
              <div className="post-card-top"><Tag color={status.color}>{status.label}</Tag><span>{formatRelativeTime(item.updatedAt)}</span></div>
              <strong>{item.title}</strong>
              <div className="post-card-meta"><span>{item.sources.length} 条来源</span><span>{(item.content ?? '').length} 字</span></div>
            </button>;
          })}
          {!filtered.length && <p className="posts-library-empty">该状态下暂无文章</p>}
        </div>
        <Button block icon={<FilePlus2 size={14} />} onClick={() => void createBlank()}>新建草稿</Button>
      </aside>

      <section className="post-editor">
        {!draft ? <Empty description="还没有文章"><Button type="primary" onClick={() => void createBlank()}>新建第一篇草稿</Button></Empty> : <>
          <div className="post-editor-head">
            <div>
              <Tag color={statusOf(draft).color}>{statusOf(draft).label}</Tag>
              {draft.writing
                ? <Tag color="processing">正在写稿</Tag>
                : <span className="post-save-state">{dirty ? '● 有未保存的修改' : '✓ 修改已保存'}</span>}
            </div>
            <div>
              <Tooltip title="复制 Markdown 全文"><Button icon={<Copy size={14} />} aria-label="复制 Markdown" onClick={() => void exportText(true)} /></Tooltip>
              <Button icon={<Download size={14} />} onClick={() => void exportText(false)}>导出 Markdown</Button>
              <Button type="primary" icon={<Save size={14} />} loading={busy} disabled={!dirty || draft.archived} onClick={() => void save()}>保存</Button>
              <Dropdown trigger={['click']} menu={{
                items: [
                  { key: 'publish', label: draft.status === 'published' ? '撤销发布标记' : '标记为已发布', icon: <CheckCircle2 size={13} />, disabled: draft.archived },
                  { type: 'divider' as const },
                  { key: 'archive', label: draft.archived ? '恢复文章' : '归档', icon: draft.archived ? <RotateCcw size={13} /> : <Archive size={13} /> },
                  { type: 'divider' as const },
                  { key: 'delete', label: '删除', icon: <Trash2 size={13} />, danger: true }
                ],
                onClick: ({ key }) => {
                  if (key === 'publish') {
                    if (draft.status === 'published') void save({ status: 'draft' });
                    else publish();
                  } else if (key === 'archive') void save({ archived: !draft.archived });
                  else if (key === 'delete') remove();
                }
              }}>
                <Button icon={<MoreHorizontal size={15} />} aria-label="更多操作" />
              </Dropdown>
            </div>
          </div>
          <Input className="post-title" aria-label="文章标题" placeholder="文章标题" value={draft.title} maxLength={200} disabled={draft.archived || draft.writing} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          <div className="post-tags">
            <span>标签</span>
            {(draft.tags ?? []).map((tag) => <Tag key={tag} closable={!draft.archived} onClose={() => setDraft({ ...draft, tags: (draft.tags ?? []).filter((value) => value !== tag) })}>{tag}</Tag>)}
            {!draft.archived && !draft.writing && <Input className="post-tag-input" aria-label="添加标签" placeholder="添加标签后回车" value={newTag} maxLength={80} onChange={(event) => setNewTag(event.target.value)} onPressEnter={addTag} />}
          </div>
          {draft.digest && !draft.writing && <p className="post-digest"><span>分享语</span>{draft.digest}</p>}
          {draft.writeNote && !draft.writing && <p className="post-write-note">{draft.writeNote}</p>}
          <div className="post-toolbar">
            <div className="post-mode">
              <Segmented size="small" value={mode} onChange={(value) => setMode(value as 'edit' | 'preview')} options={[{ label: '编辑', value: 'edit' }, { label: '预览', value: 'preview' }]} />
              <span>{words} 字 · 支持 Markdown</span>
            </div>
            <div className="post-mode-actions">
              <Button size="small" icon={<Sparkles size={13} />} loading={draft.writing} disabled={draft.archived || busy || !draft.sources.length} onClick={rewrite}>按素材重写</Button>
              <Button size="small" icon={<Link2 size={13} />} disabled={draft.archived || draft.writing} onClick={insertSources}>插入来源引用</Button>
            </div>
          </div>
          {mode === 'edit'
            ? <Input.TextArea
                className="post-content"
                aria-label="正文内容"
                placeholder={draft.writing ? '正在按素材写稿，通常需要一到两分钟，写完自动填进来…' : '在这里写正文。也可以先「按素材重写」拿一版初稿，再按自己的判断改。'}
                value={content}
                disabled={draft.archived || draft.writing}
                autoSize={{ minRows: 20, maxRows: 44 }}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              />
            : <div className="post-preview" aria-label="正文预览"><MarkdownView text={content} empty="正文还是空的，切回编辑写点内容" /></div>}
          <div className="post-sources">
            <h3>来源引用（{draft.sources.length}）</h3>
            {draft.sources.length
              ? <ol>{draft.sources.map((source) => <li key={source.id}>
                  <span>{source.sourceName}</span>
                  {originalUrl(source.url)
                    ? <a href={originalUrl(source.url)} target="_blank" rel="noopener noreferrer">{source.title} <ExternalLink size={11} /></a>
                    : <span>{source.title} · 原文链接缺失</span>}
                </li>)}</ol>
              : <p>还没有来源。可以从收藏夹勾选素材后新建草稿，素材原文会自动带过来。</p>}
          </div>
        </>}
      </section>
    </div>
  </main>;
}
