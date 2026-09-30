import type { AsykType } from '../../types';

/** Состояние тела для отрисовки (только чтение из физики). */
export interface BodySnapshot {
  id: string;
  kind: 'asyk' | 'saka';
  type: AsykType;
  x: number;
  y: number;
  angle: number;
  /** визуальная высота подпрыгивания (только визуал) */
  z: number;
  /** 1 — видно полностью; меньше — исчезает (выбит / сақа гаснет) */
  alpha: number;
}

export interface MeshTransform {
  px: number;
  py: number;
  pz: number;
  rotY: number;
  scale: number;
}

/**
 * Физика → трансформ 3D-меша. Чистая функция: мировой X = x, Z = y, высота Y = z подпрыгивания;
 * вращение вокруг вертикали = −angle (у Three.js поворот по Y против часовой, в 2D — по часовой).
 * Исчезновение выбитого асыка — уменьшением и подъёмом (материалы общие, прозрачность на тело не меняем).
 */
export function meshTransform(b: BodySnapshot): MeshTransform {
  const fade = Math.max(0, Math.min(1, b.alpha));
  return {
    px: b.x,
    py: b.z + (1 - fade) * 24,
    pz: b.y,
    rotY: -b.angle,
    scale: 0.35 + 0.65 * fade,
  };
}
