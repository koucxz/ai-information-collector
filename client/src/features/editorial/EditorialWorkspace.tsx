import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Empty, Input, Progress, Radio, Segmented, Select, Skeleton, Tag } from 'antd';
import { Archive, ArrowRight, CheckCircle2, Copy, Download, ExternalLink, FileText, ListChecks, PenLine, Plus, RotateCcw, Save, Sparkles } from 'lucide-react';
import { request } from '../../shared/api';
import { useApiNotice } from '../../shared/notify';
import { originalUrl } from '../../shared/links';
import type { BriefStatus, CandidateResponse, EditorialBrief, TopicCandidate } from '../../shared/types';

type Props = { view: 'topics' | 'actions'; selectedId: string; revision: number; onSelect: (id: string) => void; onNavigate: (view: 'inbox' | 'topics' | 'actions') => void; onDirty: (dirty: boolean) => void };
type BriefTask = EditorialBrief['tasks'][number];
type ActionRow = { briefId: string; briefTitle: string; archived: boolean; task: BriefTask };

const editable = (brief: EditorialBrief) => ({
  title: brief.title, reader: brief.reader, angle: brief.angle, outline: brief.outline, tasks: brief.tasks,
  content: brief.content ?? '', status: brief.status ?? 'idea'
});
/** 兼容改造前生成、理由里带着「本地模板」旧文案的选题。 */
const rationaleText = (brief: EditorialBrief) => brief.rationale.includes('当前为本地模板')
  ? `综合 ${brief.sources.length} 条采集线索，先比较变化与适用条件，再整理可执行的研究问题；关键结论仍需回原文核验。`
  : brief.rationale;
const planMarkdown = (brief: EditorialBrief) => `# ${brief.title}\n\n面向读者：${brief.reader}\n\n切入角度：${brief.angle === 'guide' ? '选型指南' : '工程解读'}\n\n生成方式：${brief.provider === 'ai' ? 'AI 综合建议' : '本地模板'}；关键结论待核验。\n\n${rationaleText(brief)}\n\n## 提纲\n\n${brief.outline.map((s, i) => `${i + 1}. ${s.title}\n   ${s.detail}\n   参考：${s.sourceIds.map(id => `[${brief.sources.findIndex(source => source.id === id) + 1}]`).join(' ') || '待补充证据'}`).join('\n\n')}\n\n## 待核验\n${brief.checks.map(c => '- ' + c).join('\n')}\n\n## 参考原文\n${brief.sources.map((s, i) => `[${i + 1}] ${s.title}\n${originalUrl(s.url) || '原文链接缺失'}`).join('\n\n')}\n\n## 行动\n${brief.tasks.map(t => `- [${t.done ? 'x' : ' '}] ${t.title}${t.date ? '（' + t.date + '）' : ''}`).join('\n')}`;

/** 起稿工坊的初稿：只拼装已有材料，事实与结论一律标注待核验，不编造内容。 */
const draftContent = (brief: EditorialBrief) => {
  const lines = [
    `# ${brief.title}`, '',
    `> 面向读者：${brief.reader}　|　切入角度：${brief.angle === 'guide' ? '选型指南' : '工程解读'}`,
    '> 本文是按提纲拼装的待核验草稿，事实、数据与结论需回参考原文确认后再发布。', '',
    '## 为什么要写', '', rationaleText(brief), '',
    '## 正文', ''
  ];
  brief.outline.forEach((section, index) => {
    lines.push(`### ${index + 1}. ${section.title}`, '', section.detail || '（待补充：回看参考原文后补上论据与例子。）', '');
    const refs = section.sourceIds.map(id => brief.sources.findIndex(source => source.id === id) + 1).filter(index => index > 0);
    if (refs.length) lines.push(`参考线索：${refs.map(index => `[${index}]`).join(' ')}`, '');
  });
  lines.push('## 发布前需要核验', '', ...brief.checks.map(check => `- [ ] ${check}`), '', '## 参考原文', '');
  brief.sources.forEach((source, index) => lines.push(`[${index + 1}] ${source.title} · ${source.sourceName}`, originalUrl(source.url) || '原文链接缺失', ''));
  return lines.join('\n');
};

const STEPS: Array<{ label: string; hint: string }> = [
  { label: '看情报', hint: '采集到的信息都在这里' },
  { label: '挑选题', hint: '看带理由的推荐，决定写什么' },
  { label: '起稿', hint: '按提纲写正文、导出成稿' },
  { label: '发布前检查', hint: '核验完再标记已发布' }
];

function WorkflowRail(props: { step: number; onStep: (index: number) => void }) {
  return <nav className="flow-rail" aria-label="内容流程">
    {STEPS.map((step, index) => <button
      key={step.label}
      className={'flow-step' + (index === props.step ? ' is-current' : '') + (index < props.step ? ' is-done' : '')}
      onClick={() => props.onStep(index)}
    >
      <span className="flow-index">{index < props.step ? '✓' : index + 1}</span>
      <span><strong>{step.label}</strong><small>{step.hint}</small></span>
    </button>)}
  </nav>;
}

const statusOf = (brief: EditorialBrief) => {
  if (brief.archived) return { label: '已归档', color: 'default' };
  if (brief.status === 'published') return { label: '已发布', color: 'green' };
  if (brief.status === 'draft') return { label: '撰写中', color: 'blue' };
  if (brief.status === 'review') return { label: '待核验', color: 'gold' };
  const done = brief.tasks.filter(task => task.done).length;
  if (brief.tasks.length && done === brief.tasks.length) return { label: '待发布', color: 'green' };
  if (done) return { label: '撰写中', color: 'blue' };
  return { label: '待写', color: 'gold' };
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

function CandidateCard(props: { candidate: TopicCandidate; starting: boolean; onStart: (candidate: TopicCandidate) => void }) {
  const c = props.candidate;
  return <article className="candidate-card">
    <div className="candidate-head">
      <span className="candidate-score">{c.score}<small>分</small></span>
      <div><strong>{c.title}</strong><span className="candidate-window">{c.window}</span></div>
    </div>
    <p className="candidate-why">{c.why}</p>
    <div className="candidate-dims">
      {c.dimensions.map(d => <div key={d.key} title={`${d.label}：${d.note}`}>
        <span>{d.label}</span><i><b style={{ width: `${d.value}%` }} /></i><em>{d.note}</em>
      </div>)}
    </div>
    <ul className="candidate-titles">{c.sampleTitles.slice(0, 2).map(title => <li key={title}>{title}</li>)}</ul>
    <div className="candidate-foot">
      <span><Tag color={c.angle === 'guide' ? 'blue' : 'purple'}>{c.angle === 'guide' ? '选型指南' : '工程解读'}</Tag>{c.clues} 条线索 · {c.sources} 个来源 · 取最近 {c.itemIds.length} 条开写</span>
      <Button type="primary" size="small" loading={props.starting} disabled={c.used} onClick={() => props.onStart(c)}>
        {c.used ? '已开写' : '按这个选题开写'}
      </Button>
    </div>
  </article>;
}

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
  const [starting, setStarting] = useState('');
  const [localRevision, setLocalRevision] = useState(0);
  const [editorTab, setEditorTab] = useState<'plan' | 'content'>('plan');
  const [libraryFilter, setLibraryFilter] = useState('active');
  const [taskFilter, setTaskFilter] = useState('all');
  const [briefFilter, setBriefFilter] = useState('all');
  const [newTask, setNewTask] = useState('');
  const [newTaskBrief, setNewTaskBrief] = useState('');
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<TopicCandidate[]>([]);
  const [candidateNote, setCandidateNote] = useState('');
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
    const [listResult, candidateResult] = await Promise.allSettled([
      request<{ data: EditorialBrief[] }>('/api/briefs', { feature: '选题库' }),
      request<CandidateResponse>('/api/briefs/candidates', { feature: '选题推荐' })
    ]);
    if (listResult.status === 'fulfilled') {
      applyBriefs(listResult.value.data);
      const chosen = listResult.value.data.find(b => b.id === currentIdRef.current) || listResult.value.data[0] || null;
      setBase(chosen); setDraft(chosen);
      if (chosen) setCurrentId(chosen.id);
    } else {
      notice.error(listResult.reason instanceof Error ? listResult.reason.message : '「选题库」加载失败，请稍后重试');
    }
    if (candidateResult.status === 'fulfilled') {
      setCandidates(candidateResult.value.data);
      setCandidateNote(candidateResult.value.note);
    } else {
      notice.error(candidateResult.reason instanceof Error ? candidateResult.reason.message : '「选题推荐」加载失败，可稍后刷新');
    }
    setLoading(false);
  }, [applyBriefs, notice.error]);
  useEffect(() => { void load(); }, [load, props.revision, localRevision]);
  useEffect(() => { setCurrentId(props.selectedId); }, [props.selectedId]);

  useEffect(() => {
    if (props.view !== 'topics' || dirtyRef.current) return;
    const chosen = briefsRef.current.find(b => b.id === currentIdRef.current) || briefsRef.current[0];
    if (chosen && chosen.version !== draft?.version) { setBase(chosen); setDraft(chosen); }
  }, [props.view]);

  const goStep = (index: number) => {
    if (index === 0) props.onNavigate('inbox');
    else if (index === 1) { props.onNavigate('topics'); setEditorTab('plan'); }
    else if (index === 2) { props.onNavigate('topics'); setEditorTab('content'); }
    else props.onNavigate('actions');
  };
  const currentStep = props.view === 'actions' ? 3 : editorTab === 'content' ? 2 : 1;
  const rail = <WorkflowRail step={currentStep} onStep={goStep} />;

  const pick = (id: string) => {
    if (busy) return;
    if (dirty && !window.confirm('有尚未保存的修改，切换选题会放弃这些修改，继续吗？')) return;
    setCurrentId(id);
    props.onSelect(id);
    const chosen = briefsRef.current.find(b => b.id === id) || null;
    setBase(chosen); setDraft(chosen);
  };

  const save = async (extra?: { archived?: boolean; status?: BriefStatus }) => {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const changes = { ...editable(draft), ...(extra ?? {}) };
      const { data } = await request<{ data: EditorialBrief }>('/api/briefs/' + draft.id, { method: 'PATCH', feature: '选题编辑', body: JSON.stringify({ version: draft.version, ...changes }) });
      setDraft(data); setBase(data);
      applyBriefs(briefsRef.current.map(b => b.id === data.id ? data : b));
      notice.success(extra?.status === 'published' ? '已标记为发布，正文与参考原文已保留'
        : extra?.archived === true ? '选题已归档，资料与检查进度已保留'
          : extra?.archived === false ? '选题已恢复' : '「选题编辑」修改已保存');
    } catch (caught) {
      notice.error(caught instanceof Error ? caught.message : '「选题编辑」保存失败，当前内容已保留');
    } finally { setBusy(false); }
  };

  const exportText = async (copy: boolean, text: string, filename: string, label: string) => {
    if (copy) {
      try { await navigator.clipboard.writeText(text); notice.success(`「${label}」已复制到剪贴板`); }
      catch { notice.error(`「${label}」浏览器未允许复制，请改用导出文件`); }
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice.success(`「${label}」Markdown 已下载`);
  };

  const startFromCandidate = async (candidate: TopicCandidate) => {
    if (busy || starting) return;
    setStarting(candidate.id);
    try {
      const result = await request<{ data: EditorialBrief[]; reused: boolean }>('/api/briefs/generate', {
        method: 'POST', feature: '提炼选题', body: JSON.stringify({ itemIds: candidate.itemIds })
      });
      const id = result.data[0]?.id;
      if (id) { setCurrentId(id); props.onSelect(id); setEditorTab('plan'); }
      setLocalRevision(value => value + 1);
      notice.success(result.reused ? '这条选题已经开写过，已为你打开' : '已生成选题方案，可接着起稿');
    } catch (caught) {
      notice.error(caught instanceof Error ? caught.message : '「提炼选题」失败，请稍后重试');
    } finally { setStarting(''); }
  };

  const generateDraft = () => {
    if (!draft) return;
    if (draft.content?.trim() && !window.confirm('正文已有内容，生成初稿会覆盖当前正文，继续吗？')) return;
    setDraft({ ...draft, content: draftContent(draft), status: 'draft' });
    notice.success('已按提纲拼装待核验草稿，请补论据并回原文核验');
  };

  /** 检查表按所属选题串行提交，避免同一条选题的版本号冲突。 */
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
          method: 'PATCH', feature: '发布前检查',
          body: JSON.stringify({ version: latest.version, tasks: latest.tasks })
        });
        applyBriefs(briefsRef.current.map(b => b.id === briefId ? data : b));
      } catch (caught) {
        notice.error(caught instanceof Error ? caught.message : '「发布前检查」保存失败，正在重新加载');
        void load();
      } finally { setSavingIds(ids => ids.filter(value => value !== tag)); }
    });
  };

  if (loading) return <main className="editorial-workspace editorial-loading" role="status" aria-label="加载中"><Skeleton active title={{ width: '38%' }} paragraph={{ rows: 8 }} /></main>;

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
  const content = draft?.content ?? '';
  const published = draft?.status === 'published';
  return <main className="editorial-workspace studio">
    {rail}
    <header className="studio-heading">
      <div>
        <span className="editorial-eyebrow">挑选题 · TOPIC PICKER</span>
        <h1>先知道写什么，再谈怎么写</h1>
        <p>下面是从近 30 天采集记录算出的候选选题，每条都带评分、理由和原始线索。点「按这个选题开写」，生成方案后在「起稿」里写正文。</p>
      </div>
      <Button onClick={() => props.onNavigate('inbox')}>去看情报</Button>
    </header>

    <section className="candidate-section" aria-label="今日选题推荐">
      <div className="candidate-section-head">
        <div><strong>今天写什么</strong><span>带理由的选题推荐 · 共 {candidates.length} 条</span></div>
        <small>{candidateNote || '评分来自采集记录，不使用大模型'}</small>
      </div>
      {candidates.length
        ? <div className="candidate-grid">{candidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate} starting={starting === candidate.id} onStart={candidate => void startFromCandidate(candidate)} />)}</div>
        : <Empty description="近 30 天还没有足够线索（至少 2 条同主题信息才会生成推荐）"><Button onClick={() => props.onNavigate('inbox')}>去看情报</Button></Empty>}
    </section>

    {!briefs.length && <div className="studio-onboard">
      <Sparkles size={18} />
      <div><strong>还没有开写的选题</strong><span>点上面任意一条「按这个选题开写」，系统会把这些线索整理成标题、提纲、参考原文与核验清单；正文写完、检查项勾完，就能标记已发布。</span></div>
    </div>}

    <div className="studio-layout">
      <aside className="studio-library">
        <div className="studio-library-head"><div><strong>我的选题</strong><span>{briefs.length} 条</span></div></div>
        <Segmented block size="small" value={libraryFilter} onChange={(value) => setLibraryFilter(String(value))} options={[{ label: '进行中', value: 'active' }, { label: '已归档', value: 'archived' }, { label: '全部', value: 'all' }]} />
        <div className="studio-library-list">
          {filtered.map(brief => {
            const status = statusOf(brief);
            return <button key={brief.id} className={'brief-card' + (currentId === brief.id ? ' is-current' : '')} onClick={() => pick(brief.id)}>
              <div className="brief-card-top"><Tag color={status.color}>{status.label}</Tag><span>{shortDate(brief.updatedAt)}</span></div>
              <strong>{brief.title}</strong>
              <div className="brief-card-meta">
                {brief.signal && <span className="brief-score">{brief.signal.score} 分</span>}
                <span><FileText size={12} />{brief.sources.length} 条线索</span>
                <span><ListChecks size={12} />{brief.tasks.filter(t => t.done).length}/{brief.tasks.length} 核验</span>
              </div>
              <Progress percent={progressOf(brief)} showInfo={false} size="small" />
            </button>;
          })}
          {!filtered.length && <p className="studio-library-empty">该状态下暂无选题</p>}
        </div>
        <Button block icon={<Plus size={14} />} onClick={() => props.onNavigate('inbox')}>从情报里手动勾线索</Button>
      </aside>
      <section className="studio-detail">
        {!draft ? <Empty description="选一条推荐开写，或在左侧选择已有选题" /> : <>
          <div className="studio-detail-head">
            <div><span className="editorial-eyebrow">当前选题 · {statusOf(draft).label}</span><p>{draft.provider === 'ai' ? 'AI 综合建议' : '本地模板'} · {draft.sources.length} 条参考线索 · {draft.tasks.length} 项发布前检查{draft.signal ? ` · 推荐评分 ${draft.signal.score}` : ''}</p></div>
            <div className="studio-detail-actions">
              <Segmented value={editorTab} onChange={(value) => setEditorTab(String(value) as 'plan' | 'content')} options={[{ label: '选题方案', value: 'plan' }, { label: '起稿', value: 'content' }]} />
              <Button icon={<Copy size={14} />} onClick={() => void exportText(true, editorTab === 'content' && content.trim() ? content : planMarkdown(draft), '', editorTab === 'content' ? '正文导出' : '选题导出')}>复制</Button>
              <Button icon={<Download size={14} />} onClick={() => void exportText(false, editorTab === 'content' && content.trim() ? content : planMarkdown(draft), editorTab === 'content' ? 'SignalDock-成稿.md' : 'SignalDock-选题.md', editorTab === 'content' ? '正文导出' : '选题导出')}>导出</Button>
              <Button type="primary" icon={<Save size={14} />} loading={busy} disabled={!dirty || draft.archived} onClick={() => void save()}>保存</Button>
            </div>
          </div>
          <div className={'studio-save-state' + (dirty ? ' is-dirty' : '')} aria-live="polite">{dirty ? '● 有未保存的修改' : '✓ 修改已保存'}</div>

          {editorTab === 'plan' ? <div className="studio-grid">
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
                <div><strong>下一步：按提纲起稿</strong><p>系统会用这里的标题、提纲和参考原文拼出一份待核验草稿，正文由你补论据、下结论。</p></div>
                <Button type="primary" icon={<PenLine size={14} />} onClick={() => setEditorTab('content')}>去起稿</Button>
              </div>
            </div>
            <aside className="editorial-evidence">
              {draft.signal && <div className="signal-card">
                <div className="signal-score"><strong>{draft.signal.score}</strong><span>推荐评分</span></div>
                <p className="signal-window">{draft.signal.window}</p>
                <p className="signal-why">{draft.signal.why}</p>
                <div className="signal-dims">{draft.signal.dimensions.map(d => <span key={d.key}>{d.label} <b>{d.note}</b></span>)}</div>
                <small>由采集记录规则计算，不代表事实判断</small>
              </div>}
              <h2>为什么做这个选题</h2><p>{rationaleText(draft)}</p>
              <h2>参考原文（{draft.sources.length}）</h2>
              {draft.sources.map((source, i) => <article key={source.id}><small>[{i + 1}] {source.sourceName} · 采集片段</small><h3>{source.title}</h3>{originalUrl(source.url) ? <a href={originalUrl(source.url)} target="_blank" rel="noopener noreferrer">查看原文 <ExternalLink size={12} /></a> : <span>原文链接缺失</span>}</article>)}
              <h2>还需核验（{draft.checks.length}）</h2><ul>{draft.checks.map((check, i) => <li key={i}>{check}</li>)}</ul>
            </aside>
          </div> : <div className="writing-grid">
            <div className="writing-main">
              <div className="writing-toolbar">
                <div><strong>正文</strong><span>{content.length} 字 · {published ? '已标记发布' : content.trim() ? '草稿待核验' : '尚未起稿'}</span></div>
                <div><Button icon={<Sparkles size={14} />} disabled={draft.archived} onClick={generateDraft}>按提纲生成初稿</Button><Button icon={<ArrowRight size={14} />} onClick={() => props.onNavigate('actions')}>去看检查表</Button></div>
              </div>
              <Input.TextArea className="writing-area" aria-label="正文内容" value={content} disabled={busy || draft.archived} placeholder="在这里写正文，或点「按提纲生成初稿」得到一份带参考线索编号、明确标注待核验的草稿。" autoSize={{ minRows: 18, maxRows: 40 }} onChange={e => setDraft({ ...draft, content: e.target.value, status: draft.status === 'idea' ? 'draft' : draft.status })} />
              <div className="writing-publish">
                <div>
                  <strong>{published ? '这篇已标记为发布' : todoCount ? `还有 ${todoCount} 项发布前检查未完成` : '检查项已全部完成，可以标记发布'}</strong>
                  <p>{published ? `发布于 ${draft.publishedAt ? new Date(draft.publishedAt).toLocaleString('zh-CN') : '—'}；正文与参考原文会一直保留。` : '标记发布只是记录成稿状态，不会自动发到任何平台；导出 Markdown 后可自行发布。'}</p>
                </div>
                {published
                  ? <Tag color="green"><CheckCircle2 size={13} /> 已发布</Tag>
                  : <Button type="primary" icon={<CheckCircle2 size={14} />} loading={busy} disabled={!content.trim() || todoCount > 0 || draft.archived} onClick={() => void save({ status: 'published' })}>标记已发布</Button>}
              </div>
            </div>
            <aside className="writing-side">
              <h2>发布前检查表</h2>
              <Progress percent={progressOf(draft)} />
              <p>{draft.tasks.filter(t => t.done).length}/{draft.tasks.length} 项已完成。全部勾完才能标记已发布。</p>
              <ul>{draft.tasks.map(task => <li key={task.id} className={task.done ? 'is-done' : ''}>{task.done ? '✓' : '○'} {task.title}</li>)}</ul>
              <Button block onClick={() => props.onNavigate('actions')}>逐项核验</Button>
            </aside>
          </div>}

          <div className="studio-archive">
            <span>{draft.archived ? '资料与检查进度已保留，恢复后可继续编辑。' : '归档 = 这条选题不再处理；归档前需完成全部检查项，之后内容只读、可随时恢复。'}</span>
            <Button icon={draft.archived ? <RotateCcw size={14} /> : <Archive size={14} />} loading={busy} disabled={!draft.archived && todoCount > 0} onClick={() => void save({ archived: !draft.archived })}>{draft.archived ? '恢复选题' : '不再处理并归档'}</Button>
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
  const publishable = activeBriefs.filter(brief => brief.status !== 'published' && brief.tasks.length > 0 && brief.tasks.every(task => task.done));
  const visible = rows.filter(row => (props.taskFilter === 'all' || (props.taskFilter === 'done' ? row.task.done : !row.task.done)) && (props.briefFilter === 'all' || row.briefId === props.briefFilter));
  const groups: Array<{ label: string; hint: string; rows: ActionRow[] }> = [
    { label: '已逾期', hint: '计划日期已过，优先核验', rows: [] },
    { label: '今天', hint: '今天计划完成', rows: [] },
    { label: '之后', hint: '已排期的后续核验', rows: [] },
    { label: '未排期', hint: '还没安排日期', rows: [] },
    { label: '已完成', hint: '核验完成，可进入发布', rows: [] }
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
        <span className="editorial-eyebrow">发布前检查 · PRE-PUBLISH CHECKS</span>
        <h1>成稿之前，把该核验的都核验完</h1>
        <p>每条选题的核验事项汇总在这里：核对原文的发布时间、统计口径和适用条件，补官方材料或独立反馈。全部勾完，就能在「起稿」里把正文标记为已发布。</p>
      </div>
      <Button onClick={() => props.onNavigate('topics')}>回挑选题</Button>
    </header>
    {publishable.length > 0 && <div className="publish-ready"><CheckCircle2 size={16} /><span>有 {publishable.length} 条选题的核验项已全部完成，可以标记已发布了。</span><Button size="small" type="primary" onClick={() => props.onNavigate('topics')}>去标记发布</Button></div>}
    <div className="action-stats">
      <div><span>待核验</span><strong>{todo}</strong><small>项检查</small></div>
      <div><span>已完成</span><strong>{done}</strong><small>项检查</small></div>
      <div><span>可发布</span><strong>{publishable.length}</strong><small>条选题</small></div>
    </div>
    <div className="action-toolbar">
      <Segmented value={props.taskFilter} onChange={(value) => props.onTaskFilter(String(value))} options={[{ label: '全部', value: 'all' }, { label: '待核验', value: 'todo' }, { label: '已完成', value: 'done' }]} />
      <Select aria-label="按选题筛选检查项" value={props.briefFilter} onChange={props.onBriefFilter} style={{ width: 240 }} options={[{ value: 'all', label: '全部选题' }, ...props.briefs.map(brief => ({ value: brief.id, label: (brief.archived ? '已归档 · ' : '') + brief.title }))]} />
    </div>
    <div className="action-add">
      <Input aria-label="添加一条核验项" placeholder="添加一条核验项，例如：核对官方发布说明" value={props.newTask} maxLength={300} onChange={e => props.onNewTask(e.target.value)} onPressEnter={props.onAdd} />
      <Select aria-label="检查项所属选题" value={props.newTaskBrief || activeBriefs[0]?.id} onChange={props.onNewTaskBrief} style={{ width: 230 }} options={activeBriefs.map(brief => ({ value: brief.id, label: brief.title }))} />
      <Button type="primary" icon={<Plus size={14} />} disabled={!props.newTask.trim() || !activeBriefs.length} onClick={props.onAdd}>添加检查项</Button>
    </div>
    {!visible.length && <Empty description="当前筛选下没有检查项"><Button onClick={() => { props.onTaskFilter('all'); props.onBriefFilter('all'); }}>查看全部检查项</Button></Empty>}
    {groups.filter(group => group.rows.length).map(group => <section className="action-group" key={group.label}>
      <div className="action-group-head"><h2>{group.label}<span>{group.rows.length}</span></h2><small>{group.hint}</small></div>
      {group.rows.map(row => {
        const key = row.briefId + ':' + row.task.id;
        const disabled = row.archived;
        return <article className={'action-row' + (row.task.done ? ' is-done' : '')} key={key}>
          <Checkbox aria-label={'完成：' + row.task.title} checked={row.task.done} disabled={disabled} onChange={e => props.onToggle(row, e.target.checked)} />
          <div className="action-row-main">
            <Input.TextArea aria-label="检查项内容" value={props.textDrafts[key] ?? row.task.title} maxLength={300} autoSize={{ minRows: 1, maxRows: 3 }} disabled={disabled} onChange={e => props.onTextDraft(key, e.target.value)} onBlur={() => props.onTextBlur(row)} />
            <div className="action-row-meta">
              <button className="action-brief-link" onClick={() => props.onOpenBrief(row.briefId)}><FileText size={12} />{row.briefTitle}</button>
              <label>计划日期 <input type="date" aria-label={'计划日期：' + row.task.title} value={row.task.date} disabled={disabled} onChange={e => props.onDate(row, e.target.value)} /></label>
              {props.savingIds.includes(row.task.id) && <span className="action-saving">保存中…</span>}
              {row.archived && <span className="action-saving">已归档 · 只读</span>}
            </div>
          </div>
          <Tag color={row.task.done ? 'green' : 'default'}>{row.task.done ? '已完成' : '待核验'}</Tag>
        </article>;
      })}
    </section>)}
  </main>;
}
