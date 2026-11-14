import { analysisCallStore } from '../../db/client.js';
import { buildArticle, type ArticleMaterial } from './article-writer.js';
import { briefStore } from './brief.store.js';

/** 正在写稿的文章 id：同一篇不并发写两次，重复点击直接沿用第一轮。 */
const running = new Set<string>();

export const isWriting = (id: string) => running.has(id);

/**
 * 后台写稿：接口先把带 writing 标记的文章返回给页面，正文写完再落库。
 * 模型出一篇稿子要一两分钟，放在请求里等会把 nginx 和前端的超时都撞上。
 */
export const startWriting = (id: string, materials: ArticleMaterial[], label: string) => {
  if (!materials.length || running.has(id)) return;
  running.add(id);
  void (async () => {
    const startedAt = Date.now();
    let content = '';
    let provider: 'ai' | 'fallback' = 'fallback';
    let digest = '';
    let title = '';
    let note = '';
    try {
      const article = await buildArticle(materials, label);
      content = article.content;
      provider = article.provider;
      digest = article.digest ?? '';
      title = article.title;
      // AI 稿偏短时 buildArticle 会带回一句说明，直接转给页面
      if (provider !== 'ai') note = '模型这次没写成，下面是本地整理稿，发之前补两句自己的判断';
      else note = article.note ?? '';
      analysisCallStore.record({ provider: `article-${provider}`, status: 'success', attempts: 1, durationMs: Date.now() - startedAt });
    } catch (error) {
      note = `写稿失败：${error instanceof Error ? error.message : '未知错误'}，可以再点一次「按素材重写」`;
      analysisCallStore.record({ provider: 'article-job', status: 'failure', attempts: 1, durationMs: Date.now() - startedAt, error: note });
    }
    const current = briefStore.find(id);
    if (!current) { running.delete(id); return; }
    const { id: _id, version, createdAt: _createdAt, updatedAt: _updatedAt, ...document } = current;
    // 写稿期间用户可能改了标题或删了文章：只在还活着时落库，并保留用户已有的标题
    briefStore.update(id, version, {
      ...document,
      ...(content ? { content, provider, digest: digest || undefined } : {}),
      ...(title && /^未命名草稿$/.test(current.title) ? { title } : {}),
      writing: false,
      writeNote: note || undefined
    });
    running.delete(id);
  })();
};
