import { LOFT } from '../config';
import type { AsykType } from '../../types';

/**
 * Вертикальный канал «2,5D»: высота z (нижняя грань над землёй) и вертикальная скорость vz.
 * Чистые функции без Matter, Phaser и DOM; ими пользуются игра, бот и тесты.
 */
export interface VState {
  z: number;
  vz: number;
}

export type VKind = 'saka' | 'asyk';

export interface Landing {
  /** скорость удара о землю (положительная) */
  impact: number;
  /** множитель горизонтальной скорости после удара */
  hKeep: number;
  /** тело отскочило (а не легло) */
  bounced: boolean;
}

/** В воздухе ли тело (поднято или ещё летит вверх). */
export const airborne = (s: VState): boolean => s.z > LOFT.GROUND_EPS || s.vz > 0;

/**
 * Один фиксированный шаг по вертикали (до шага Matter): vz -= g, z += vz.
 * Возвращает удар о землю, если тело коснулось её на этом шаге, иначе null.
 */
export function integrate(s: VState, kind: VKind): Landing | null {
  // лежит на земле (после приземления без отскока vz ровно 0) — вертикаль неподвижна
  if (s.z <= 0 && s.vz === 0) return null;
  s.vz -= LOFT.GRAVITY_Z;
  s.z += s.vz;
  if (s.z > 0) return null;
  return land(s, kind);
}

/** Приземление: отскок с потерей энергии или остановка. */
export function land(s: VState, kind: VKind): Landing {
  const impact = Math.max(0, -s.vz);
  s.z = 0;
  const e = kind === 'saka' ? LOFT.E_GROUND_SAKA : LOFT.E_GROUND_ASYK;
  const keep = kind === 'saka' ? LOFT.H_KEEP_SAKA : LOFT.H_KEEP_ASYK;
  if (impact > LOFT.VZ_REST) {
    s.vz = impact * e;
    return { impact, hKeep: keep, bounced: true };
  }
  s.vz = 0;
  return { impact, hKeep: keep, bounced: false };
}

/** Пересекаются ли тела по высоте (с зазором MARGIN_Z). */
export function heightOverlap(za: number, ha: number, zb: number, hb: number): boolean {
  return za + LOFT.MARGIN_Z < zb + hb && zb + LOFT.MARGIN_Z < za + ha;
}

/** Толщина тела по его виду/типу. */
export function thickness(kind: 'saka' | 'asyk', type: AsykType): number {
  if (kind === 'saka') return LOFT.H.saka;
  return type === 'block' ? LOFT.H.block : LOFT.H.asyk;
}

/**
 * Подпрыгивание асыка от удара сақа: vz = min(POP_K·s, POP_MAX) при s > POP_MIN_SPEED.
 * Тяжёлый подпрыгивает ниже (×0.4), блок не подпрыгивает.
 */
export function popVz(relSpeed: number, type: AsykType): number {
  if (type === 'block' || relSpeed <= LOFT.POP_MIN_SPEED) return 0;
  const k = type === 'heavy' ? LOFT.POP_HEAVY : 1;
  return Math.min(LOFT.POP_K * relSpeed, LOFT.POP_MAX) * k;
}
