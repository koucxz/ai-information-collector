export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** 连接类错误自带功能名称，任何调用方都能直接把 message 交给 UI 提示。 */
export class ConnectionError extends Error {
  constructor(public feature: string, public reason: 'timeout' | 'network' | 'server', message: string) { super(message); }
}

export type RequestOptions = RequestInit & { feature?: string; timeoutMs?: number };

const LOGIN_PATH = '/api/auth/login';
const QUICK_TIMEOUT_MS = 7_000;
const SLOW_TIMEOUT_MS = 120_000;
const SLOW_HINT_MS = 2_500;
const QUICK_RETRIES = 2;

/** 从接口路径推断功能名，保证任何一条超时/连接错误都能带上「对应功能名称」。 */
const PATH_FEATURES: Array<[RegExp, string]> = [
  [/^\/api\/health/, '服务状态'],
  [/^\/api\/auth\/login/, '登录'],
  [/^\/api\/auth\/logout/, '退出登录'],
  [/^\/api\/auth\/me/, '会话校验'],
  [/^\/api\/information\/overview/, '信息概览'],
  [/^\/api\/information/, '信息流'],
  [/^\/api\/topics/, '关注主题'],
  [/^\/api\/briefs\/candidates/, '选题推荐'],
  [/^\/api\/briefs/, '选题库'],
  [/^\/api\/collect\/run/, '立即采集'],
  [/^\/api\/collect\/sources/, '采集来源'],
  [/^\/api\/collect\/runs/, '采集记录'],
  [/^\/api\/collect\/health/, '来源健康'],
  [/^\/api\/collect/, '采集任务'],
  [/^\/api\/events/, '事件库'],
  [/^\/api\/notifications\/digest/, '今日摘要'],
  [/^\/api\/notifications/, '通知渠道'],
  [/^\/api\/data/, '数据管理']
];

function featureOf(url: string, method: string, explicit?: string): string {
  if (explicit) return explicit;
  const path = url.split('?')[0];
  if (/\/generate$/.test(path)) return '提炼选题';
  if (/\/read$/.test(path)) return '标记已读';
  if (/\/feedback$/.test(path)) return '信息反馈';
  if (/\/event$/.test(path)) return '事件详情';
  if (/\/test$/.test(path)) return '测试通知';
  if (method !== 'GET' && /^\/api\/briefs\//.test(path)) return '选题编辑';
  if (method !== 'GET' && /^\/api\/topics\//.test(path)) return '主题编辑';
  for (const [pattern, name] of PATH_FEATURES) if (pattern.test(path)) return name;
  return '服务请求';
}

type PacePhase = 'slow' | 'retry' | 'done';
const pace = (feature: string, phase: PacePhase) => {
  window.dispatchEvent(new CustomEvent('signaldock:request-pace', { detail: { feature, phase } }));
};

/** 把真实用户侧的慢连接/超时留痕，供 /ops/status 看板统计；上报失败绝不影响业务请求。 */
function reportTelemetry(feature: string, reason: 'timeout' | 'network' | 'server' | 'slow', ms: number): void {
  try {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    const body = JSON.stringify({ feature, reason, ms: Math.round(ms), origin: window.location.host });
    navigator.sendBeacon('/api/telemetry', new Blob([body], { type: 'application/json' }));
  } catch {
    // 忽略：链路故障时上报本身也可能失败
  }
}

/** 合并内部超时信号与调用方的取消信号，避免列表切换时残留挂起请求。 */
function combineSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) { controller.abort(signal.reason); break; }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

// 同一时刻完全相同的 GET 只发一次，减少跨境链路上的重复慢连接
const inflight = new Map<string, Promise<unknown>>();

/**
 * Vercel 边缘回源境内源站时偶发「连接建立但首字节不返回」，浏览器默认会一直挂起。
 * 普通查询与登录给短超时 + 重试；写操作只给长超时、不重试，避免重复创建数据。
 */
export function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const readOnly = method === 'GET' || method === 'HEAD';
  const feature = featureOf(url, method, options.feature);
  const key = method + ' ' + url;
  if (readOnly && !options.signal && inflight.has(key)) return inflight.get(key) as Promise<T>;
  const task = run<T>(url, options, method, feature).finally(() => { pace(feature, 'done'); inflight.delete(key); });
  if (readOnly && !options.signal) inflight.set(key, task);
  return task;
}

async function run<T>(url: string, options: RequestOptions, method: string, feature: string): Promise<T> {
  const { feature: _feature, timeoutMs: _timeoutMs, ...init } = options;
  const quick = method === 'GET' || method === 'HEAD' || url.startsWith(LOGIN_PATH);
  const timeoutMs = options.timeoutMs ?? (quick ? QUICK_TIMEOUT_MS : SLOW_TIMEOUT_MS);
  const retries = options.timeoutMs ? 0 : (quick ? QUICK_RETRIES : 0);
  // 用对象承载，避免 TS 把回调里的赋值排除在控制流分析之外
  const state: { reason: 'timeout' | 'network' | 'server' } = { reason: 'network' };
  const startedAt = performance.now();
  let slowReported = false;
  let errorReported = false;
  const emitError = (reason: 'timeout' | 'network' | 'server') => {
    if (errorReported) return;
    errorReported = true;
    reportTelemetry(feature, reason, performance.now() - startedAt);
  };

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { state.reason = 'timeout'; controller.abort(); }, timeoutMs);
    const slowTimer = attempt === 0 && quick
      ? window.setTimeout(() => {
        pace(feature, 'slow');
        if (!slowReported) {
          slowReported = true;
          reportTelemetry(feature, 'slow', SLOW_HINT_MS);
        }
      }, SLOW_HINT_MS)
      : undefined;
    const signal = options.signal
      ? combineSignals([controller.signal, options.signal])
      : controller.signal;
    try {
      const response = await fetch(url, {
        ...init,
        credentials: 'include',
        signal,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers
        }
      });
      if (response.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('signaldock:unauthorized'));
      const payload = response.status === 204 ? null : await response.json() as { error?: string };
      if (!response.ok) throw new ApiError(response.status, payload?.error ?? '操作失败');
      return payload as T;
    } catch (caught) {
      // 调用方主动取消（切换筛选/卸载）不算错误，也不重试
      if (options.signal?.aborted) throw caught;
      if (caught instanceof ApiError) {
        if (caught.status >= 500) state.reason = 'server';
        if (caught.status < 500 || attempt === retries) {
          // 服务端错误也算「服务连接错误」，同样带上功能名称；4xx 业务错误保留原文
          if (caught.status >= 500) {
            emitError('server');
            throw new ApiError(caught.status, `「${feature}」服务返回 ${caught.status}，请稍后重试`);
          }
          throw caught;
        }
      } else if (attempt === retries && state.reason !== 'timeout') {
        state.reason = 'network';
      }
      if (attempt < retries) pace(feature, 'retry');
    } finally {
      window.clearTimeout(timer);
      if (slowTimer) window.clearTimeout(slowTimer);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
  }

  const detail = state.reason === 'timeout'
    ? `响应超时，已自动重试 ${retries} 次`
    : state.reason === 'server' ? '服务暂时不可用' : '服务连接失败';
  emitError(state.reason);
  throw new ConnectionError(feature, state.reason, `「${feature}」${detail}，请稍后重试`);
}
