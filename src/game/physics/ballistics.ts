import { LOFT, LOFT_ANGLE_DEG, SUBSTEPS } from '../config';
import { integrate, type VState } from './vertical';

export type Loft = keyof typeof LOFT_ANGLE_DEG;
export const LOFTS: Loft[] = ['low', 'mid', 'high'];

export interface LaunchVelocity {
  /** горизонтальная скорость, px/шаг (как у Matter.Body.setVelocity) */
  vx: number;
  vy: number;
  /** вертикальная скорость, px/шаг */
  vz: number;
}

export interface Flight {
  /** горизонтальная дальность первого приземления от точки броска */
  range: number;
  /** дальность второго приземления (после первого отскока) или null */
  range2: number | null;
  /** шагов до первого приземления */
  steps: number;
  /** максимальная высота нижней грани */
  apex: number;
}

/**
 * Полёт без столкновений — ровно та же дискретная модель, что в игре:
 * до шага Matter — вертикальный шаг (vertical.integrate), затем SUBSTEPS подшагов Matter,
 * в каждом горизонтальная скорость умножается на (1 − k/SUBSTEPS) и тело смещается на неё.
 */
export function simulateFlight(v: number, thetaDeg: number): Flight {
  const th = (thetaDeg * Math.PI) / 180;
  const s: VState = { z: LOFT.Z0, vz: v * Math.sin(th) };
  let disp = (v * Math.cos(th)) / SUBSTEPS; // смещение за подшаг
  let dist = 0;
  let apex = s.z;
  let range = -1;
  let steps = 0;
  for (let step = 1; step < 2000; step++) {
    const landed = integrate(s, 'saka');
    apex = Math.max(apex, s.z);
    if (landed) {
      if (range >= 0) return { range, range2: dist, steps, apex }; // второе приземление
      range = dist;
      steps = step;
      if (!landed.bounced) return { range, range2: null, steps, apex };
      disp *= landed.hKeep;
    }
    const k = s.z > LOFT.GROUND_EPS || s.vz > 0 ? LOFT.AIR_DRAG_FLIGHT : 0;
    for (let i = 0; i < SUBSTEPS; i++) {
      disp *= 1 - k / SUBSTEPS;
      dist += disp;
    }
  }
  return { range: range >= 0 ? range : dist, range2: null, steps: steps || 2000, apex };
}

const vmaxCache = new Map<Loft, number>();

/** Скорость броска при 100 % силы: первое приземление ровно на TARGET_RANGE (подбор бинарным поиском). */
export function vMax(loft: Loft): number {
  const hit = vmaxCache.get(loft);
  if (hit) return hit;
  let lo = 1;
  let hi = 80;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (simulateFlight(mid, LOFT_ANGLE_DEG[loft]).range < LOFT.TARGET_RANGE) lo = mid;
    else hi = mid;
  }
  const v = (lo + hi) / 2;
  vmaxCache.set(loft, v);
  return v;
}

/** Модуль скорости: V = V_MAX·√p — дальность приземления растёт примерно линейно с силой. */
export function launchSpeed(power: number, loft: Loft): number {
  return vMax(loft) * Math.sqrt(Math.max(LOFT.MIN_POWER, Math.min(1, power)));
}

/** Скорость запуска сақа для силы, высоты и направления (единичный вектор на плоскости). */
export function launchVelocity(power: number, loft: Loft, dirX: number, dirY: number): LaunchVelocity {
  const v = launchSpeed(power, loft);
  const th = (LOFT_ANGLE_DEG[loft] * Math.PI) / 180;
  const vh = v * Math.cos(th);
  return { vx: dirX * vh, vy: dirY * vh, vz: v * Math.sin(th) };
}

export interface LandingPoint {
  x: number;
  y: number;
  /** точка второго приземления (после первого подскока), если он будет */
  bounce: { x: number; y: number } | null;
}

/** Предсказание приземления без учёта столкновений (для маркера на земле). */
export function predictLanding(power: number, loft: Loft, dirX: number, dirY: number, ox: number, oy: number): LandingPoint {
  const f = simulateFlight(launchSpeed(power, loft), LOFT_ANGLE_DEG[loft]);
  return {
    x: ox + dirX * f.range,
    y: oy + dirY * f.range,
    bounce: f.range2 === null ? null : { x: ox + dirX * f.range2, y: oy + dirY * f.range2 },
  };
}
