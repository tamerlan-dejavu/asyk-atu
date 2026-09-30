import { computeAim, type AimResult } from '../input/AimController';
import { screenToGround, type CamParams } from './camera3d';

export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * Экранная точка → точка на земле в физических координатах (x, y).
 * Если луч не пересекает землю (выше горизонта) — возвращается последняя валидная точка,
 * т.е. оттягивание «зажимается», а не прыгает.
 */
export function pointerToWorld(cam: CamParams, sx: number, sy: number, last: WorldPoint | null): WorldPoint | null {
  const g = screenToGround(cam, sx, sy);
  if (!g) return last;
  return { x: g.x, y: g.z };
}

/**
 * Прицел в перспективе: вектор броска считается В МИРЕ (якорь − текущая точка на земле),
 * длина зажимается теми же MIN_PULL/MAX_PULL — та же функция computeAim, что и в 2D.
 * gain — экранный масштаб у линии броска: тот же жест в пикселях даёт ту же силу, что и в 2D
 * (в перспективе земля у камеры «растянута» примерно вдвое). Направление от gain не зависит.
 */
export function aimFromScreen(
  cam: CamParams,
  anchor: WorldPoint,
  sx: number,
  sy: number,
  last: WorldPoint | null,
  gain = 1,
): { aim: AimResult; current: WorldPoint } {
  const cur = pointerToWorld(cam, sx, sy, last) ?? anchor;
  return { aim: computeAim(anchor.x, anchor.y, anchor.x + (cur.x - anchor.x) * gain, anchor.y + (cur.y - anchor.y) * gain), current: cur };
}
