import { DAILY_THROWS, ZONE } from '../config';
import type { LevelDef } from '../../types';
import { generateLayout } from './generate';
import { hashString, mulberry32 } from './rng';

/** Локальная дата YYYY-MM-DD. */
export function dateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Проверка формата ключа даты (для ссылок-вызовов). */
export function isDateKey(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Ежедневное испытание: 6 асыков, положение/угол из mulberry32(дата). Одинаково на всех устройствах. */
export function dailyLevel(key: string = dateKey()): LevelDef {
  const rnd = mulberry32(hashString(`asyk-atu:${key}`));
  const zone = { ...ZONE };
  return {
    id: 200,
    nameKey: 'daily',
    throws: DAILY_THROWS,
    par: null,
    zone,
    asyks: generateLayout(rnd, { zone, count: 6, gap: 6 }),
  };
}
