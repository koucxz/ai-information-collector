import { useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, Input } from 'antd';
import { request } from '../shared/api';
import { Compass, ListChecks, LockKeyhole, NotebookPen, Radar, ShieldCheck } from 'lucide-react';

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'SignalDock2026.';

export function LoginView({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState(DEFAULT_USERNAME);
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      onLogin();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登录失败');
    } finally { setLoading(false); }
  };
  return <main className="login-shell"><section className="login-story"><div className="brand"><span className="brand-mark"><Radar size={19} /></span><strong>SignalDock</strong></div><div><span className="editorial-eyebrow">YOUR PRIVATE SIGNAL SPACE</span><h1>从信息里，<br />找到你的下一步。</h1><p>把散落的线索整理成有依据的选题，<br />让每次关注都能走向行动。</p><div className="login-steps"><span><Compass size={16} />发现线索</span><span><NotebookPen size={16} />形成选题</span><span><ListChecks size={16} />采取行动</span></div></div><p><ShieldCheck size={15} />你的关注、资料与选题，仅自己可见。</p></section><form className="login-card" onSubmit={submit}>
    <LockKeyhole size={26} color="#16734a" />
    <h1>登录个人工作区</h1><p>使用管理员账号继续</p>
    {error && <Alert type="error" title={error} showIcon />}
    <label>用户名<Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
    <label>密码<Input.Password value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
    <Button type="primary" htmlType="submit" loading={loading} block>登录</Button>
    <small><ShieldCheck size={14} />仅限管理员访问</small>
  </form></main>;
}
