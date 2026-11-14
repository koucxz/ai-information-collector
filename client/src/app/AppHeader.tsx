import { Badge, Button, Tooltip } from 'antd';
import { Bell, Bookmark, FileText, LogOut, Radar, RefreshCw, Rss, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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

// 采用阅读器 / CMS 里最常见的名字，并在每项下面用一句话说明用途
const VIEW_NAMES: Record<WorkspaceView, string> = {
  inbox: '信息流', saved: '收藏夹', posts: '文章', manage: '设置',
  events: '事件库', runs: '采集任务', sources: '信息来源', notifications: '通知渠道', settings: '数据与设置'
};
const NAV: Array<{ view: WorkspaceView; label: string; hint: string; icon: LucideIcon }> = [
  { view: 'inbox', label: '信息流', hint: '采集到的最新信息', icon: Rss },
  { view: 'saved', label: '收藏夹', hint: '留着准备写的线索', icon: Bookmark },
  { view: 'posts', label: '文章', hint: '写草稿、导出成稿', icon: FileText },
  { view: 'manage', label: '设置', hint: '主题与数据来源', icon: Settings2 }
];
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
      <span className="workspace-private">个人工作区</span>
      <nav className="workspace-nav" aria-label="主导航">
        {NAV.map(({ view, label, hint, icon: Icon }) => <button
          key={view}
          aria-current={(view === 'manage' ? inSettings : props.activeView === view) ? 'page' : undefined}
          onClick={() => props.onNavigate(view)}
        >
          <Icon size={17} />
          <span><strong>{label}</strong><small>{hint}</small></span>
        </button>)}
      </nav>
      <div className="workspace-sidebar-foot">
        <span>按主题自动打标</span>
        <span>只在你点击时采集</span>
      </div>
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
        <Button className="topbar-logout" aria-label="退出登录" icon={<LogOut size={15} />} onClick={props.onLogout}>退出登录</Button>
      </div>
    </header></>
  );
}
