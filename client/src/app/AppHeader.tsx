import { Badge, Button, Tooltip } from 'antd';
import { Bell, Radar, RefreshCw } from 'lucide-react';
import type { FeedMode, ServiceStatus } from '../shared/types';

type AppHeaderProps = {
  feedMode: FeedMode;
  serviceStatus: ServiceStatus;
  unreadCount: number;
  collecting: boolean;
  onChangeMode: (mode: FeedMode) => void;
  onCheckHealth: () => void;
  onLoadDigest: () => void;
  onRunCollection: () => void;
};

export function AppHeader(props: AppHeaderProps) {
  const { feedMode, serviceStatus, unreadCount, collecting } = props;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"><Radar size={18} /></span>
        <strong>SignalDock</strong>
      </div>
      <nav className="main-nav" aria-label="主导航">
        <button className={feedMode !== 'relevant' ? 'active' : ''} onClick={() => props.onChangeMode('all')}>信息流</button>
        <button className={feedMode === 'relevant' ? 'active' : ''} onClick={() => props.onChangeMode('relevant')}>重点</button>
        <button onClick={props.onLoadDigest}>摘要</button>
      </nav>
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
    </header>
  );
}
