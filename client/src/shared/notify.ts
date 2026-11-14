import { useCallback, useEffect, useRef } from 'react';
import { App as AntApp } from 'antd';

type PaceDetail = { feature: string; phase: 'slow' | 'retry' | 'done' };

/**
 * 统一的轻提示入口（antd message / App context）。
 * - 慢连接：一个可复用的 loading toast，不因为多个接口同时慢而刷屏
 * - 错误：同一 key 覆盖，超时/服务连接错误的文本已由 api 层带上功能名称
 */
export function useApiNotice() {
  const { message } = AntApp.useApp();
  const messageRef = useRef(message);
  messageRef.current = message;

  useEffect(() => {
    const slow = new Set<string>();
    const render = (retrying: boolean) => {
      const instance = messageRef.current;
      const feature = slow.values().next().value as string | undefined;
      if (!feature) { instance.destroy('signaldock:pace'); return; }
      instance.open({
        key: 'signaldock:pace',
        type: 'loading',
        duration: 0,
        content: retrying ? `「${feature}」连接较慢，正在自动重试…` : `「${feature}」响应较慢，请稍候…`
      });
    };
    const handler = (event: Event) => {
      const { feature, phase } = (event as CustomEvent<PaceDetail>).detail;
      if (phase === 'done') slow.delete(feature);
      else slow.add(feature);
      render(phase === 'retry');
    };
    window.addEventListener('signaldock:request-pace', handler);
    return () => {
      window.removeEventListener('signaldock:request-pace', handler);
      messageRef.current.destroy('signaldock:pace');
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
