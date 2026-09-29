import { isDateKey } from '../game/levels/daily';
import { cleanName, MAX_CODE_LENGTH } from './codec';

export type LinkKind =
  | { kind: 'c'; code: string; score?: number; name?: string }
  | { kind: 'd'; date: string; score?: number; name?: string }
  | { kind: 'e'; seed: number; score?: number; name?: string; wave?: number };

const MAX_SCORE = 99999;

function parseScore(v: string | null): number | undefined {
  if (v === null || !/^\d{1,5}$/.test(v)) return undefined;
  const n = Number(v);
  return n <= MAX_SCORE ? n : undefined;
}

function parseName(v: string | null): string | undefined {
  if (v === null) return undefined;
  const n = cleanName(v, 16);
  return n || undefined;
}

/** Разбор хэша страницы (#c=… | #d=… | #e=…). Мусор → null. Значения не исполняются как разметка. */
export function parseHash(hash: string): LinkKind | null {
  try {
    const h = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!h || h.length > MAX_CODE_LENGTH + 120) return null;
    const p = new URLSearchParams(h);
    const score = parseScore(p.get('s'));
    const name = parseName(p.get('n'));
    const c = p.get('c');
    if (c !== null) return c.length <= MAX_CODE_LENGTH ? { kind: 'c', code: c, score, name } : null;
    const d = p.get('d');
    if (d !== null) return isDateKey(d) ? { kind: 'd', date: d, score, name } : null;
    const e = p.get('e');
    if (e !== null && /^\d{1,10}$/.test(e)) {
      const w = p.get('w');
      return { kind: 'e', seed: Number(e) >>> 0, score, name, wave: w && /^\d{1,3}$/.test(w) ? Number(w) : undefined };
    }
    return null;
  } catch {
    return null;
  }
}

export function buildLink(base: string, link: LinkKind): string {
  const p = new URLSearchParams();
  if (link.kind === 'c') p.set('c', link.code);
  else if (link.kind === 'd') p.set('d', link.date);
  else {
    p.set('e', String(link.seed));
    if (link.wave) p.set('w', String(link.wave));
  }
  if (link.score !== undefined) p.set('s', String(Math.min(MAX_SCORE, Math.max(0, Math.round(link.score)))));
  if (link.name) p.set('n', cleanName(link.name, 16));
  return `${base}#${p.toString()}`;
}
