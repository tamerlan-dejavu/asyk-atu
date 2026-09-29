import { ZONE } from '../config';
import type { LevelDef } from '../../types';
import { grid, ring, row, triangle } from './layout';

const { x: cx, y: cy } = ZONE;
const zone = { ...ZONE };
const D = Math.PI / 180;

/**
 * Испытания. Данные, а не код: расстановки собраны из чистых функций layout.ts
 * (детерминированно, без Math.random). Проверяются тестом tests/levels.test.ts.
 */
export const LEVELS: LevelDef[] = [
  { id: 0, nameKey: 'level0', throws: Infinity, par: null, zone, asyks: row(cx, cy, 3, 64, 0) },
  { id: 1, nameKey: 'level1', throws: 6, par: 4, zone, asyks: row(cx, cy, 5, 56, 0) },
  { id: 2, nameKey: 'level2', throws: 6, par: 4, zone, asyks: triangle(cx, cy, 3, 50, 30, 0) },
  { id: 3, nameKey: 'level3', throws: 7, par: 5, zone, asyks: grid(cx, cy, 4, 2, 52, 32, 0) },
  { id: 4, nameKey: 'level4', throws: 7, par: 5, zone, asyks: ring(cx, cy, 8, 115) },
  // Разброс: шесть асыков у края кона (далеко друг от друга) и один в центре
  { id: 5, nameKey: 'level5', throws: 7, par: 6, zone, asyks: [...ring(cx, cy, 6, 152), { x: cx, y: cy, angle: 30 * D }] },
];

/** Расстановка режима «вдвоём»: кольцо и три асыка в центре. */
export const VERSUS_LEVEL: LevelDef = {
  id: 100,
  nameKey: 'versus',
  throws: 12,
  par: null,
  zone,
  asyks: [...ring(cx, cy, 8, 135), ...row(cx, cy, 3, 50, 90 * D)],
};

export function getLevel(id: number): LevelDef {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown level ${id}`);
  return l;
}
