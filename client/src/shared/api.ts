export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  if (response.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('signaldock:unauthorized'));
  const payload = response.status === 204 ? null : await response.json() as { error?: string };
  if (!response.ok) throw new ApiError(response.status, payload?.error ?? '操作失败');
  return payload as T;
}
