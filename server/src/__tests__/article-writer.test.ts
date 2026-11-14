import { describe, expect, it } from 'vitest';
import { cleanArticleTitle, composeArticle, parseAiArticle, takeSentences, type ArticleMaterial } from '../modules/briefs/article-writer.js';

const material = (overrides: Partial<ArticleMaterial>): ArticleMaterial => ({
  id: 'm1', title: '标题', sourceName: '测试来源', url: 'https://example.com/a',
  summary: '', content: '', topics: [], importance: 0.5, collectedAt: '2026-11-14T00:00:00.000Z',
  ...overrides
});

describe('自动写稿', () => {
  it('去掉站点尾巴与「阅读原文」这类模板句', () => {
    expect(cleanArticleTitle('Qwen3.8 量化版发布 - 量子位')).toBe('Qwen3.8 量化版发布');
    expect(cleanArticleTitle('How we run it locally | Hacker News')).toBe('How we run it locally');
    expect(cleanArticleTitle('标题 - 某个不是站点的名字')).toBe('标题 - 某个不是站点的名字');
  });

  it('按句号截断，不把半句话写进稿子', () => {
    expect(takeSentences('第一句说完了。第二句还没说完', 1)).toBe('第一句说完了。');
  });

  it('选一条做头条展开，同事件的其余句子收进关键信息，不写「共 N 条」这类采集统计', () => {
    const article = composeArticle([
      material({ id: '1', title: 'Qwen3.8 量化版发布 - 量子位', summary: '官方放出 4bit 版本，显存降到 18GB。推理速度提升 1.8 倍。', topics: ['大模型上新'] }),
      material({ id: '2', title: 'Qwen3.8 放出 4bit 量化版，显存降到 18GB', sourceName: 'IT之家', summary: 'IT之家转述同一件事：官方放出 4bit 量化版本，推理速度提升 1.8 倍。', topics: ['大模型上新'] }),
      material({ id: '3', title: '长上下文服务实测', sourceName: 'arXiv', url: 'https://example.com/b', summary: '我们实测了四种栈。', content: '分页注意力在 128K 上下文下把峰值内存降低 31%。', topics: ['本地部署'], importance: 0.9 })
    ], '大模型上新');

    expect(article.content).toContain('## 关键信息');
    expect(article.content).toContain('## 来源');
    expect(article.content).not.toContain('这一轮');
    expect(article.content).not.toMatch(/共 \d+ 条素材/);
    // 同一条素材的标题只出现一次，不再「关键信息 + 逐条展开」各写一遍
    expect(article.content.split('Qwen3.8 量化版发布').length).toBeLessThan(4);
    expect(article.title).not.toMatch(/条进展|及相关进展/);
    // 没有原句支撑的数字不该凭空出现
    expect(article.content).not.toMatch(/待补充|TODO|占位内容/);
  });

  it('只有标题没有摘要时说明要回原文补，不编内容', () => {
    const article = composeArticle([material({ title: '只有标题的一条线索', summary: '', content: '' })], '测试');
    expect(article.content).toContain('只有标题');
    expect(article.content).toContain('## 来源');
  });

  it('摘要和正文是同一段话时不重复写两遍', () => {
    const text = 'OpenAI 上线钱包功能，允许 Agent 代用户下单。首批只对美国 Pro 用户开放。';
    const article = composeArticle([material({ title: 'OpenAI 上线 Agent 钱包', summary: text, content: text })], '大模型上新');
    expect(article.content.match(/OpenAI 上线钱包功能/g)).toHaveLength(1);
  });

  it('去掉日期电头、中文标点两侧的空格与站点模板句', () => {
    const article = composeArticle([material({
      title: '某公司发布新模型',
      sourceName: 'IT之家',
      summary: 'IT之家 11 月 14 日消息，该公司今天发布新模型 ， 参数量翻倍。The post 某公司发布新模型 appeared first on IT之家.'
    })], '大模型上新');
    expect(article.content).toContain('据 IT之家 报道，该公司今天发布新模型，参数量翻倍。');
    expect(article.content).not.toContain('11 月 14 日消息');
    expect(article.content).not.toContain('appeared first on');
  });

  it('中文标题优先做头条，英文标题只进相关动态', () => {
    const article = composeArticle([
      material({ id: 'en', title: 'LangChain hits $3B valuation', sourceName: 'TechCrunch', summary: 'LangChain raised a $300 million Series C at a $3 billion valuation.', importance: 0.9 }),
      material({ id: 'cn', title: 'LangChain 估值涨到 30 亿美元', sourceName: 'IT之家', summary: 'LangChain 完成 3 亿美元 C 轮融资，估值 30 亿美元。', importance: 0.5 })
    ], '大模型上新');
    expect(article.title).toBe('LangChain 估值涨到 30 亿美元');
  });

  it('拒绝大模型返回的占位内容与无结构正文', () => {
    expect(() => parseAiArticle(JSON.stringify({ title: '正常标题', content: '没有小节的正文'.repeat(40) }))).toThrow();
    expect(() => parseAiArticle(JSON.stringify({ title: '正常标题', content: '## 小节\n\n待补充'.repeat(20) }))).toThrow();
    expect(parseAiArticle(JSON.stringify({ title: '一个具体的标题', content: '## 发生了什么\n\n' + '这是一段完整的正文描述。'.repeat(25) })).title).toBe('一个具体的标题');
  });
});
