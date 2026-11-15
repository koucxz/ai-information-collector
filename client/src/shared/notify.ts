import { useCallback, useEffect, useRef } from 'react';
import { App as AntApp } from 'antd';
import { getPaceScope, PACE_SCOPE_EVENT } from './api';

type PaceDetail = { scope?: string; feature: string; phase: 'slow' | 'retry' | 'done' };
const PACE_KEY = 'signaldock:pace';

/**
 * 统一的轻提示入口（antd message / App context）。
 * - 加载中：只显示「功能名」加载中，一个可复用的 loading toast，不做「响应较慢/重试」之类的告警文案
 * - 页面隔离：只提示当前页面发起的请求；切页时立刻清掉上一页未完成的提示，
 *   并且旧请求后续到达的 slow/done 事件因作用域不匹配被忽略，不会在新页面再冒出来
 * - 错误：同一 key 覆盖，超时/服务连接错误的文本已由 api 层带上功能名称
 */
export function useApiNotice() {
  const { message } = AntApp.useApp();
  const messageRef = useRef(message);
  messageRef.current = message;

  useEffect(() => {
    const slow = new Set<string>();
    const render = () => {
      const instance = messageRef.current;
      const feature = slow.values().next().value as string | undefined;
      if (!feature) { instance.destroy(PACE_KEY); return; }
      instance.open({
        key: PACE_KEY,
        type: 'loading',
        duration: 0,
        content: `「${feature}」加载中…`
      });
    };
    const clear = () => {
      slow.clear();
      messageRef.current.destroy(PACE_KEY);
    };
    const handler = (event: Event) => {
      const { scope, feature, phase } = (event as CustomEvent<PaceDetail>).detail;
      // 事件由请求发起时所在的页面携带，切页后旧页面的残留事件一律忽略
      if ((scope ?? 'global') !== getPaceScope()) return;
      if (phase === 'done') slow.delete(feature);
      else slow.add(feature);
      render();
    };
    window.addEventListener('signaldock:request-pace', handler);
    window.addEventListener(PACE_SCOPE_EVENT, clear);
    return () => {
      window.removeEventListener('signaldock:request-pace', handler);
      window.removeEventListener(PACE_SCOPE_EVENT, clear);
      messageRef.current.destroy(PACE_KEY);
    };
  }, []);

  const error = useCallback((value: string) => {
    if (!value) return;
    messageRef.current.open({ key: 'signaldock:error', type: 'error', content: value, duration: 5 });
  }, []);
  const success = useCallback((value: string) => {
    messageRef.current.open({ key: 'signaldock:success', type: 'success', content: value, duration: 3 });
  }, []);
  const warning = useCallback((value: string) => {
    messageRef.current.open({ key: 'signaldock:warning', type: 'warning', content: value, duration: 4 });
  }, []);
  return { error, success, warning };
}
