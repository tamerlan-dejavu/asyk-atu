import type { Lang } from '../types';
import { en } from './en';
import { kk } from './kk';
import { ru, type Dict } from './ru';

export type Key = keyof Dict;

const dicts: Record<Lang, Dict> = { ru, kk, en };
let current: Lang = 'ru';
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'kk' ? 'kk' : l;
  listeners.forEach((fn) => fn());
}

export function onLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Перевод строки по ключу; {param} подставляются из params. Отсутствующий ключ → русский. */
export function t(key: Key, params?: Record<string, string | number>): string {
  const raw = dicts[current][key] ?? ru[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, p: string) => (p in params ? String(params[p]) : `{${p}}`));
}
