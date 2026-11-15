import { useCallback, useEffect, useRef } from 'react';
import { App as AntApp } from 'antd';
import { getPaceScope, PACE_SCOPE_EVENT } from './api';

type PaceDetail = { scope?: string; feature: string; phase: 'slow' | 'retry' | 'done' };
const PACE_KEY = 'signaldock:pace';

/**
 * 全局「加载中」提示，整个应用只挂这一次。
 * - 只由主视图（信息流 / 收藏夹 / 文章）的请求在等了 4 秒以上时触发，
 *   设置页、来源清单、写稿轮询这些后台请求不会弹提示，页面自己的加载态已经够用
 * - 文案点名正在等的是哪个功能，而不是泛泛一句「加载中」
 * - 切页时清掉上一页的提示，旧请求后续事件因作用域不匹配被忽略
 */
export function usePaceNotice() {
  const { message } = AntApp.useApp();
  const messageRef = useRef(message);
  messageRef.current = message;

  useEffect(() => {
    const waiting = new Set<string>();
    const render = () => {
      const instance = messageRef.current;
      const names = [...waiting];
      if (!names.length) { instance.destroy(PACE_KEY); return; }
      const label = names.length > 1 ? `「${names[0]}」等 ${names.length} 项` : `「${names[0]}」`;
      instance.open({
        key: PACE_KEY,
        type: 'loading',
        duration: 0,
        content: (
          <span className="pace-notice">
            <strong>正在加载{label}…</strong>
            <small>网络较慢，仍在等待响应，请稍候</small>
          </span>
        )
      });
    };
    const clear = () => {
      waiting.clear();
      messageRef.current.destroy(PACE_KEY);
    };
    const handler = (event: Event) => {
      const { scope, feature, phase } = (event as CustomEvent<PaceDetail>).detail;
      // 事件由请求发起时所在的页面携带，切页后旧页面的残留事件一律忽略
      if ((scope ?? 'global') !== getPaceScope()) return;
      if (phase === 'done') waiting.delete(feature);
      else waiting.add(feature);
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
}

/**
 * 页面内的轻提示入口（antd message / App context）。
 * 只管结果类提示；加载提示统一由 usePaceNotice 负责，避免每个页面各挂一份监听、重复弹同一条。
 */
export function useApiNotice() {
  const { message } = AntApp.useApp();
  const messageRef = useRef(message);
  messageRef.current = message;

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
