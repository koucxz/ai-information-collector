import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Input, Progress, Radio, Select, Tag } from 'antd';
import { Archive, ArrowRight, Copy, Download, ExternalLink, Plus, RotateCcw, Save } from 'lucide-react';
import { request } from '../../shared/api';
import { originalUrl } from '../../shared/links';
import type { EditorialBrief } from '../../shared/types';

type Props = { view: 'topics' | 'actions'; selectedId: string; revision: number; onSelect: (id: string) => void; onNavigate: (view: 'inbox' | 'topics' | 'actions') => void; onDirty: (dirty: boolean) => void };
const editable = (brief: EditorialBrief) => ({ title: brief.title, reader: brief.reader, angle: brief.angle, outline: brief.outline, tasks: brief.tasks });
const markdown = (brief: EditorialBrief) => `# ${brief.title}\n\n面向读者：${brief.reader}\n\n切入角度：${brief.angle === 'guide' ? '选型指南' : '工程解读'}\n\n生成方式：${brief.provider === 'ai' ? 'AI 综合建议' : '本地模板'}；关键结论待核验。\n\n${brief.rationale}\n\n## 提纲\n\n${brief.outline.map((s, i) => `${i + 1}. ${s.title}\n   ${s.detail}\n   参考：${s.sourceIds.map(id => `[${brief.sources.findIndex(source => source.id === id) + 1}]`).join(' ') || '待补充证据'}`).join('\n\n')}\n\n## 待核验\n${brief.checks.map(c => '- ' + c).join('\n')}\n\n## 参考原文\n${brief.sources.map((s, i) => `[${i + 1}] ${s.title}\n${originalUrl(s.url) || '原文链接缺失'}`).join('\n\n')}\n\n## 行动\n${brief.tasks.map(t => `- [${t.done ? 'x' : ' '}] ${t.title}${t.date ? '（' + t.date + '）' : ''}`).join('\n')}`;

export function EditorialWorkspace(props: Props) {
  const [briefs, setBriefs] = useState<EditorialBrief[]>([]);
  const [base, setBase] = useState<EditorialBrief | null>(null);
  const [draft, setDraft] = useState<EditorialBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');
  const [newTask, setNewTask] = useState('');
  const dirty = !!draft && !!base && JSON.stringify(editable(draft)) !== JSON.stringify(editable(base));
  useEffect(() => { props.onDirty(dirty); }, [dirty, props.onDirty]);
  useEffect(() => () => props.onDirty(false), [props.onDirty]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void request<{ data: EditorialBrief[] }>('/api/briefs', { signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      setBriefs(data);
      const current = data.find(b => b.id === props.selectedId) || data[0] || null;
      setBase(current); setDraft(current); setNotice('');
    }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '选题加载失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [props.selectedId, props.revision]);

  const save = async (archived?: boolean) => {
    if (!draft || busy) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const changes = archived === false && draft.archived ? { archived: false } : { ...editable(draft), ...(archived === undefined ? {} : { archived }) };
      const { data } = await request<{ data: EditorialBrief }>('/api/briefs/' + draft.id, { method: 'PATCH', body: JSON.stringify({ version: draft.version, ...changes }) });
      setDraft(data); setBase(data); setBriefs(items => items.map(b => b.id === data.id ? data : b));
      setNotice(archived === true ? '选题已归档，资料和行动进度已保留' : archived === false ? '选题已恢复' : '修改已保存');
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败，当前编辑已保留'); return false; }
    finally { setBusy(false); }
  };
  const pick = (id: string) => {
    if (busy) return;
    if (dirty && !window.confirm('有尚未保存的修改，切换选题会放弃这些修改，继续吗？')) return;
    props.onSelect(id);
  };
  const exportBrief = async (copy: boolean) => {
    if (!draft) return;
    const content = markdown(draft);
    if (copy) {
      try { await navigator.clipboard.writeText(content); setNotice('已复制当前选题，包含参考原文与行动'); }
      catch { setError('浏览器未允许复制，请使用导出选题'); }
      return;
    }
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'SignalDock-选题.md'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (loading) return <main className="editorial-workspace"><p role="status">正在加载选题…</p></main>;
  if (!draft) return <main className="editorial-workspace">{error && <Alert type="error" title={error} />}<Empty description="还没有选题，先从多条信息里综合提炼"><Button type="primary" onClick={() => props.onNavigate('inbox')}>去发现信息</Button></Empty></main>;
  const done = draft.tasks.filter(t => t.done).length;
  const updateTask = (id: string, patch: Partial<EditorialBrief['tasks'][number]>) => setDraft({ ...draft, tasks: draft.tasks.map(t => t.id === id ? { ...t, ...patch } : t) });
  return <main className="editorial-workspace">
    <div className="editorial-heading"><div><span className="editorial-eyebrow">{props.view === 'topics' ? 'TOPIC STUDIO' : 'NEXT ACTIONS'}</span><h1>{props.view === 'topics' ? '把多条线索，变成一个好问题。' : '每条选题，都有下一步。'}</h1><p>{props.view === 'topics' ? '综合来源、明确角度，再把想法变成可执行的计划。' : '修改任务、安排日期，完成后勾选并保存。'}</p></div><Button icon={<Download size={15} />} onClick={() => void exportBrief(false)}>导出选题</Button></div>
    <div className="editorial-toolbar"><label>当前选题 <Select aria-label="选择选题" disabled={busy} value={draft.id} onChange={pick} options={briefs.map(b => ({ value: b.id, label: (b.archived ? '已归档 · ' : '') + b.title }))} /></label><span aria-live="polite">{dirty ? '有未保存的修改' : '修改已保存'}</span><Button type="primary" icon={<Save size={14} />} loading={busy} disabled={!dirty || draft.archived} onClick={() => void save()}>保存修改</Button></div>
    {error && <Alert type="error" title={error} description="当前编辑已保留。如果是版本冲突，可先导出内容，再重新加载页面。" showIcon closable onClose={() => setError('')} />}
    {notice && <Alert type="success" title={notice} showIcon closable onClose={() => setNotice('')} />}
    <div className="editorial-labels"><Tag color={draft.archived ? 'default' : 'gold'}>{draft.archived ? '已归档' : '待核验'}</Tag><Tag>{draft.provider === 'ai' ? 'AI 综合建议' : '本地模板 · 可编辑'}</Tag><span>{draft.sources.length} 条参考线索</span></div>
    {props.view === 'topics' ? <div className="editorial-grid"><section className="editorial-editor">
      <fieldset disabled={busy || draft.archived}>
        <label className="editorial-field">选题标题<Input.TextArea aria-label="选题标题" value={draft.title} maxLength={200} autoSize={{ minRows: 2, maxRows: 4 }} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="editorial-field">写给谁看<Input value={draft.reader} maxLength={300} onChange={e => setDraft({ ...draft, reader: e.target.value })} /></label>
        <h2>选择切入角度</h2><Radio.Group value={draft.angle} onChange={e => setDraft({ ...draft, angle: e.target.value })}><Radio.Button value="guide">选型指南</Radio.Button><Radio.Button value="engineering">工程解读</Radio.Button></Radio.Group>
        <p className="editorial-hint">{draft.angle === 'guide' ? '围绕适用场景、比较维度和决策步骤完善提纲。' : '围绕工具链、运行条件和可复现验证完善提纲。'} 切换角度保留已编辑内容。</p>
        <div className="editorial-section-heading"><h2>内容提纲</h2><Button type="text" icon={<Copy size={14} />} onClick={() => void exportBrief(true)}>复制选题</Button></div>
        {draft.outline.map((section, index) => <div className="editorial-outline" key={index}><span>{String(index + 1).padStart(2, '0')}</span><div><Input aria-label={'提纲标题 ' + (index + 1)} value={section.title} maxLength={200} onChange={e => setDraft({ ...draft, outline: draft.outline.map((s, i) => i === index ? { ...s, title: e.target.value } : s) })} /><Input.TextArea aria-label={'提纲说明 ' + (index + 1)} value={section.detail} maxLength={1200} autoSize={{ minRows: 2, maxRows: 6 }} onChange={e => setDraft({ ...draft, outline: draft.outline.map((s, i) => i === index ? { ...s, detail: e.target.value } : s) })} /><small>{section.sourceIds.length ? '参考线索 ' + section.sourceIds.map(id => '[' + (draft.sources.findIndex(s => s.id === id) + 1) + ']').join(' ') : '待补充证据'}</small></div></div>)}
      </fieldset>
      <div className="editorial-section-heading"><span>先核验，再形成结论</span><Button type="primary" icon={<ArrowRight size={14} />} onClick={() => props.onNavigate('actions')}>进入行动清单</Button></div>
    </section><aside className="editorial-evidence"><h2>为什么做这个选题</h2><p>{draft.rationale}</p><h2>参考原文</h2>{draft.sources.map((source, i) => <article key={source.id}><small>[{i + 1}] {source.sourceName} · 采集片段</small><h3>{source.title}</h3>{originalUrl(source.url) ? <a href={originalUrl(source.url)} target="_blank" rel="noopener noreferrer">查看原文 <ExternalLink size={12} /></a> : <span>原文链接缺失</span>}</article>)}<h2>还需要核验</h2><ul>{draft.checks.map((check, i) => <li key={i}>{check}</li>)}</ul></aside></div> : <section className="editorial-actions">
      <div className="editorial-section-heading"><h2>{draft.title}</h2><Button onClick={() => props.onNavigate('topics')}>关联选题</Button></div>
      <p aria-live="polite">{done} / {draft.tasks.length} 已完成{dirty ? ' · 尚未保存' : ''}</p><Progress percent={Math.round(done / draft.tasks.length * 100)} showInfo={false} />
      <Radio.Group value={taskFilter} onChange={e => setTaskFilter(e.target.value)}><Radio.Button value="all">全部行动</Radio.Button><Radio.Button value="todo">待完成</Radio.Button><Radio.Button value="done">已完成</Radio.Button></Radio.Group>
      {draft.tasks.filter(t => taskFilter === 'all' || (taskFilter === 'done' ? t.done : !t.done)).map(task => <article className="editorial-task" key={task.id}><Checkbox aria-label={'完成：' + task.title} checked={task.done} disabled={busy || draft.archived} onChange={e => updateTask(task.id, { done: e.target.checked })} /><div><Input.TextArea aria-label="行动内容" value={task.title} maxLength={300} autoSize={{ minRows: 1, maxRows: 4 }} disabled={busy || draft.archived} onChange={e => updateTask(task.id, { title: e.target.value })} /><label>计划日期 <input type="date" aria-label={'计划日期：' + task.title} value={task.date} disabled={busy || draft.archived} onChange={e => updateTask(task.id, { date: e.target.value })} /></label></div><Tag>{task.done ? '已完成' : '待完成'}</Tag></article>)}
      {!draft.archived && <div className="editorial-add"><Input aria-label="添加行动" placeholder="添加一条行动" value={newTask} maxLength={300} onChange={e => setNewTask(e.target.value)} /><Button disabled={busy || !newTask.trim() || draft.tasks.length >= 30} icon={<Plus size={14} />} onClick={() => { setDraft({ ...draft, tasks: [...draft.tasks, { id: crypto.randomUUID(), title: newTask.trim(), done: false, date: '' }] }); setNewTask(''); }}>添加</Button></div>}
      <div className="editorial-section-heading"><p>{draft.archived ? '资料与行动已保留，可恢复后继续跟进。' : '完成全部行动后，可保存并归档。'}</p><Button icon={draft.archived ? <RotateCcw size={14} /> : <Archive size={14} />} loading={busy} disabled={!draft.archived && done !== draft.tasks.length} onClick={() => void save(!draft.archived)}>{draft.archived ? '恢复选题' : '完成并归档'}</Button></div>
    </section>}
  </main>;
}
