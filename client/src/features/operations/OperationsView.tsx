import { useEffect, useState } from 'react';
import { Button, Card, Empty, Input, Select, Space, Table, Tag, message } from 'antd';
import { Download, ExternalLink, Plus, Send, Upload } from 'lucide-react';
import { request } from '../../shared/api';

export type OperationView = 'events' | 'runs' | 'sources' | 'notifications' | 'settings';
type OperationProps = { view: OperationView; onError: (value: string) => void };
const VIEW_FEATURE: Record<OperationView, string> = { events: '事件库', runs: '采集记录', sources: '来源健康', notifications: '通知渠道', settings: '数据管理' };
const featureName = (view: OperationView) => VIEW_FEATURE[view];

export function OperationsView(props: OperationProps) {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [channels, setChannels] = useState<Array<Record<string, unknown>>>([]);
  const [channelName, setChannelName] = useState('');
  const [channelType, setChannelType] = useState('webhook');
  const [channelEndpoint, setChannelEndpoint] = useState('');

  const load = async () => {
    try {
      if (props.view === 'events') setRows(((await request<{ data: Array<Record<string, unknown>> }>('/api/events?pageSize=50')).data));
      if (props.view === 'runs') setRows(((await request<{ data: Array<Record<string, unknown>> }>('/api/collect/runs?limit=50')).data));
      if (props.view === 'sources') setRows(((await request<{ data: Array<Record<string, unknown>> }>('/api/collect/health')).data));
      if (props.view === 'notifications') setChannels(((await request<{ data: Array<Record<string, unknown>> }>('/api/notifications/channels')).data));
    } catch (error) { props.onError(error instanceof Error ? error.message : `「${featureName(props.view)}」加载失败，请稍后重试`); }
  };
  useEffect(() => { void load(); }, [props.view]);

  if (props.view === 'settings') return <SettingsView onError={props.onError} />;
  if (props.view === 'notifications') return <section className="operations-view"><div className="operations-heading"><div><h1>通知渠道</h1><p>把重要变化送到你日常使用的协作工具。</p></div></div><Card className="operation-card"><Space.Compact block><Input placeholder="渠道名称" value={channelName} onChange={(event) => setChannelName(event.target.value)} /><Select value={channelType} onChange={setChannelType} options={[{ value: 'webhook', label: '通用 Webhook' }, { value: 'feishu', label: '飞书' }, { value: 'wecom', label: '企业微信' }, { value: 'dingtalk', label: '钉钉' }]} /><Input placeholder="Webhook 地址" value={channelEndpoint} onChange={(event) => setChannelEndpoint(event.target.value)} /><Button type="primary" icon={<Plus size={14} />} onClick={async () => { try { await request('/api/notifications/channels', { method: 'POST', body: JSON.stringify({ name: channelName, type: channelType, endpoint: channelEndpoint }) }); setChannelName(''); setChannelEndpoint(''); await load(); } catch (error) { props.onError(error instanceof Error ? error.message : '「通知渠道」创建失败，请稍后重试'); } }}>添加</Button></Space.Compact></Card><Table rowKey="id" dataSource={channels} pagination={false} columns={[{ title: '名称', dataIndex: 'name' }, { title: '类型', dataIndex: 'type' }, { title: '状态', dataIndex: 'enabled', render: (enabled) => <Tag color={enabled ? 'green' : 'default'}>{enabled ? '已启用' : '已暂停'}</Tag> }, { title: '操作', render: (_, row) => <Space><Button size="small" icon={<Send size={13} />} onClick={async () => { await request(`/api/notifications/channels/${String(row.id)}/test`, { method: 'POST' }); message.success('测试通知已发送'); }}>测试</Button><Button size="small" danger onClick={async () => { await request(`/api/notifications/channels/${String(row.id)}`, { method: 'DELETE' }); await load(); }}>删除</Button></Space> }]} /></section>;
  const config = props.view === 'events' ? { title: '事件库', description: '按事件查看跨来源聚合后的信息。', columns: [{ title: '事件', dataIndex: 'title' }, { title: '来源', dataIndex: 'sourceCount' }, { title: '信息', dataIndex: 'itemCount' }, { title: '最近更新', dataIndex: 'lastSeenAt' }] } : props.view === 'runs' ? { title: '采集任务', description: '查看每次采集的耗时、结果和异常。', columns: [{ title: '状态', dataIndex: 'status' }, { title: '来源', dataIndex: 'sources', render: (sources: unknown[]) => sources?.join('、') }, { title: '结果', dataIndex: 'results' }, { title: '完成时间', dataIndex: 'finishedAt' }] } : { title: '信息来源', description: '观察各来源的成功率和最近一次错误。', columns: [{ title: '来源', dataIndex: 'source' }, { title: '成功率', dataIndex: 'successRate', render: (value: number) => `${Math.round(value * 100)}%` }, { title: '平均耗时', dataIndex: 'averageDurationMs', render: (value: number) => `${Math.round(value)} ms` }, { title: '最近错误', dataIndex: 'lastError' }] };
  return <section className="operations-view"><div className="operations-heading"><div><h1>{config.title}</h1><p>{config.description}</p></div><Button onClick={() => void load()}>刷新</Button></div><Table rowKey={(row) => String(row.id ?? row.eventKey ?? row.source ?? `${row.title ?? ''}-${row.lastSeenAt ?? ''}`)} dataSource={rows} columns={config.columns} pagination={{ pageSize: 12 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /> }} /></section>;
}

function SettingsView(props: { onError: (value: string) => void }) {
  const download = (format: string) => { window.open(`/api/data/export?format=${format}`, '_blank', 'noopener,noreferrer'); };
  return <section className="operations-view"><div className="operations-heading"><div><h1>设置</h1><p>管理数据导出、备份和恢复。</p></div></div><Card className="operation-card"><Space wrap><Button icon={<Download size={14} />} onClick={() => download('json')}>导出 JSON</Button><Button icon={<Download size={14} />} onClick={() => download('csv')}>导出 CSV</Button><Button icon={<ExternalLink size={14} />} onClick={() => download('backup')}>下载备份</Button><label className="restore-button"><Upload size={14} />恢复备份<input type="file" accept="application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = async () => { try { await request('/api/data/restore', { method: 'POST', body: String(reader.result) }); message.success('备份已恢复'); } catch (error) { props.onError(error instanceof Error ? error.message : '「数据管理」恢复失败，请稍后重试'); } }; reader.readAsText(file); }} /></label></Space></Card></section>;
}
