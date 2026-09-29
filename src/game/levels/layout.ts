import { ASYK, BLOCK } from '../config';
import type { AsykSpec, AsykType, ZoneSpec } from '../../types';

const HALF_W = ASYK.w / 2;
const HALF_H = ASYK.h / 2;

function half(a: AsykSpec): [number, number] {
  return a.type === 'block' ? [BLOCK.size / 2, BLOCK.size / 2] : [HALF_W, HALF_H];
}

interface Vec {
  x: number;
  y: number;
}

function corners(a: AsykSpec): Vec[] {
  const c = Math.cos(a.angle);
  const s = Math.sin(a.angle);
  const [hw, hh] = half(a);
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([px, py]) => ({ x: a.x + px * c - py * s, y: a.y + px * s + py * c }));
}

function project(pts: Vec[], ax: Vec): [number, number] {
  let mn = Infinity;
  let mx = -Infinity;
  for (const p of pts) {
    const d = p.x * ax.x + p.y * ax.y;
    if (d < mn) mn = d;
    if (d > mx) mx = d;
  }
  return [mn, mx];
}

/** Зазор (px) между двумя асыками по SAT (прямоугольная аппроксимация); < 0 — пересекаются. */
export function asykGap(a: AsykSpec, b: AsykSpec): number {
  const ca = corners(a);
  const cb = corners(b);
  let best = -Infinity;
  for (const ang of [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2]) {
    const ax = { x: Math.cos(ang), y: Math.sin(ang) };
    const [a0, a1] = project(ca, ax);
    const [b0, b1] = project(cb, ax);
    const gap = Math.max(b0 - a1, a0 - b1);
    if (gap > best) best = gap;
  }
  return best;
}

/** Асык целиком внутри кона (с запасом margin). */
export function insideZone(a: AsykSpec, zone: ZoneSpec, margin = 0): boolean {
  return corners(a).every((p) => Math.hypot(p.x - zone.x, p.y - zone.y) <= zone.r - margin);
}

export function row(cx: number, cy: number, n: number, spacing: number, angle: number): AsykSpec[] {
  const out: AsykSpec[] = [];
  for (let i = 0; i < n; i++) out.push({ x: cx + (i - (n - 1) / 2) * spacing, y: cy, angle });
  return out;
}

/** Плотный треугольник: ряды n, n-1, …, 1 (широкий ряд дальше от игрока). */
export function triangle(cx: number, cy: number, rows: number, dx: number, dy: number, angle: number): AsykSpec[] {
  const out: AsykSpec[] = [];
  for (let r = 0; r < rows; r++) {
    const n = rows - r;
    for (let i = 0; i < n; i++) {
      out.push({ x: cx + (i - (n - 1) / 2) * dx, y: cy + (r - (rows - 1) / 2) * dy, angle });
    }
  }
  return out;
}

export function grid(
  cx: number,
  cy: number,
  cols: number,
  rows: number,
  dx: number,
  dy: number,
  angle: number,
): AsykSpec[] {
  const out: AsykSpec[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: cx + (c - (cols - 1) / 2) * dx, y: cy + (r - (rows - 1) / 2) * dy, angle });
    }
  }
  return out;
}

/** Кольцо: асыки по окружности, длинной осью по касательной. */
export function ring(cx: number, cy: number, n: number, radius: number, startAngle = -Math.PI / 2): AsykSpec[] {
  const out: AsykSpec[] = [];
  for (let i = 0; i < n; i++) {
    const th = startAngle + (i * 2 * Math.PI) / n;
    out.push({ x: cx + Math.cos(th) * radius, y: cy + Math.sin(th) * radius, angle: th + Math.PI / 2 });
  }
  return out;
}

/** Задаёт тип всем телам списка. */
export function withType(list: AsykSpec[], type: AsykType): AsykSpec[] {
  return list.map((a) => ({ ...a, type }));
}

/** Назначает типы по кругу из списка. */
export function cycleTypes(list: AsykSpec[], types: AsykType[]): AsykSpec[] {
  return list.map((a, i) => ({ ...a, type: types[i % types.length] }));
}
