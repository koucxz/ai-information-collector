/// <reference types="vite/client" />

/** 构建时注入的源站基址；未注入时为空串 → 相对路径 + 纯 cookie，行为与改造前完全一致。 */
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || '').replace(/\/+$/, '');

const TOKEN_KEY = 'signaldock_token';

/** localStorage 在 SSR / 隐私模式 / 存储被禁用时可能不可用，全部读写静默降级。 */
export function getToken(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(TOKEN_KEY);
  } catch { return null; }
}

export function setToken(token: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch { /* 隐私模式等场景下降级为纯 cookie */ }
}

export function clearToken(): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* 同上 */ }
}
