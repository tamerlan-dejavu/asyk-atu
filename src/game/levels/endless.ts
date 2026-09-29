import { ZONE } from '../config';
import type { LevelDef } from '../../types';
import { generateLayout } from './generate';
import { hashString, mulberry32 } from './rng';

export const ENDLESS_RESERVE_MAX = 8;
export const ENDLESS_RESERVE_STEP = 2;

/** Число выбиваемых тел в волне n: min(3 + n, 10). */
export function waveCount(wave: number): number {
  return Math.min(3 + wave, 10);
}

/** Броски в волне: ceil(асыков · 1.2) плюс накопленный запас. */
export function waveThrows(wave: number, reserve: number): number {
  return Math.ceil(waveCount(wave) * 1.2) + reserve;
}

/** Запас бросков после очищенной волны: +2 к оставшимся, но не больше 8. */
export function nextReserve(leftover: number): number {
  return Math.min(ENDLESS_RESERVE_MAX, Math.max(0, leftover) + ENDLESS_RESERVE_STEP);
}

/**
 * Волна бесконечного режима. Детерминирована: seed = hash(runSeed, wave).
 * Золотые с волны 3, тяжёлые с волны 5, блоки с волны 7; зазор с волной уменьшается до минимума.
 */
export function endlessWave(runSeed: number, wave: number, reserve = 0): LevelDef {
  const rnd = mulberry32(hashString(`endless:${runSeed}:${wave}`));
  const zone = { ...ZONE };
  const count = waveCount(wave);
  const golden = wave >= 3 ? 1 + (wave >= 9 ? 1 : 0) : 0;
  const heavy = wave >= 5 ? 1 + (wave >= 8 ? 1 : 0) : 0;
  const blocks = wave >= 7 ? Math.min(3, 1 + Math.floor((wave - 7) / 2)) : 0;
  const gap = Math.max(4, 24 - wave * 2);
  return {
    id: 400 + wave,
    nameKey: 'endless',
    throws: waveThrows(wave, reserve),
    par: null,
    zone,
    asyks: generateLayout(rnd, { zone, count, golden, heavy, blocks, gap }),
  };
}
