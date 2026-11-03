export async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const payload = response.status === 204 ? null : await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload?.error ?? '操作失败');
  return payload as T;
}
