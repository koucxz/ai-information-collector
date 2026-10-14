import { useEffect, useState } from 'react';

const sources = ['百度', 'B 站', '微博', '知乎', '掘金', 'GitHub'];
type ServiceStatus = 'checking' | 'online' | 'offline';

function App() {
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('checking');

  const checkHealth = async () => {
    setServiceStatus('checking');

    try {
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error('health check failed');
      }

      const payload = (await response.json()) as { status?: string };
      setServiceStatus(payload.status === 'ok' ? 'online' : 'offline');
    } catch {
      setServiceStatus('offline');
    }
  };

  useEffect(() => {
    void checkHealth();
  }, []);

  const statusLabel = {
    checking: '正在连接服务',
    online: '服务已连接',
    offline: '服务未连接'
  }[serviceStatus];

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <div>
            <strong>SignalDock</strong>
            <span>AI 信息雷达</span>
          </div>
        </div>
        <div className="status-group">
          <span className={`status status-${serviceStatus}`}><i /> {statusLabel}</span>
          {serviceStatus === 'offline' && <button className="retry-button" onClick={() => void checkHealth()}>重新检查</button>}
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">PERSONAL INFORMATION RADAR</p>
        <h1>把真正重要的信息，<em>留在视线里。</em></h1>
        <p className="intro">围绕关注主题持续收集国内信息，合并重复内容，识别变化，再交给 AI 做初步整理。</p>
        <div className="hero-actions">
          <button className="primary">添加关注主题</button>
          <button className="secondary">查看开发路线</button>
        </div>
      </section>

      <section className="overview-grid">
        <article className="panel focus-panel">
          <div className="panel-heading"><span>当前关注</span><b>0 个主题</b></div>
          <div className="empty-state"><span className="empty-icon">＋</span><p>还没有关注主题</p><small>添加一个主题，开始收集信息</small></div>
        </article>
        <article className="panel stats-panel">
          <div className="panel-heading"><span>信息概览</span><span className="muted">今天</span></div>
          <div className="stats"><div><strong>0</strong><span>新信息</span></div><div><strong>0</strong><span>待查看</span></div><div><strong>0</strong><span>来源</span></div></div>
          <div className="source-list">{sources.map((source) => <span key={source}>{source}</span>)}</div>
        </article>
      </section>

      <section className="panel roadmap-panel">
        <div className="panel-heading"><span>开发路线</span><span className="muted">第一版</span></div>
        <div className="roadmap"><div className="roadmap-item active"><i />关注主题和关键词</div><div className="roadmap-item"><i />国内信息源采集</div><div className="roadmap-item"><i />去重、合并和变化检测</div><div className="roadmap-item"><i />AI 分析和信息流</div></div>
      </section>
    </main>
  );
}

export default App;
