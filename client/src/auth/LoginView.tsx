import { useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, Input } from 'antd';
import { request } from '../shared/api';

export function LoginView({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
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
  return <main className="login-shell"><form className="login-card" onSubmit={submit}>
    <div className="brand"><span className="brand-mark">◈</span><strong>SignalDock</strong></div>
    <h1>登录管理控制台</h1>
    {error && <Alert type="error" title={error} showIcon />}
    <label>用户名<Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
    <label>密码<Input.Password value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
    <Button type="primary" htmlType="submit" loading={loading} block>登录</Button>
  </form></main>;
}
