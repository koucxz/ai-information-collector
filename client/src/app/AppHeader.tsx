import { Badge, Button, Select, Tooltip } from 'antd';
import { Bell, Compass, ListChecks, LogOut, NotebookPen, Radar, RefreshCw } from 'lucide-react';
import type { FeedMode, ServiceStatus, WorkspaceView } from '../shared/types';

type AppHeaderProps = {
  feedMode: FeedMode;
  serviceStatus: ServiceStatus;
  unreadCount: number;
  collecting: boolean;
  onChangeMode: (mode: FeedMode) => void;
  onCheckHealth: () => void;
  onLoadDigest: () => void;
  onRunCollection: () => void;
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  onLogout: () => void;
};

export function AppHeader(props: AppHeaderProps) {
  const { serviceStatus, unreadCount, collecting } = props;
  return (
    <><aside className="workspace-sidebar">
      <div className="brand">
        <span className="brand-mark"><Radar size={18} /></span>
        <strong>SignalDock</strong>
      </div>
      <span className="workspace-private">个人工作区 · PRIVATE</span>
      <nav className="workspace-nav" aria-label="主导航">
        <button aria-current={props.activeView === 'inbox' ? 'page' : undefined} onClick={() => props.onNavigate('inbox')}><Compass size={17} />发现信息</button>
        <button aria-current={props.activeView === 'topics' ? 'page' : undefined} onClick={() => props.onNavigate('topics')}><NotebookPen size={17} />选题工作台</button>
        <button aria-current={props.activeView === 'actions' ? 'page' : undefined} onClick={() => props.onNavigate('actions')}><ListChecks size={17} />行动清单</button>
      </nav>
      <label className="workspace-admin">采集与管理<Select aria-label="采集与管理" placeholder="管理入口" value={['events', 'runs', 'sources', 'notifications', 'settings'].includes(props.activeView) ? props.activeView : undefined} onChange={props.onNavigate} options={[{ value: 'events', label: '事件库' }, { value: 'runs', label: '采集任务' }, { value: 'sources', label: '来源' }, { value: 'notifications', label: '通知' }, { value: 'settings', label: '数据与设置' }]} /></label>
      <Button className="workspace-logout" icon={<LogOut size={15} />} onClick={props.onLogout}>退出登录</Button>
    </aside><header className="topbar workspace-topbar">
      <span className="workspace-breadcrumb">工作区 / {({ inbox: '发现信息', topics: '选题工作台', actions: '行动清单', events: '事件库', runs: '采集任务', sources: '来源', notifications: '通知', settings: '数据与设置' })[props.activeView]}</span>
      <div className="top-actions">
        <button className={'service-state ' + serviceStatus} onClick={props.onCheckHealth}>
          <i />{serviceStatus === 'online' ? '采集器在线' : serviceStatus === 'checking' ? '正在连接' : '服务离线'}
        </button>
        <Badge dot={unreadCount > 0} offset={[-3, 4]}>
          <Tooltip title="今日摘要">
            <Button className="square-button" aria-label="今日摘要" icon={<Bell size={15} />} onClick={props.onLoadDigest} />
          </Tooltip>
        </Badge>
        <Button
          type="primary"
          icon={<RefreshCw size={14} className={collecting ? 'spin' : ''} />}
          loading={collecting}
          onClick={props.onRunCollection}
        >
          立即采集
        </Button>
      </div>
    </header></>
  );
}
