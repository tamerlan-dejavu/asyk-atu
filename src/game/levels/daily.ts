import { DAILY_THROWS, ZONE } from '../config';
import type { AsykSpec, LevelDef } from '../../types';
import { asykGap, insideZone } from './layout';
import { hashString, mulberry32 } from './rng';

/** Локальная дата YYYY-MM-DD. */
export function dateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const MIN_GAP = 6;

/** Ежедневное испытание: 6 асыков, положение/угол из mulberry32(дата). Одинаково на всех устройствах. */
export function dailyLevel(key: string = dateKey()): LevelDef {
  const rnd = mulberry32(hashString(`asyk-atu:${key}`));
  const zone = { ...ZONE };
  const asyks: AsykSpec[] = [];
  let guard = 0;
  while (asyks.length < 6 && guard++ < 5000) {
    const rr = Math.sqrt(rnd()) * (zone.r - 40);
    const th = rnd() * Math.PI * 2;
    const cand: AsykSpec = { x: zone.x + Math.cos(th) * rr, y: zone.y + Math.sin(th) * rr, angle: rnd() * Math.PI };
    if (!insideZone(cand, zone, 6)) continue;
    if (asyks.some((a) => asykGap(a, cand) < MIN_GAP)) continue;
    asyks.push(cand);
  }
  return { id: 200, nameKey: 'daily', throws: DAILY_THROWS, par: null, zone, asyks };
}
