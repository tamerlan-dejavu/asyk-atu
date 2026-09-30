import { BLOCK, ZONE } from '../game/config';
import { asykGap, insideZone } from '../game/levels/layout';
import type { AsykSpec, AsykType, LevelDef } from '../types';

/** Версия кода; ссылка начинается с «1.». */
export const CODE_PREFIX = '1.';
export const MAX_NAME = 24;
export const MIN_THROWS = 3;
export const MAX_THROWS = 10;
export const MAX_ASYKS = 12;
export const MAX_BLOCKS = 6;
export const MIN_GAP = 4;
export const MAX_CODE_LENGTH = 400;

export interface Challenge {
  name: string;
  throws: number;
  par: number;
  asyks: AsykSpec[];
}

export type DecodeError = 'format' | 'version' | 'checksum' | 'range' | 'invalid';
export type DecodeResult = { ok: true; challenge: Challenge } | { ok: false; error: DecodeError };

const TYPES: AsykType[] = ['normal', 'golden', 'heavy', 'block'];
const X0 = ZONE.x - ZONE.r - 8;
const Y0 = ZONE.y - ZONE.r - 8;
const ANGLE_STEPS = 64; // 6 бит на угол, тела симметричны на 180°

/** Приводит объект к «сетке кодека»: целые x/y и угол, кратный π/64 (то, что делится ссылкой, — то и играется). */
export function quantize(a: AsykSpec): AsykSpec {
  const x = Math.round(a.x);
  const y = Math.round(a.y);
  const turn = ((a.angle % Math.PI) + Math.PI) % Math.PI;
  const step = Math.round((turn / Math.PI) * ANGLE_STEPS) % ANGLE_STEPS;
  return { x, y, angle: (step * Math.PI) / ANGLE_STEPS, type: a.type ?? 'normal' };
}

export function cleanName(s: string, max = MAX_NAME): string {
  // убираем управляющие, невидимые и разметочные символы; вывод в DOM — только через textContent
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e<>]/g, '')
    .trim()
    .slice(0, max);
}

export interface LayoutIssues {
  /** индексы объектов с проблемами (подсветка красным) */
  bad: Set<number>;
  tooMany: boolean;
  tooFew: boolean;
  tooManyBlocks: boolean;
  ok: boolean;
}

/** Проверка расстановки: внутри кона, зазор ≥ 4 px, 1…12 выбиваемых, ≤ 6 блоков. */
export function validateLayout(asyks: AsykSpec[]): LayoutIssues {
  const bad = new Set<number>();
  const zone = { ...ZONE };
  asyks.forEach((a, i) => {
    if (!insideZone(a, zone, 0)) bad.add(i);
  });
  for (let i = 0; i < asyks.length; i++) {
    for (let j = i + 1; j < asyks.length; j++) {
      if (asykGap(asyks[i], asyks[j]) < MIN_GAP) {
        bad.add(i);
        bad.add(j);
      }
    }
  }
  const blocks = asyks.filter((a) => a.type === 'block').length;
  const real = asyks.length - blocks;
  const tooMany = real > MAX_ASYKS;
  const tooFew = real < 1;
  const tooManyBlocks = blocks > MAX_BLOCKS;
  return { bad, tooMany, tooFew, tooManyBlocks, ok: bad.size === 0 && !tooMany && !tooFew && !tooManyBlocks };
}

/** Число выбиваемых тел и `par` по умолчанию: min(throws − 1, ceil(n · 0.75)). */
export function defaultPar(throws: number, asykCount: number): number {
  return Math.max(1, Math.min(throws - 1, Math.ceil(asykCount * 0.75)));
}

// ---- битовая упаковка ----
class BitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private n = 0;
  write(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >> i) & 1);
      if (++this.n === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.n = 0;
      }
    }
  }
  finish(): number[] {
    if (this.n > 0) this.bytes.push(this.cur << (8 - this.n));
    return this.bytes;
  }
}

class BitReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const byte = this.bytes[this.pos >> 3];
      if (byte === undefined) throw new Error('eof');
      v = (v << 1) | ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
}

function b64urlEncode(bytes: number[]): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('alphabet');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const checksum = (bytes: ArrayLike<number>, len: number): number => {
  let s = 0xa5;
  for (let i = 0; i < len; i++) s = (s + bytes[i] * (i + 1)) & 255;
  return s;
};

/** Кодирует испытание в компактную строку. Значения приводятся к допустимым диапазонам. */
export function encodeChallenge(c: Challenge): string {
  const throws = Math.min(MAX_THROWS, Math.max(MIN_THROWS, Math.round(c.throws)));
  const par = Math.min(throws, Math.max(1, Math.round(c.par)));
  const asyks = c.asyks.slice(0, MAX_ASYKS + MAX_BLOCKS).map(quantize);
  const nameBytes = Array.from(new TextEncoder().encode(cleanName(c.name)));
  const w = new BitWriter();
  w.write(throws, 4);
  w.write(par, 4);
  w.write(asyks.length, 5);
  w.write(0, 3);
  w.write(nameBytes.length, 8);
  for (const b of nameBytes) w.write(b, 8);
  for (const a of asyks) {
    w.write(Math.min(1023, Math.max(0, a.x - X0)), 10);
    w.write(Math.min(1023, Math.max(0, a.y - Y0)), 10);
    w.write(Math.round((a.angle / Math.PI) * ANGLE_STEPS) % ANGLE_STEPS, 6);
    w.write(Math.max(0, TYPES.indexOf(a.type ?? 'normal')), 2);
  }
  const bytes = w.finish();
  bytes.push(checksum(bytes, bytes.length));
  return CODE_PREFIX + b64urlEncode(bytes);
}

/** Строгий разбор: любые отклонения → { ok: false }. Значения не «исправляются», а проверяются. */
export function decodeChallenge(code: string): DecodeResult {
  try {
    if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH) return { ok: false, error: 'format' };
    if (!code.startsWith(CODE_PREFIX)) return { ok: false, error: /^\d+\./.test(code) ? 'version' : 'format' };
    const bytes = b64urlDecode(code.slice(CODE_PREFIX.length));
    if (bytes.length < 4) return { ok: false, error: 'format' };
    if (checksum(bytes, bytes.length - 1) !== bytes[bytes.length - 1]) return { ok: false, error: 'checksum' };
    const r = new BitReader(bytes.subarray(0, bytes.length - 1));
    const throws = r.read(4);
    const par = r.read(4);
    const count = r.read(5);
    r.read(3);
    const nameLen = r.read(8);
    if (throws < MIN_THROWS || throws > MAX_THROWS || par < 1 || par > throws) return { ok: false, error: 'range' };
    if (count < 1 || count > MAX_ASYKS + MAX_BLOCKS || nameLen > MAX_NAME * 4) return { ok: false, error: 'range' };
    const nb = new Uint8Array(nameLen);
    for (let i = 0; i < nameLen; i++) nb[i] = r.read(8);
    const name = cleanName(new TextDecoder('utf-8', { fatal: false }).decode(nb));
    const asyks: AsykSpec[] = [];
    for (let i = 0; i < count; i++) {
      const x = r.read(10) + X0;
      const y = r.read(10) + Y0;
      const step = r.read(6);
      const type = TYPES[r.read(2)];
      asyks.push({ x, y, angle: (step * Math.PI) / ANGLE_STEPS, type });
    }
    if (!validateLayout(asyks).ok) return { ok: false, error: 'invalid' };
    return { ok: true, challenge: { name, throws, par, asyks } };
  } catch {
    return { ok: false, error: 'format' };
  }
}

/** Испытание → определение уровня для игры. */
export function challengeToLevel(c: Challenge, id = 300): LevelDef {
  return {
    id,
    nameKey: 'custom',
    name: c.name,
    throws: c.throws,
    par: c.par,
    zone: { ...ZONE },
    asyks: c.asyks.map((a) => ({ ...a })),
  };
}

export const BLOCK_SIZE = BLOCK.size;
