import type { ReactNode } from 'react';

/**
 * 轻量 Markdown 渲染：只覆盖文章正文常用的写法（标题、列表、引用、代码、链接、加粗、斜体）。
 * 不引入第三方解析器，也不解析原始 HTML，避免 XSS；渲染结果直接是 React 节点。
 */
const safeUrl = (raw: string) => {
  const value = raw.trim();
  return /^(https?:\/\/|mailto:|\/)/i.test(value) ? value : '';
};

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

const inlineNodes = (text: string, keyPrefix: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;
    if (token.startsWith('**')) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = link ? safeUrl(link[2]) : '';
      nodes.push(href
        ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{link?.[1]}</a>
        : <span key={key}>{link?.[1] ?? token}</span>);
    } else nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    cursor = start + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
};

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'hr' }
  | { kind: 'paragraph'; lines: string[] };

const flushParagraph = (buffer: string[], blocks: Block[]) => {
  if (!buffer.length) return;
  blocks.push({ kind: 'paragraph', lines: [...buffer] });
  buffer.length = 0;
};

const parseBlocks = (source: string): Block[] => {
  const blocks: Block[] = [];
  const paragraph: string[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) { flushParagraph(paragraph, blocks); continue; }
    if (/^```/.test(trimmed)) {
      flushParagraph(paragraph, blocks);
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) { body.push(lines[index]); index += 1; }
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(paragraph, blocks);
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushParagraph(paragraph, blocks); blocks.push({ kind: 'hr' }); continue; }
    if (/^>\s?/.test(trimmed)) {
      flushParagraph(paragraph, blocks);
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) { quoted.push(lines[index].trim().replace(/^>\s?/, '')); index += 1; }
      index -= 1;
      blocks.push({ kind: 'quote', lines: quoted });
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flushParagraph(paragraph, blocks);
      const ordered = !bullet;
      const items: string[] = [];
      const pattern = ordered ? /^\d+[.)]\s+(.*)$/ : /^[-*+]\s+(.*)$/;
      while (index < lines.length) {
        const item = pattern.exec(lines[index].trim());
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      index -= 1;
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph(paragraph, blocks);
  return blocks;
};

export function MarkdownView({ text, empty = '还没有正文' }: { text: string; empty?: string }) {
  if (!text.trim()) return <p className="markdown-empty">{empty}</p>;
  const blocks = parseBlocks(text);
  return <div className="markdown-body">
    {blocks.map((block, index) => {
      const key = `b${index}`;
      if (block.kind === 'heading') {
        if (block.level <= 1) return <h1 key={key}>{inlineNodes(block.text, key)}</h1>;
        if (block.level === 2) return <h2 key={key}>{inlineNodes(block.text, key)}</h2>;
        if (block.level === 3) return <h3 key={key}>{inlineNodes(block.text, key)}</h3>;
        return <h4 key={key}>{inlineNodes(block.text, key)}</h4>;
      }
      if (block.kind === 'quote') return <blockquote key={key}>{block.lines.map((line, lineIndex) => <p key={`${key}-${lineIndex}`}>{inlineNodes(line, `${key}-${lineIndex}`)}</p>)}</blockquote>;
      if (block.kind === 'list') {
        const items = block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{inlineNodes(item, `${key}-${itemIndex}`)}</li>);
        return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
      }
      if (block.kind === 'code') return <pre key={key}><code>{block.text}</code></pre>;
      if (block.kind === 'hr') return <hr key={key} />;
      return <p key={key}>{inlineNodes(block.lines.join(' '), key)}</p>;
    })}
  </div>;
}
