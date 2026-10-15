import { createHash } from 'node:crypto';
import type { SearchResult } from './collection.types.js';

export const stripHtml = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
export const cleanText = (value: string | undefined | null) => stripHtml(value ?? '');
export const normalizeUrl = (value: string | undefined | null) => {
  const raw = cleanText(value);
  if (!raw) return '';
  try { const url = new URL(raw); url.hash = ''; return url.toString(); } catch { return raw; }
};

export const fingerprintFor = (input: Pick<SearchResult, 'source' | 'title' | 'content' | 'url'>) => createHash('sha256').update([input.source, normalizeUrl(input.url), cleanText(input.title), cleanText(input.content)].join('\n')).digest('hex');

export const normalizeResult = (input: Omit<SearchResult, 'collectedAt' | 'fingerprint'>): SearchResult => {
  const result = { ...input, title: cleanText(input.title), summary: cleanText(input.summary), content: cleanText(input.content), url: normalizeUrl(input.url), publishedAt: input.publishedAt ? new Date(input.publishedAt).toISOString() : null, collectedAt: new Date().toISOString() };
  return { ...result, fingerprint: fingerprintFor(result) };
};
