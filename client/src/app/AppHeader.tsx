import { Badge, Button, Tooltip } from 'antd';
import { Bell, Compass, ListChecks, LogOut, NotebookPen, Radar, RefreshCw, Settings2 } from 'lucide-react';
import type { ServiceStatus, WorkspaceView } from '../shared/types';

type AppHeaderProps = {
  serviceStatus: ServiceStatus;
  unreadCount: number;
  collecting: boolean;
  onCheckHealth: () => void;
  onLoadDigest: () => void;
  onRunCollection: () => void;
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  onLogout: () => void;
};

const VIEW_NAMES: Record<WorkspaceView, string> = {
  inbox: '发现信息', topics: '选题工作台', actions: '行动清单', manage: '设置',
  events: '事件库', runs: '采集任务', sources: '信息来源', notifications: '通知渠道', settings: '数据与设置'
};
const MANAGEMENT_VIEWS: WorkspaceView[] = ['manage', 'events', 'runs', 'sources', 'notifications', 'settings'];

export function AppHeader(props: AppHeaderProps) {
  const { serviceStatus, unreadCount, collecting } = props;
  const inSettings = MANAGEMENT_VIEWS.includes(props.activeView);
  const breadcrumb = props.activeView === 'manage' || !inSettings
    ? `工作区 / ${VIEW_NAMES[props.activeView]}`
    : `设置 / ${VIEW_NAMES[props.activeView]}`;
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
        <button aria-current={inSettings ? 'page' : undefined} onClick={() => props.onNavigate('manage')}><Settings2 size={17} />设置</button>
      </nav>
      <Button className="workspace-logout" icon={<LogOut size={15} />} onClick={props.onLogout}>退出登录</Button>
    </aside><header className="topbar workspace-topbar">
      <span className="workspace-breadcrumb">{breadcrumb}</span>
      <div className="top-actions">
        <button className={'service-state ' + serviceStatus} onClick={props.onCheckHealth}>
          <i />{serviceStatus === 'online' ? '采集器在线' : serviceStatus === 'checking' ? '正在连接' : '连接异常 · 点击重试'}
        </button>
        <Badge dot={unreadCount > 0} offset={[-3, 4]}>
          <Tooltip title="今日摘要">
            <Button className="square-button" aria-label="今日摘要" icon={<Bell size={15} />} onClick={props.onLoadDigest} />
          </Tooltip>
        </Badge>
        <Tooltip title="当前仅手动采集；未启用定时计划。点击后按所选来源抓取一次">
          <Button
            type="primary"
            icon={<RefreshCw size={14} className={collecting ? 'spin' : ''} />}
            loading={collecting}
            onClick={props.onRunCollection}
          >
            立即采集
          </Button>
        </Tooltip>
      </div>
    </header></>
  );
}
