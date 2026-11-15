import { API_BASE, getToken, clearToken } from './config';
export { API_BASE } from './config';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** 连接类错误自带功能名称，任何调用方都能直接把 message 交给 UI 提示。 */
export class ConnectionError extends Error {
  constructor(public feature: string, public reason: 'timeout' | 'network' | 'server', message: string) { super(message); }
}

export type RequestOptions = RequestInit & {
  feature?: string;
  timeoutMs?: number;
  /** 后台请求（轮询、健康检查、预取）：不触发全局「加载中」提示 */
  silent?: boolean;
};

const LOGIN_PATH = '/api/auth/login';
const QUICK_TIMEOUT_MS = 7_000;
const SLOW_TIMEOUT_MS = 120_000;
/** 超过这个时长：记一次慢连接进看板，如果属于主视图再弹「加载中」提示 */
const SLOW_HINT_MS = 2_500;
const QUICK_RETRIES = 2;

/**
 * 允许弹全局「加载中」提示的功能：用户正在盯着等结果的三个主视图。
 * 其余功能（概览计数、来源清单、设置页表格、写稿轮询……）页面自己有加载态，
 * 弹出来只会变成看不懂的噪音，一律不提示。
 */
const NOTICE_FEATURES = new Set(['信息流', '收藏夹', '文章']);

/** 从接口路径推断功能名，保证任何一条超时/连接错误都能带上「对应功能名称」。 */
const PATH_FEATURES: Array<[RegExp, string]> = [
  [/^\/api\/health/, '服务状态'],
  [/^\/api\/auth\/login/, '登录'],
  [/^\/api\/auth\/logout/, '退出登录'],
  [/^\/api\/auth\/me/, '会话校验'],
  [/^\/api\/information\/overview/, '信息概览'],
  [/^\/api\/information/, '信息流'],
  [/^\/api\/topics/, '关注主题'],
  [/^\/api\/briefs\/candidates/, '候选线索'],
  [/^\/api\/briefs/, '文章'],
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
  if (/\/generate$/.test(path)) return '新建草稿';
  if (/\/save$/.test(path)) return '收藏管理';
  if (/\/retag$/.test(path)) return '主题打标';
  if (/\/read$/.test(path)) return '标记已读';
  if (/\/feedback$/.test(path)) return '信息反馈';
  if (/\/event$/.test(path)) return '事件详情';
  if (/\/test$/.test(path)) return '测试通知';
  if (method === 'POST' && path === '/api/briefs') return '新建草稿';
  if (method !== 'GET' && /^\/api\/briefs\//.test(path)) return '文章编辑';
  if (method !== 'GET' && /^\/api\/topics\//.test(path)) return '主题编辑';
  for (const [pattern, name] of PATH_FEATURES) if (pattern.test(path)) return name;
  return '服务请求';
}

type PacePhase = 'slow' | 'retry' | 'done';

/** 页面作用域：请求发起时绑定，切页后旧页面未完成请求的提示不再出现。 */
export const PACE_SCOPE_EVENT = 'signaldock:pace-scope';
let paceScope = 'global';
export function getPaceScope(): string { return paceScope; }
export function setPaceScope(scope: string): void {
  if (paceScope === scope) return;
  paceScope = scope;
  window.dispatchEvent(new Event(PACE_SCOPE_EVENT));
}

const pace = (scope: string, feature: string, phase: PacePhase) => {
  window.dispatchEvent(new CustomEvent('signaldock:request-pace', { detail: { scope, feature, phase } }));
};

/** 把真实用户侧的慢连接/超时留痕，供 /ops/status 看板统计；上报失败绝不影响业务请求。 */
function reportTelemetry(feature: string, reason: 'timeout' | 'network' | 'server' | 'slow', ms: number): void {
  try {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    const body = JSON.stringify({ feature, reason, ms: Math.round(ms), origin: window.location.host });
    navigator.sendBeacon(API_BASE + '/api/telemetry', new Blob([body], { type: 'application/json' }));
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
  const scope = paceScope;
  const announce = !options.silent && NOTICE_FEATURES.has(feature);
  const key = method + ' ' + url;
  if (readOnly && !options.signal && inflight.has(key)) return inflight.get(key) as Promise<T>;
  const task = run<T>(url, options, method, feature, scope, announce).finally(() => { pace(scope, feature, 'done'); inflight.delete(key); });
  if (readOnly && !options.signal) inflight.set(key, task);
  return task;
}

async function run<T>(url: string, options: RequestOptions, method: string, feature: string, scope: string, announce: boolean): Promise<T> {
  const { feature: _feature, timeoutMs: _timeoutMs, silent: _silent, ...init } = options;
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
    // 2.5 秒还没回来：后台请求只留痕，主视图才真的弹「加载中」提示
    const slowTimer = attempt === 0 && quick
      ? window.setTimeout(() => {
        if (!options.silent && !slowReported) {
          slowReported = true;
          reportTelemetry(feature, 'slow', SLOW_HINT_MS);
        }
        if (announce) pace(scope, feature, 'slow');
      }, SLOW_HINT_MS)
      : undefined;
    const signal = options.signal
      ? combineSignals([controller.signal, options.signal])
      : controller.signal;
    try {
      const target = url.startsWith('/api/') ? API_BASE + url : url;
      const token = getToken();
      const response = await fetch(target, {
        ...init,
        credentials: 'include',
        signal,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...init.headers
        }
      });
      if (response.status === 401) {
        clearToken();
        if (!url.startsWith('/api/auth/')) window.dispatchEvent(new Event('signaldock:unauthorized'));
      }
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
      // 重试事件只在会提示的功能上发，否则等于给后台请求也弹了「加载中」
      if (attempt < retries && announce) pace(scope, feature, 'retry');
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
