import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Empty, Input, Progress, Radio, Segmented, Select, Skeleton, Tag } from 'antd';
import { Archive, ArrowRight, Copy, Download, ExternalLink, FileText, ListChecks, Plus, RotateCcw, Save, Sparkles } from 'lucide-react';
import { request } from '../../shared/api';
import { useApiNotice } from '../../shared/notify';
import { originalUrl } from '../../shared/links';
import type { EditorialBrief } from '../../shared/types';

type Props = { view: 'topics' | 'actions'; selectedId: string; revision: number; onSelect: (id: string) => void; onNavigate: (view: 'inbox' | 'topics' | 'actions') => void; onDirty: (dirty: boolean) => void };
type BriefTask = EditorialBrief['tasks'][number];
type ActionRow = { briefId: string; briefTitle: string; archived: boolean; task: BriefTask };

const editable = (brief: EditorialBrief) => ({ title: brief.title, reader: brief.reader, angle: brief.angle, outline: brief.outline, tasks: brief.tasks });
const markdown = (brief: EditorialBrief) => `# ${brief.title}\n\n面向读者：${brief.reader}\n\n切入角度：${brief.angle === 'guide' ? '选型指南' : '工程解读'}\n\n生成方式：${brief.provider === 'ai' ? 'AI 综合建议' : '本地模板'}；关键结论待核验。\n\n${brief.rationale}\n\n## 提纲\n\n${brief.outline.map((s, i) => `${i + 1}. ${s.title}\n   ${s.detail}\n   参考：${s.sourceIds.map(id => `[${brief.sources.findIndex(source => source.id === id) + 1}]`).join(' ') || '待补充证据'}`).join('\n\n')}\n\n## 待核验\n${brief.checks.map(c => '- ' + c).join('\n')}\n\n## 参考原文\n${brief.sources.map((s, i) => `[${i + 1}] ${s.title}\n${originalUrl(s.url) || '原文链接缺失'}`).join('\n\n')}\n\n## 行动\n${brief.tasks.map(t => `- [${t.done ? 'x' : ' '}] ${t.title}${t.date ? '（' + t.date + '）' : ''}`).join('\n')}`;

const STEPS: Array<{ key: 'inbox' | 'topics' | 'actions'; label: string; hint: string }> = [
  { key: 'inbox', label: '发现信息', hint: '勾选 2–20 条相关线索' },
  { key: 'topics', label: '提炼选题', hint: '整理角度、提纲与证据' },
  { key: 'actions', label: '执行行动', hint: '核验、勾选完成并归档' }
];

function WorkflowRail(props: { view: 'topics' | 'actions'; onNavigate: (view: 'inbox' | 'topics' | 'actions') => void }) {
  const current = props.view === 'topics' ? 1 : 2;
  return <nav className="flow-rail" aria-label="选题流程">
    {STEPS.map((step, index) => <button
      key={step.key}
      className={'flow-step' + (index === current ? ' is-current' : '') + (index < current ? ' is-done' : '')}
      onClick={() => props.onNavigate(step.key)}
    >
      <span className="flow-index">{index < current ? '✓' : index + 1}</span>
      <span><strong>{step.label}</strong><small>{step.hint}</small></span>
    </button>)}
  </nav>;
}

const statusOf = (brief: EditorialBrief) => {
  if (brief.archived) return { label: '已归档', color: 'default' };
  const done = brief.tasks.filter(t => t.done).length;
  if (brief.tasks.length && done === brief.tasks.length) return { label: '待归档', color: 'green' };
  if (done) return { label: '进行中', color: 'blue' };
  return { label: '待核验', color: 'gold' };
};
const progressOf = (brief: EditorialBrief) => Math.round(brief.tasks.filter(t => t.done).length / Math.max(1, brief.tasks.length) * 100);
const shortDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
};
const localToday = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export function EditorialWorkspace(props: Props) {
  const notice = useApiNotice();
  const [briefs, setBriefs] = useState<EditorialBrief[]>([]);
  const briefsRef = useRef<EditorialBrief[]>([]);
  const [base, setBase] = useState<EditorialBrief | null>(null);
  const [draft, setDraft] = useState<EditorialBrief | null>(null);
  const [currentId, setCurrentId] = useState(props.selectedId);
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [libraryFilter, setLibraryFilter] = useState('active');
  const [taskFilter, setTaskFilter] = useState('todo');
  const [briefFilter, setBriefFilter] = useState('all');
  const [newTask, setNewTask] = useState('');
  const [newTaskBrief, setNewTaskBrief] = useState('');
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const queue = useRef<Record<string, Promise<void>>>({});

  const dirty = props.view === 'topics' && !!draft && !!base && JSON.stringify(editable(draft)) !== JSON.stringify(editable(base));
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
      const { data } = await request<{ data: EditorialBrief[] }>('/api/briefs', { feature: '选题库' });
      applyBriefs(data);
      const chosen = data.find(b => b.id === currentIdRef.current) || data[0] || null;
      setBase(chosen); setDraft(chosen);
      if (chosen) setCurrentId(chosen.id);
    } catch (caught) {
      notice.error(caught instanceof Error ? caught.message : '「选题库」加载失败，请稍后重试');
    } finally { setLoading(false); }
  }, [applyBriefs, notice.error]);
  useEffect(() => { void load(); }, [load, props.revision]);
  useEffect(() => { setCurrentId(props.selectedId); }, [props.selectedId]);

  // 从行动清单回到工作台时，把勾选结果同步回编辑器（不覆盖未保存的编辑）
  useEffect(() => {
    if (props.view !== 'topics' || dirtyRef.current) return;
    const chosen = briefsRef.current.find(b => b.id === currentIdRef.current) || briefsRef.current[0];
    if (chosen && chosen.version !== draft?.version) { setBase(chosen); setDraft(chosen); }
  }, [props.view]);

  const pick = (id: string) => {
    if (busy) return;
    if (dirty && !window.confirm('有尚未保存的修改，切换选题会放弃这些修改，继续吗？')) return;
    setCurrentId(id);
    props.onSelect(id);
    const chosen = briefsRef.current.find(b => b.id === id) || null;
    setBase(chosen); setDraft(chosen);
  };

  const save = async (archived?: boolean) => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const changes = archived === false && draft.archived ? { archived: false } : { ...editable(draft), ...(archived === undefined ? {} : { archived }) };
      const { data } = await request<{ data: EditorialBrief }>('/api/briefs/' + draft.id, { method: 'PATCH', feature: '选题编辑', body: JSON.stringify({ version: draft.version, ...changes }) });
      setDraft(data); setBase(data);
      applyBriefs(briefsRef.current.map(b => b.id === data.id ? data : b));
      notice.success(archived === true ? '选题已归档，资料与行动进度已保留' : archived === false ? '选题已恢复' : '「选题编辑」修改已保存');
    } catch (caught) {
      notice.error(caught instanceof Error ? caught.message : '「选题编辑」保存失败，当前内容已保留');
    } finally { setBusy(false); }
  };

  const exportBrief = async (copy: boolean) => {
    if (!draft) return;
    const content = markdown(draft);
    if (copy) {
      try { await navigator.clipboard.writeText(content); notice.success('「选题导出」已复制，含参考原文与行动'); }
      catch { notice.error('「选题导出」浏览器未允许复制，请改用导出文件'); }
      return;
    }
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'SignalDock-选题.md'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice.success('「选题导出」Markdown 已下载');
  };

  /** 行动按所属选题串行提交，避免同一条选题的版本号冲突。 */
  const mutate = (briefId: string, transform: (tasks: BriefTask[]) => BriefTask[], tag: string) => {
    const current = briefsRef.current.find(b => b.id === briefId);
    if (!current || current.archived) return;
    applyBriefs(briefsRef.current.map(b => b.id === briefId ? { ...b, tasks: transform(b.tasks) } : b));
    setSavingIds(ids => [...ids, tag]);
    queue.current[briefId] = (queue.current[briefId] ?? Promise.resolve()).then(async () => {
      const latest = briefsRef.current.find(b => b.id === briefId);
      if (!latest) return;
      try {
        const { data } = await request<{ data: EditorialBrief }>('/api/briefs/' + briefId, {
          method: 'PATCH', feature: '行动清单',
          body: JSON.stringify({ version: latest.version, tasks: latest.tasks })
        });
        applyBriefs(briefsRef.current.map(b => b.id === briefId ? data : b));
      } catch (caught) {
        notice.error(caught instanceof Error ? caught.message : '「行动清单」保存失败，正在重新加载');
        void load();
      } finally { setSavingIds(ids => ids.filter(value => value !== tag)); }
    });
  };

  if (loading) return <main className="editorial-workspace editorial-loading" role="status" aria-label="加载中"><Skeleton active title={{ width: '38%' }} paragraph={{ rows: 8 }} /></main>;
  const rail = <WorkflowRail view={props.view} onNavigate={props.onNavigate} />;
  if (!briefs.length) return <main className="editorial-workspace studio">
    {rail}
    <section className="studio-empty">
      <span className="studio-empty-icon"><Sparkles size={22} /></span>
      <h1>这里收的是「可以写成一篇内容的选题」</h1>
      <p>不是信息列表，也不是待办清单：把在「发现信息」里勾选的多条线索，综合成一个带角度、提纲、证据和核验步骤的选题。</p>
      <ol>
        <li><strong>发现信息</strong><span>勾选 2–20 条讲同一件事的线索</span></li>
        <li><strong>提炼选题</strong><span>点「提炼选题」，系统生成标题、提纲与参考原文</span></li>
        <li><strong>执行行动</strong><span>按核验清单逐条完成，勾选后归档成稿</span></li>
      </ol>
      <Button type="primary" onClick={() => props.onNavigate('inbox')}>去发现信息</Button>
    </section>
  </main>;

  if (props.view === 'actions') return <ActionsView
    rail={rail}
    briefs={briefs}
    taskFilter={taskFilter}
    briefFilter={briefFilter}
    newTask={newTask}
    newTaskBrief={newTaskBrief}
    textDrafts={textDrafts}
    savingIds={savingIds}
    onTaskFilter={setTaskFilter}
    onBriefFilter={setBriefFilter}
    onNewTask={setNewTask}
    onNewTaskBrief={setNewTaskBrief}
    onTextDraft={(key, value) => setTextDrafts(current => ({ ...current, [key]: value }))}
    onTextBlur={(row) => {
      const key = row.briefId + ':' + row.task.id;
      const value = (textDrafts[key] ?? row.task.title).trim();
      if (value && value !== row.task.title) mutate(row.briefId, tasks => tasks.map(t => t.id === row.task.id ? { ...t, title: value } : t), row.task.id);
      setTextDrafts(current => { const next = { ...current }; delete next[key]; return next; });
    }}
    onToggle={(row, done) => mutate(row.briefId, tasks => tasks.map(t => t.id === row.task.id ? { ...t, done } : t), row.task.id)}
    onDate={(row, date) => mutate(row.briefId, tasks => tasks.map(t => t.id === row.task.id ? { ...t, date } : t), row.task.id)}
    onAdd={() => {
      const title = newTask.trim();
      if (!title) return;
      const target = newTaskBrief || briefs.find(b => !b.archived)?.id;
      if (!target) return;
      mutate(target, tasks => [...tasks, { id: crypto.randomUUID(), title, done: false, date: '' }], 'new-' + Date.now());
      setNewTask('');
    }}
    onOpenBrief={(id) => { setCurrentId(id); props.onSelect(id); props.onNavigate('topics'); }}
    onNavigate={props.onNavigate}
  />;

  const filtered = briefs.filter(b => libraryFilter === 'all' || (libraryFilter === 'archived' ? b.archived : !b.archived));
  const todoCount = draft ? draft.tasks.filter(t => !t.done).length : 0;
  return <main className="editorial-workspace studio">
    {rail}
    <header className="studio-heading">
      <div>
        <span className="editorial-eyebrow">选题工作台 · TOPIC STUDIO</span>
        <h1>把多条线索，整理成一个能写的选题</h1>
        <p>左侧是选题库（每条都由线索综合而来），右侧是当前选题的标题、角度、提纲和可追溯的参考原文。</p>
      </div>
      <Button onClick={() => props.onNavigate('inbox')}>去发现信息</Button>
    </header>
    <div className="studio-layout">
      <aside className="studio-library">
        <div className="studio-library-head"><div><strong>选题库</strong><span>{briefs.length} 条</span></div></div>
        <Segmented block size="small" value={libraryFilter} onChange={(value) => setLibraryFilter(String(value))} options={[{ label: '进行中', value: 'active' }, { label: '已归档', value: 'archived' }, { label: '全部', value: 'all' }]} />
        <div className="studio-library-list">
          {filtered.map(brief => {
            const status = statusOf(brief);
            return <button key={brief.id} className={'brief-card' + (currentId === brief.id ? ' is-current' : '')} onClick={() => pick(brief.id)}>
              <div className="brief-card-top"><Tag color={status.color}>{status.label}</Tag><span>{shortDate(brief.updatedAt)}</span></div>
              <strong>{brief.title}</strong>
              <div className="brief-card-meta"><span><FileText size={12} />{brief.sources.length} 条线索</span><span><ListChecks size={12} />{brief.tasks.filter(t => t.done).length}/{brief.tasks.length} 行动</span></div>
              <Progress percent={progressOf(brief)} showInfo={false} size="small" />
            </button>;
          })}
          {!filtered.length && <p className="studio-library-empty">该状态下暂无选题</p>}
        </div>
        <Button block icon={<Plus size={14} />} onClick={() => props.onNavigate('inbox')}>从线索提炼新选题</Button>
      </aside>
      <section className="studio-detail">
        {!draft ? <Empty description="选择左侧的一条选题开始编辑" /> : <>
          <div className="studio-detail-head">
            <div><span className="editorial-eyebrow">当前选题 · {statusOf(draft).label}</span><p>{draft.provider === 'ai' ? 'AI 综合建议' : '本地模板'} · {draft.sources.length} 条参考线索 · {draft.tasks.length} 条行动</p></div>
            <div className="studio-detail-actions">
              <Button icon={<Copy size={14} />} onClick={() => void exportBrief(true)}>复制</Button>
              <Button icon={<Download size={14} />} onClick={() => void exportBrief(false)}>导出</Button>
              <Button type="primary" icon={<Save size={14} />} loading={busy} disabled={!dirty || draft.archived} onClick={() => void save()}>保存修改</Button>
            </div>
          </div>
          <div className={'studio-save-state' + (dirty ? ' is-dirty' : '')} aria-live="polite">{dirty ? '● 有未保存的修改' : '✓ 修改已保存'}</div>
          <div className="studio-grid">
            <div className="studio-editor">
              <fieldset disabled={busy || draft.archived}>
                <label className="editorial-field">选题标题<Input.TextArea aria-label="选题标题" value={draft.title} maxLength={200} autoSize={{ minRows: 2, maxRows: 4 }} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
                <label className="editorial-field">写给谁看<Input value={draft.reader} maxLength={300} onChange={e => setDraft({ ...draft, reader: e.target.value })} /></label>
                <h2>切入角度</h2>
                <Radio.Group value={draft.angle} onChange={e => setDraft({ ...draft, angle: e.target.value })}><Radio.Button value="guide">选型指南</Radio.Button><Radio.Button value="engineering">工程解读</Radio.Button></Radio.Group>
                <p className="editorial-hint">{draft.angle === 'guide' ? '围绕适用场景、比较维度和决策步骤完善提纲。' : '围绕工具链、运行条件和可复现验证完善提纲。'} 切换角度不会丢失已编辑内容。</p>
                <h2>内容提纲</h2>
                {draft.outline.map((section, index) => <div className="editorial-outline" key={index}><span>{String(index + 1).padStart(2, '0')}</span><div><Input aria-label={'提纲标题 ' + (index + 1)} value={section.title} maxLength={200} onChange={e => setDraft({ ...draft, outline: draft.outline.map((s, i) => i === index ? { ...s, title: e.target.value } : s) })} /><Input.TextArea aria-label={'提纲说明 ' + (index + 1)} value={section.detail} maxLength={1200} autoSize={{ minRows: 2, maxRows: 6 }} onChange={e => setDraft({ ...draft, outline: draft.outline.map((s, i) => i === index ? { ...s, detail: e.target.value } : s) })} /><small>{section.sourceIds.length ? '参考线索 ' + section.sourceIds.map(id => '[' + (draft.sources.findIndex(s => s.id === id) + 1) + ']').join(' ') : '待补充证据'}</small></div></div>)}
              </fieldset>
              <div className="studio-next">
                <div><strong>下一步：把行动做完</strong><p>{todoCount ? `还有 ${todoCount} 条核验 / 补证据行动，完成后即可归档成稿。` : '行动已全部完成，可以归档这条选题。'}</p></div>
                <Button type="primary" icon={<ArrowRight size={14} />} onClick={() => props.onNavigate('actions')}>打开行动清单</Button>
              </div>
            </div>
            <aside className="editorial-evidence">
              <h2>为什么做这个选题</h2><p>{draft.rationale}</p>
              <h2>参考原文（{draft.sources.length}）</h2>
              {draft.sources.map((source, i) => <article key={source.id}><small>[{i + 1}] {source.sourceName} · 采集片段</small><h3>{source.title}</h3>{originalUrl(source.url) ? <a href={originalUrl(source.url)} target="_blank" rel="noopener noreferrer">查看原文 <ExternalLink size={12} /></a> : <span>原文链接缺失</span>}</article>)}
              <h2>还需核验（{draft.checks.length}）</h2><ul>{draft.checks.map((check, i) => <li key={i}>{check}</li>)}</ul>
            </aside>
          </div>
          <div className="studio-archive">
            <span>{draft.archived ? '资料与行动已保留，恢复后可继续编辑。' : '归档前需完成全部行动；归档后内容只读、可随时恢复。'}</span>
            <Button icon={draft.archived ? <RotateCcw size={14} /> : <Archive size={14} />} loading={busy} disabled={!draft.archived && todoCount > 0} onClick={() => void save(!draft.archived)}>{draft.archived ? '恢复选题' : '完成并归档'}</Button>
          </div>
        </>}
      </section>
    </div>
  </main>;
}

type ActionsProps = {
  rail: React.ReactNode;
  briefs: EditorialBrief[];
  taskFilter: string;
  briefFilter: string;
  newTask: string;
  newTaskBrief: string;
  textDrafts: Record<string, string>;
  savingIds: string[];
  onTaskFilter: (value: string) => void;
  onBriefFilter: (value: string) => void;
  onNewTask: (value: string) => void;
  onNewTaskBrief: (value: string) => void;
  onTextDraft: (key: string, value: string) => void;
  onTextBlur: (row: ActionRow) => void;
  onToggle: (row: ActionRow, done: boolean) => void;
  onDate: (row: ActionRow, date: string) => void;
  onAdd: () => void;
  onOpenBrief: (id: string) => void;
  onNavigate: (view: 'inbox' | 'topics' | 'actions') => void;
};

function ActionsView(props: ActionsProps) {
  const today = localToday();
  const rows: ActionRow[] = useMemo(() => props.briefs.flatMap(brief => brief.tasks.map(task => ({ briefId: brief.id, briefTitle: brief.title, archived: brief.archived, task }))), [props.briefs]);
  const todo = rows.filter(row => !row.task.done).length;
  const done = rows.length - todo;
  const activeBriefs = props.briefs.filter(brief => !brief.archived);
  const visible = rows.filter(row => (props.taskFilter === 'all' || (props.taskFilter === 'done' ? row.task.done : !row.task.done)) && (props.briefFilter === 'all' || row.briefId === props.briefFilter));
  const groups: Array<{ label: string; hint: string; rows: ActionRow[] }> = [
    { label: '已逾期', hint: '计划日期已过，优先处理', rows: [] },
    { label: '今天', hint: '今天计划完成', rows: [] },
    { label: '之后', hint: '已排期的后续行动', rows: [] },
    { label: '未排期', hint: '还没安排日期', rows: [] },
    { label: '已完成', hint: '核验 / 补证据已完成', rows: [] }
  ];
  for (const row of visible) {
    if (row.task.done) groups[4].rows.push(row);
    else if (!row.task.date) groups[3].rows.push(row);
    else if (row.task.date < today) groups[0].rows.push(row);
    else if (row.task.date === today) groups[1].rows.push(row);
    else groups[2].rows.push(row);
  }
  return <main className="editorial-workspace studio">
    {props.rail}
    <header className="studio-heading">
      <div>
        <span className="editorial-eyebrow">行动清单 · NEXT ACTIONS</span>
        <h1>所有选题的「下一步」，都在这里做完</h1>
        <p>系统综合线索时会列出待核验项与行动；这里汇总全部选题的行动，勾选、排日期后自动保存。完成后回选题工作台归档成稿。</p>
      </div>
      <Button onClick={() => props.onNavigate('topics')}>回选题工作台</Button>
    </header>
    <div className="action-stats">
      <div><span>待完成</span><strong>{todo}</strong><small>条行动</small></div>
      <div><span>已完成</span><strong>{done}</strong><small>条行动</small></div>
      <div><span>涉及选题</span><strong>{activeBriefs.length}</strong><small>条进行中选题</small></div>
    </div>
    <div className="action-toolbar">
      <Segmented value={props.taskFilter} onChange={(value) => props.onTaskFilter(String(value))} options={[{ label: '待完成', value: 'todo' }, { label: '已完成', value: 'done' }, { label: '全部', value: 'all' }]} />
      <Select aria-label="按选题筛选行动" value={props.briefFilter} onChange={props.onBriefFilter} style={{ width: 240 }} options={[{ value: 'all', label: '全部选题' }, ...props.briefs.map(brief => ({ value: brief.id, label: (brief.archived ? '已归档 · ' : '') + brief.title }))]} />
    </div>
    <div className="action-add">
      <Input aria-label="添加一条行动" placeholder="添加一条行动，例如：核对官方发布说明" value={props.newTask} maxLength={300} onChange={e => props.onNewTask(e.target.value)} onPressEnter={props.onAdd} />
      <Select aria-label="行动所属选题" value={props.newTaskBrief || activeBriefs[0]?.id} onChange={props.onNewTaskBrief} style={{ width: 230 }} options={activeBriefs.map(brief => ({ value: brief.id, label: brief.title }))} />
      <Button type="primary" icon={<Plus size={14} />} disabled={!props.newTask.trim() || !activeBriefs.length} onClick={props.onAdd}>添加行动</Button>
    </div>
    {!visible.length && <Empty description="当前筛选下没有行动" />}
    {groups.filter(group => group.rows.length).map(group => <section className="action-group" key={group.label}>
      <div className="action-group-head"><h2>{group.label}<span>{group.rows.length}</span></h2><small>{group.hint}</small></div>
      {group.rows.map(row => {
        const key = row.briefId + ':' + row.task.id;
        const disabled = row.archived;
        return <article className={'action-row' + (row.task.done ? ' is-done' : '')} key={key}>
          <Checkbox aria-label={'完成：' + row.task.title} checked={row.task.done} disabled={disabled} onChange={e => props.onToggle(row, e.target.checked)} />
          <div className="action-row-main">
            <Input.TextArea aria-label="行动内容" value={props.textDrafts[key] ?? row.task.title} maxLength={300} autoSize={{ minRows: 1, maxRows: 3 }} disabled={disabled} onChange={e => props.onTextDraft(key, e.target.value)} onBlur={() => props.onTextBlur(row)} />
            <div className="action-row-meta">
              <button className="action-brief-link" onClick={() => props.onOpenBrief(row.briefId)}><FileText size={12} />{row.briefTitle}</button>
              <label>计划日期 <input type="date" aria-label={'计划日期：' + row.task.title} value={row.task.date} disabled={disabled} onChange={e => props.onDate(row, e.target.value)} /></label>
              {props.savingIds.includes(row.task.id) && <span className="action-saving">保存中…</span>}
              {row.archived && <span className="action-saving">已归档 · 只读</span>}
            </div>
          </div>
          <Tag color={row.task.done ? 'green' : 'default'}>{row.task.done ? '已完成' : '待完成'}</Tag>
        </article>;
      })}
    </section>)}
  </main>;
}
