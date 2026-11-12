import { Database, Layers3, ListChecks, Radio, Bell, SlidersHorizontal } from 'lucide-react';
import { OperationsView } from '../operations/OperationsView';
import type { OperationView } from '../operations/OperationsView';
import { TopicSettingsPanel } from '../topics/TopicSettingsPanel';
import type { TopicSettingsPanelProps } from '../topics/TopicSettingsPanel';
import type { WorkspaceView } from '../../shared/types';

export type SettingsView = 'manage' | OperationView;

const MENU: Array<{ view: SettingsView; label: string; hint: string; icon: typeof SlidersHorizontal }> = [
  { view: 'manage', label: '关注与采集', hint: '主题、关键词、采集来源', icon: SlidersHorizontal },
  { view: 'events', label: '事件库', hint: '跨来源聚合事件', icon: Layers3 },
  { view: 'runs', label: '采集任务', hint: '运行记录与异常', icon: ListChecks },
  { view: 'sources', label: '信息来源', hint: '成功率与错误', icon: Radio },
  { view: 'notifications', label: '通知渠道', hint: '推送与测试', icon: Bell },
  { view: 'settings', label: '数据与设置', hint: '导出、备份与恢复', icon: Database }
];

type SettingsPageProps = {
  view: SettingsView;
  onNavigate: (view: WorkspaceView) => void;
  onError: (value: string) => void;
  topicSettings: TopicSettingsPanelProps;
};

/** 独立的采集与管理设置页：左侧菜单平铺，右侧展示对应内容。 */
export function SettingsPage(props: SettingsPageProps) {
  return (
    <div className="settings-layout">
      <aside className="settings-menu" aria-label="设置菜单">
        <div className="settings-menu-title">采集与管理</div>
        <nav>
          {MENU.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.view} aria-current={props.view === item.view ? 'page' : undefined} onClick={() => props.onNavigate(item.view)}>
                <Icon size={15} />
                <span><strong>{item.label}</strong><small>{item.hint}</small></span>
              </button>
            );
          })}
        </nav>
        <p className="settings-menu-foot">仅管理员可见 · 数据保存在本地</p>
      </aside>
      <section className="settings-content">
        {props.view === 'manage' ? (
          <div className="settings-panel">
            <div className="settings-panel-head">
              <h1>关注与采集</h1>
              <p>管理关注主题、关键词以及每次采集使用的信息来源。</p>
            </div>
            <TopicSettingsPanel {...props.topicSettings} />
          </div>
        ) : <OperationsView view={props.view} onError={props.onError} />}
      </section>
    </div>
  );
}
