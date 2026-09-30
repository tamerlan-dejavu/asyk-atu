import { ASYK, BLOCK, FIELD_H, FIELD_W, HEAVY, SAKA, WALL_RESTITUTION } from '../config';
import type { AsykType } from '../../types';

// Matter.js не имеет типов в сборке Phaser — работаем через минимальный any.

export type MatterNS = any;

export type MBody = any;

/** Вытянутый шестиугольник («косточка») размером w×h. */
export function bonePolygon(w: number, h: number): { x: number; y: number }[] {
  const hw = w / 2;
  const hh = h / 2;
  const cut = w * 0.25; // насколько срезаны торцы
  return [
    { x: -hw, y: 0 },
    { x: -hw + cut, y: -hh },
    { x: hw - cut, y: -hh },
    { x: hw, y: 0 },
    { x: hw - cut, y: hh },
    { x: -hw + cut, y: hh },
  ];
}

export function createAsykBody(M: MatterNS, label: string, x: number, y: number, angle: number, type: AsykType = 'normal'): MBody {
  if (type === 'block') {
    return M.Bodies.rectangle(x, y, BLOCK.size, BLOCK.size, {
      label,
      angle,
      isStatic: true,
      restitution: BLOCK.restitution,
      friction: 0.3,
      chamfer: { radius: BLOCK.radius },
    });
  }
  const heavy = type === 'heavy';
  return M.Bodies.fromVertices(
    x,
    y,
    [bonePolygon(ASYK.w, ASYK.h)],
    {
      label,
      angle,
      density: ASYK.density * (heavy ? HEAVY.densityMul : 1),
      friction: ASYK.friction,
      restitution: ASYK.restitution,
      frictionAir: ASYK.frictionAir * (heavy ? HEAVY.frictionAirMul : 1),
      frictionStatic: 0.5,
      sleepThreshold: Infinity,
    },
    true,
  );
}

export function createSakaBody(M: MatterNS, label: string, x: number, y: number, angle: number): MBody {
  return M.Bodies.fromVertices(
    x,
    y,
    [bonePolygon(SAKA.w, SAKA.h)],
    {
      label,
      angle,
      density: SAKA.density,
      friction: SAKA.friction,
      restitution: SAKA.restitution,
      frictionAir: SAKA.frictionAir,
      frictionStatic: 0.5,
      sleepThreshold: Infinity,
    },
    true,
  );
}

/** Невидимые статические стены по краям поля (с небольшим отскоком). */
export function createWalls(M: MatterNS): MBody[] {
  const t = 200; // толщина, чтобы ничто не «пролетело»
  const opts = { isStatic: true, restitution: WALL_RESTITUTION, friction: 0.2, label: 'wall' };
  return [
    M.Bodies.rectangle(FIELD_W / 2, -t / 2, FIELD_W + 2 * t, t, opts),
    M.Bodies.rectangle(FIELD_W / 2, FIELD_H + t / 2, FIELD_W + 2 * t, t, opts),
    M.Bodies.rectangle(-t / 2, FIELD_H / 2, t, FIELD_H + 2 * t, opts),
    M.Bodies.rectangle(FIELD_W + t / 2, FIELD_H / 2, t, FIELD_H + 2 * t, opts),
  ];
}
