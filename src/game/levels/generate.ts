import type { AsykSpec, AsykType, ZoneSpec } from '../../types';
import { asykGap, insideZone } from './layout';

export interface GenOptions {
  zone: ZoneSpec;
  /** число выбиваемых тел (asyk + golden + heavy) */
  count: number;
  golden?: number;
  heavy?: number;
  blocks?: number;
  /** минимальный зазор между телами, px */
  gap: number;
}

/**
 * Детерминированная случайная расстановка (rnd — mulberry32): положение и угол,
 * минимальный зазор, всё внутри кона. Одинакова для одинакового seed.
 */
export function generateLayout(rnd: () => number, o: GenOptions): AsykSpec[] {
  const types: AsykType[] = [];
  for (let i = 0; i < (o.golden ?? 0); i++) types.push('golden');
  for (let i = 0; i < (o.heavy ?? 0); i++) types.push('heavy');
  while (types.length < o.count) types.push('normal');
  for (let i = 0; i < (o.blocks ?? 0); i++) types.push('block');

  const out: AsykSpec[] = [];
  let gap = o.gap;
  let guard = 0;
  while (out.length < types.length && guard < 20000) {
    guard++;
    if (guard % 2500 === 0) gap = Math.max(2, gap - 2); // на очень тесных раскладках чуть ослабляем зазор
    const type = types[out.length];
    const reach = o.zone.r - (type === 'block' ? 34 : 40);
    const rr = Math.sqrt(rnd()) * reach;
    const th = rnd() * Math.PI * 2;
    const cand: AsykSpec = {
      x: o.zone.x + Math.cos(th) * rr,
      y: o.zone.y + Math.sin(th) * rr,
      angle: rnd() * Math.PI,
      type,
    };
    if (!insideZone(cand, o.zone, 6)) continue;
    if (out.some((a) => asykGap(a, cand) < gap)) continue;
    out.push(cand);
  }
  return out;
}
