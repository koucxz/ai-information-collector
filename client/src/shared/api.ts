export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

const LOGIN_PATH = '/api/auth/login';
const QUICK_TIMEOUT_MS = 7_000;
const SLOW_TIMEOUT_MS = 120_000;

/**
 * Vercel 边缘回源境内源站时偶发「连接建立但首字节不返回」，浏览器默认会一直挂起。
 * 普通查询与登录给短超时 + 重试；写操作只给长超时、不重试，避免重复创建数据。
 */
export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const readOnly = method === 'GET' || method === 'HEAD';
  const quick = readOnly || url === LOGIN_PATH;
  const timeoutMs = quick ? QUICK_TIMEOUT_MS : SLOW_TIMEOUT_MS;
  const retries = quick ? 2 : 0;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include',
        signal: controller.signal,
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers
        }
      });
      if (response.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('signaldock:unauthorized'));
      const payload = response.status === 204 ? null : await response.json() as { error?: string };
      if (!response.ok) throw new ApiError(response.status, payload?.error ?? '操作失败');
      return payload as T;
    } catch (caught) {
      // 业务错误（4xx）立刻抛出；网络超时、5xx、非 JSON 响应才值得重试
      if (caught instanceof ApiError && (caught.status < 500 || attempt === retries)) throw caught;
      if (attempt === retries) throw new Error('服务连接超时，请稍后重试。');
    } finally {
      window.clearTimeout(timer);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw new Error('服务连接超时，请稍后重试。');
}
