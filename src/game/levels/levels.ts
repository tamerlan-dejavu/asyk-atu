import { ZONE } from '../config';
import type { LevelDef } from '../../types';
import { cycleTypes, grid, ring, row, triangle, withType } from './layout';
import { PRO_LEVELS } from './levels-pro';

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
  // ---- Глава 2 «Дала»: новые типы тел ----
  {
    // Золотой асык защищён двумя обычными спереди
    id: 6,
    nameKey: 'level6',
    throws: 6,
    par: 4,
    zone,
    asyks: [
      { x: cx, y: cy - 24, angle: 0, type: 'golden' },
      { x: cx - 34, y: cy + 16, angle: 0 },
      { x: cx + 34, y: cy + 16, angle: 0 },
      { x: cx - 105, y: cy - 24, angle: 90 * D },
      { x: cx + 105, y: cy - 24, angle: 90 * D },
    ],
  },
  {
    // Тяжёлые в ряду, обычные вокруг
    id: 7,
    nameKey: 'level7',
    throws: 7,
    par: 5,
    zone,
    asyks: [
      ...withType(row(cx, cy, 3, 58, 90 * D), 'heavy'),
      { x: cx - 122, y: cy - 44, angle: 0 },
      { x: cx + 122, y: cy - 44, angle: 0 },
      { x: cx - 122, y: cy + 44, angle: 0 },
      { x: cx + 122, y: cy + 44, angle: 0 },
    ],
  },
  {
    // Ряд за каменным щитом — бить надо с угла
    id: 8,
    nameKey: 'level8',
    throws: 7,
    par: 5,
    zone,
    asyks: [
      ...row(cx, cy - 34, 4, 54, 0),
      { x: cx, y: cy + 14, angle: 0, type: 'block' },
      { x: cx - 122, y: cy + 22, angle: 0 },
      { x: cx + 122, y: cy + 22, angle: 0 },
    ],
  },
  {
    // Смесь всех типов: кольцо из золотых, обычных и тяжёлых, блоки внутри
    id: 9,
    nameKey: 'level9',
    throws: 8,
    par: 6,
    zone,
    asyks: [
      ...cycleTypes(ring(cx, cy, 6, 128), ['golden', 'normal', 'heavy']),
      { x: cx, y: cy, angle: 30 * D },
      ...[30, 150].map((deg) => ({
        x: cx + Math.cos(deg * D) * 70,
        y: cy + Math.sin(deg * D) * 70,
        angle: 0,
        type: 'block' as const,
      })),
    ],
  },
  {
    // Финал: плотный кластер с золотым в центре, блоки по краям
    id: 10,
    nameKey: 'level10',
    throws: 8,
    par: 6,
    zone,
    asyks: [
      { x: cx, y: cy, angle: 0, type: 'golden' },
      ...row(cx, cy - 32, 3, 54, 0),
      ...row(cx, cy + 32, 3, 54, 0),
      { x: cx - 54, y: cy, angle: 0 },
      { x: cx + 54, y: cy, angle: 0 },
      { x: cx - 134, y: cy - 34, angle: 0, type: 'block' },
      { x: cx + 134, y: cy - 34, angle: 0, type: 'block' },
      { x: cx - 134, y: cy + 40, angle: 0, type: 'block' },
      { x: cx + 134, y: cy + 40, angle: 0, type: 'block' },
    ],
  },
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
  const l = LEVELS.find((x) => x.id === id) ?? PRO_LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown level ${id}`);
  return l;
}

/** Следующий уровень кампании (после 10-го — дополнительная глава, если куплен «Той-Pro»). */
export function nextLevelId(id: number, pro: boolean): number | undefined {
  if (id >= 0 && id < 10) return id + 1;
  if (id >= 10 && id < 15 && pro) return id + 1;
  return undefined;
}
