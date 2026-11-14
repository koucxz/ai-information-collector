import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntApp, Button, Checkbox, Empty, Input, Segmented, Skeleton, Tag } from 'antd';
import { CheckCircle2, Copy, Download, ExternalLink, FilePlus2, Link2, Plus, Save } from 'lucide-react';
import { request } from '../../shared/api';
import { useApiNotice } from '../../shared/notify';
import { originalUrl } from '../../shared/links';
import { formatRelativeTime } from '../../shared/format';
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
  return `# ${brief.title}\n\n${tags}${(brief.content ?? '').trim()}${sources}\n`;
};

/**
 * 文章：对标 Ghost / Halo / Gutenberg 的「文章列表 + 编辑器 + 发布侧栏」。
 * 发布前检查是提示式清单（advisory），只提醒不阻断；没有评分、窗口、待办排期等自造概念。
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
  const [newCheck, setNewCheck] = useState('');
  const [localRevision, setLocalRevision] = useState(0);

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
        : extra?.archived === true ? '文章已归档，可随时恢复'
          : extra?.archived === false ? '文章已恢复' : '「文章编辑」修改已保存');
    } catch (caught) {
      notice.error(caught instanceof Error ? caught.message : '「文章编辑」保存失败，当前内容已保留');
    } finally { setBusy(false); }
  };

  const createBlank = async () => {
    const doCreate = async () => {
      setBusy(true);
      try {
        const { data } = await request<{ data: EditorialBrief }>('/api/briefs', { method: 'POST', feature: '新建草稿', body: JSON.stringify({ itemIds: [] }) });
        applyBriefs([data, ...briefsRef.current]);
        setBase(data); setDraft(data); setCurrentId(data.id); props.onSelect(data.id); setFilter('active');
        notice.success('已新建草稿，写好后记得保存');
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
    const pending = current.tasks.filter((task) => !task.done).length;
    if (pending) {
      modal.confirm({
        title: '还有检查项未完成',
        content: `发布前检查是提醒用的，还有 ${pending} 项没勾；仍要标记为已发布吗？`,
        okText: '仍然标记发布', cancelText: '返回继续检查',
        onOk: () => void save({ status: 'published' })
      });
    } else void save({ status: 'published' });
  };

  const insertSources = () => {
    const current = draftRef.current;
    if (!current) return;
    if (!current.sources.length) { notice.error('这篇草稿还没有来源引用，可以先从收藏夹选素材新建'); return; }
    const block = `\n\n## 来源\n\n${current.sources.map((source, index) => `${index + 1}. [${source.title}](${originalUrl(source.url)}) · ${source.sourceName}`).join('\n')}\n`;
    setDraft({ ...current, content: (current.content ?? '').trimEnd() + block });
    notice.success('已在正文末尾插入来源引用');
  };

  const addTag = () => {
    const value = newTag.trim();
    if (!value || !draft) return;
    if ((draft.tags ?? []).includes(value) || (draft.tags ?? []).length >= 10) { setNewTag(''); return; }
    setDraft({ ...draft, tags: [...(draft.tags ?? []), value] });
    setNewTag('');
  };

  const addCheck = () => {
    const value = newCheck.trim();
    if (!value || !draft) return;
    setDraft({ ...draft, tasks: [...draft.tasks, { id: crypto.randomUUID(), title: value, done: false, date: '' }] });
    setNewCheck('');
  };

  const filtered = briefs.filter((item) => filter === 'all' || (filter === 'archived' ? item.archived : filter === 'published' ? !item.archived && item.status === 'published' : !item.archived && item.status !== 'published'));
  const content = draft?.content ?? '';
  const autoChecks = useMemo(() => [
    { label: '标题已填写', ok: !!draft?.title.trim() },
    { label: '正文不少于 100 字', ok: content.trim().length >= 100 },
    { label: '至少 1 条来源引用', ok: (draft?.sources.length ?? 0) > 0 },
    { label: '正文没有待补充 / TODO 占位内容', ok: !/待补充|TODO|占位内容/i.test(content) }
  ], [draft?.title, content, draft?.sources.length]);

  if (loading) return <main className="workspace-view posts-view posts-loading" role="status" aria-label="加载中"><Skeleton active title={{ width: '38%' }} paragraph={{ rows: 10 }} /></main>;

  return <main className="workspace-view posts-view">
    <header className="view-heading">
      <div>
        <p>共 {briefs.length} 篇文章 · 草稿与已发布</p>
        <h1>文章</h1>
        <span>左边选文章，中间写正文，右边是发布设置和检查清单。检查项只是提醒，没勾完也可以发布。</span>
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
        <Button block icon={<Plus size={14} />} onClick={() => void createBlank()}>+ 新建草稿</Button>
      </aside>

      <section className="post-editor">
        {!draft ? <Empty description="还没有文章"><Button type="primary" onClick={() => void createBlank()}>新建第一篇草稿</Button></Empty> : <>
          <div className="post-editor-head">
            <div>
              <Tag color={statusOf(draft).color}>{statusOf(draft).label}</Tag>
              <span className="post-save-state">{dirty ? '● 有未保存的修改' : '✓ 修改已保存'}</span>
            </div>
            <div>
              <Button icon={<Copy size={14} />} onClick={() => void exportText(true)}>复制</Button>
              <Button icon={<Download size={14} />} onClick={() => void exportText(false)}>导出 Markdown</Button>
              <Button type="primary" icon={<Save size={14} />} loading={busy} disabled={!dirty || draft.archived} onClick={() => void save()}>保存草稿</Button>
            </div>
          </div>
          <Input className="post-title" aria-label="文章标题" placeholder="文章标题" value={draft.title} maxLength={200} disabled={draft.archived} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          <div className="post-tags">
            <span>标签</span>
            {(draft.tags ?? []).map((tag) => <Tag key={tag} closable={!draft.archived} onClose={() => setDraft({ ...draft, tags: (draft.tags ?? []).filter((value) => value !== tag) })}>{tag}</Tag>)}
            {!draft.archived && <Input className="post-tag-input" aria-label="添加标签" placeholder="添加标签后回车" value={newTag} maxLength={80} onChange={(event) => setNewTag(event.target.value)} onPressEnter={addTag} />}
          </div>
          <div className="post-toolbar">
            <span>{content.length} 字 · 支持 Markdown</span>
            <Button size="small" icon={<Link2 size={13} />} disabled={draft.archived} onClick={insertSources}>插入来源引用</Button>
          </div>
          <Input.TextArea
            className="post-content"
            aria-label="正文内容"
            placeholder="在这里写正文。需要引用时，点右上角「插入来源引用」把素材原文链接附到文末。"
            value={content}
            disabled={draft.archived}
            autoSize={{ minRows: 20, maxRows: 44 }}
            onChange={(event) => setDraft({ ...draft, content: event.target.value })}
          />
          <div className="post-sources">
            <h3>来源引用（{draft.sources.length}）</h3>
            {draft.sources.length
              ? <ol>{draft.sources.map((source) => <li key={source.id}>
                  <span>{source.sourceName}</span>
                  {originalUrl(source.url)
                    ? <a href={originalUrl(source.url)} target="_blank" rel="noopener noreferrer">{source.title} <ExternalLink size={11} /></a>
                    : <span>{source.title} · 原文链接缺失</span>}
                </li>)}</ol>
              : <p>还没有来源。可以从收藏夹勾选素材后新建草稿，已有素材会自动带过来。</p>}
          </div>
        </>}
      </section>

      <aside className="publish-panel" aria-label="发布设置与检查清单">
        <h2>发布</h2>
        <p className="publish-status">{draft ? (draft.archived ? '已归档 · 只读' : draft.status === 'published' ? `已标记发布 · ${draft.publishedAt ? new Date(draft.publishedAt).toLocaleDateString('zh-CN') : ''}` : '草稿 · 尚未发布') : '请选择一篇文章'}</p>
        <div className="publish-checks">
          <h3>发布前检查</h3>
          <small>提示项，勾完更稳妥；不勾也可以发布</small>
          <ul className="check-auto">
            {autoChecks.map((check) => <li key={check.label} className={check.ok ? 'is-ok' : ''}>{check.ok ? '✓' : '○'} {check.label}</li>)}
          </ul>
          <ul className="check-manual">
            {draft?.tasks.map((task) => <li key={task.id} className={task.done ? 'is-done' : ''}>
              <Checkbox
                aria-label={'完成：' + task.title}
                checked={task.done}
                disabled={!draft || draft.archived}
                onChange={(event) => setDraft({ ...draft, tasks: draft.tasks.map((item) => item.id === task.id ? { ...item, done: event.target.checked } : item) })}
              >{task.title}</Checkbox>
            </li>)}
          </ul>
          {draft && !draft.archived && <Input className="check-add" aria-label="添加检查项" placeholder="添加检查项后回车" value={newCheck} maxLength={300} onChange={(event) => setNewCheck(event.target.value)} onPressEnter={addCheck} />}
        </div>
        <div className="publish-actions">
          <Button block icon={<Save size={14} />} loading={busy} disabled={!draft || draft.archived} onClick={() => void save()}>保存草稿</Button>
          <Button block icon={<Download size={14} />} disabled={!draft} onClick={() => void exportText(false)}>导出 Markdown</Button>
          {draft?.status === 'published' && !draft.archived
            ? <Button block icon={<CheckCircle2 size={14} />} disabled>已发布</Button>
            : <Button block type="primary" icon={<CheckCircle2 size={14} />} loading={busy} disabled={!draft || draft.archived} onClick={publish}>标记为已发布</Button>}
          <Button block disabled={!draft || busy} onClick={() => void save({ archived: !draft?.archived })}>{draft?.archived ? '恢复文章' : '归档（不再处理）'}</Button>
        </div>
        <p className="publish-note">标记发布只记录状态，不会自动发到任何平台；导出 Markdown 后可自行发布。</p>
      </aside>
    </div>
  </main>;
}
