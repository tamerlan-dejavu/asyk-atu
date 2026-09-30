import { FIELD_H, FIELD_W, SAKA, SAKA_START, ZONE } from '../config';

/**
 * Математика перспективной камеры 3D-вида — без Three.js и WebGL (тестируется в Node).
 * ThreeView выставляет THREE.PerspectiveCamera ровно по этим параметрам, поэтому
 * проекция для прицела и отрисовка совпадают.
 *
 * Координаты: физический x → мировой X; физический y (вниз по экрану в 2D) → мировой Z (к камере);
 * высота → Y вверх. Масштаб 1:1 с физическими пикселями.
 * Экранные координаты — «логические» 720×1080, как у Phaser-canvas (FIT сохраняет пропорцию 2:3).
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface CamParams {
  pos: V3;
  target: V3;
  /** вертикальный угол обзора, градусы */
  fovDeg: number;
  /** ширина/высота вьюпорта (у игры всегда 2:3) */
  aspect: number;
}

export interface Projected {
  x: number;
  y: number;
  visible: boolean;
}

export const VIEW_W = FIELD_W;
export const VIEW_H = FIELD_H;
export const ASPECT = VIEW_W / VIEW_H;

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

interface Basis {
  f: V3;
  r: V3;
  u: V3;
  t: number; // tan(fov/2)
}

function basis(cam: CamParams): Basis {
  const f = norm(sub(cam.target, cam.pos));
  const r = norm(cross(f, { x: 0, y: 1, z: 0 }));
  const u = cross(r, f);
  return { f, r, u, t: Math.tan((cam.fovDeg * Math.PI) / 360) };
}

/** Мировая точка → логические экранные координаты (0…720, 0…1080). */
export function project(cam: CamParams, p: V3): Projected {
  const b = basis(cam);
  const d = sub(p, cam.pos);
  const zc = dot(d, b.f);
  if (zc <= 1e-6) return { x: 0, y: 0, visible: false };
  const nx = dot(d, b.r) / (zc * b.t * cam.aspect);
  const ny = dot(d, b.u) / (zc * b.t);
  const x = ((nx + 1) / 2) * VIEW_W;
  const y = ((1 - ny) / 2) * VIEW_H;
  return { x, y, visible: nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1 };
}

/** Логическая экранная точка → точка на земле (Y = 0) или null, если луч не пересекает землю. */
export function screenToGround(cam: CamParams, sx: number, sy: number): { x: number; z: number } | null {
  const b = basis(cam);
  const nx = (sx / VIEW_W) * 2 - 1;
  const ny = 1 - (sy / VIEW_H) * 2;
  const dir = norm({
    x: b.f.x + b.r.x * nx * b.t * cam.aspect + b.u.x * ny * b.t,
    y: b.f.y + b.r.y * nx * b.t * cam.aspect + b.u.y * ny * b.t,
    z: b.f.z + b.r.z * nx * b.t * cam.aspect + b.u.z * ny * b.t,
  });
  if (dir.y >= -1e-6) return null; // луч уходит выше горизонта
  const k = -cam.pos.y / dir.y;
  return { x: cam.pos.x + dir.x * k, z: cam.pos.z + dir.z * k };
}

/** Физика (x, y) и визуальная высота z → мировая точка. */
export const fromPhysics = (x: number, y: number, h = 0): V3 => ({ x, y: h, z: y });

/** Камера по «сферическим» параметрам: точка взгляда на земле, наклон вниз, расстояние. */
export function cameraAt(targetZ: number, pitchDeg: number, dist: number, fovDeg: number, aspect = ASPECT): CamParams {
  const a = (pitchDeg * Math.PI) / 180;
  const target = { x: ZONE.x, y: 0, z: targetZ };
  return {
    target,
    pos: { x: target.x, y: Math.sin(a) * dist, z: target.z + Math.cos(a) * dist },
    fovDeg,
    aspect,
  };
}

// ---------------------------------------------------------------- подбор камеры
/** Запас по бокам для кона (доля ширины). */
export const SIDE_MARGIN = 0.08;
/** Сақа не ближе этой доли высоты к нижнему краю. */
export const BOTTOM_MARGIN = 0.12;
/** Верх кона ниже HUD (доля высоты). */
export const TOP_RESERVED = 0.13;
/** Порог читаемости: ширина асыка в центре кона, CSS px при ширине вьюпорта 390. */
export const ASYK_MIN_CSS_PX = 26;
/** Тот же порог в логических единицах (720 логических = ширина вьюпорта). */
export const ASYK_MIN_LOGICAL = (ASYK_MIN_CSS_PX * VIEW_W) / 390;

export interface FitReport {
  ok: boolean;
  konLeft: number;
  konRight: number;
  konTop: number;
  sakaBottom: number;
  /** проецируемая ширина асыка в центре кона, логические единицы */
  asykWidth: number;
  /** то же для асыка на дальнем краю кона */
  asykFarWidth: number;
  /** экранных логических единиц на 1 мировую у сақа (для «ощущения» оттягивания) */
  sakaScale: number;
}

const RING = 36;

export function evaluate(cam: CamParams): FitReport {
  let konLeft = Infinity;
  let konRight = -Infinity;
  let konTop = Infinity;
  let visible = true;
  const r = ZONE.r + 26; // с запасом на асыки у края
  for (let i = 0; i < RING; i++) {
    const a = (i / RING) * Math.PI * 2;
    const p = project(cam, { x: ZONE.x + Math.cos(a) * r, y: 0, z: ZONE.y + Math.sin(a) * r });
    if (!p.visible) visible = false;
    konLeft = Math.min(konLeft, p.x);
    konRight = Math.max(konRight, p.x);
    konTop = Math.min(konTop, p.y);
  }
  let sakaBottom = -Infinity;
  for (const [dx, dz] of [
    [-SAKA.w / 2, SAKA.h / 2],
    [SAKA.w / 2, SAKA.h / 2],
    [0, SAKA.h / 2 + 8],
  ]) {
    const p = project(cam, { x: SAKA_START.x + dx, y: 0, z: SAKA_START.y + dz });
    if (!p.visible) visible = false;
    sakaBottom = Math.max(sakaBottom, p.y);
  }
  const w = (z: number) => {
    const a = project(cam, { x: ZONE.x - 22, y: 0, z });
    const b = project(cam, { x: ZONE.x + 22, y: 0, z });
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const asykWidth = w(ZONE.y);
  const asykFarWidth = w(ZONE.y - ZONE.r + 20);
  const s0 = project(cam, { x: SAKA_START.x, y: 0, z: SAKA_START.y });
  const s1 = project(cam, { x: SAKA_START.x + 50, y: 0, z: SAKA_START.y });
  const sakaScale = Math.hypot(s1.x - s0.x, s1.y - s0.y) / 50;
  const ok =
    visible &&
    konLeft >= SIDE_MARGIN * VIEW_W &&
    konRight <= (1 - SIDE_MARGIN) * VIEW_W &&
    konTop >= TOP_RESERVED * VIEW_H &&
    sakaBottom <= (1 - BOTTOM_MARGIN) * VIEW_H &&
    asykWidth >= ASYK_MIN_LOGICAL;
  return { ok, konLeft, konRight, konTop, sakaBottom, asykWidth, asykFarWidth, sakaScale };
}

export interface Fit {
  cam: CamParams;
  pitchDeg: number;
  dist: number;
  report: FitReport;
}

let cached: Fit | null = null;

/**
 * Подбор камеры: перебор наклона, FOV, точки взгляда и расстояния; из допустимых вариантов
 * выбирается тот, где кон крупнее, а наклон и FOV ближе к «естественным» 55° и 50°.
 * Пропорция поля всегда 2:3 (Phaser FIT), поэтому результат не зависит от размера экрана;
 * viewportW нужен только для пересчёта порога читаемости (см. ASYK_MIN_LOGICAL).
 */
export function fitCamera(viewportW = 390, viewportH = 585): Fit {
  void viewportW;
  void viewportH;
  if (cached) return cached;
  let best: { fit: Fit; score: number } | null = null;
  for (let pitch = 40; pitch <= 72; pitch += 2) {
    for (let fov = 34; fov <= 56; fov += 2) {
      for (let tz = 420; tz <= 700; tz += 20) {
        for (let dist = 700; dist <= 2000; dist += 25) {
          const cam = cameraAt(tz, pitch, dist, fov);
          const rep = evaluate(cam);
          if (!rep.ok) continue;
          const score = rep.asykWidth - 0.6 * Math.abs(pitch - 55) - 0.4 * Math.abs(fov - 50);
          if (!best || score > best.score) best = { fit: { cam, pitchDeg: pitch, dist, report: rep }, score };
        }
      }
    }
  }
  if (!best) {
    const cam = cameraAt(560, 55, 1300, 50);
    cached = { cam, pitchDeg: 55, dist: 1300, report: evaluate(cam) };
  } else cached = best.fit;
  return cached;
}
