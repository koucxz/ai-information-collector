// 真实信息源统一出口：浏览器 UA、跟随跳转、超时即放弃
// 之前的百度适配器用 'SignalDock/0.1' 当 UA，直接被打到风控页，请勿改回自定义 UA
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const withTimeout = async (
  input: string,
  init: RequestInit = {},
  timeoutMs = 9_000
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      redirect: 'follow',
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(init.headers as Record<string, string> | undefined)
      }
    });
  } finally {
    clearTimeout(timer);
  }
};

export const fetchText = async (url: string, options: { timeoutMs?: number; accept?: string } = {}): Promise<string> => {
  const response = await withTimeout(url, { headers: { Accept: options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } }, options.timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
};

export const fetchJson = async <T>(url: string, options: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<T> => {
  const response = await withTimeout(url, { headers: { Accept: 'application/json', ...options.headers } }, options.timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
};
