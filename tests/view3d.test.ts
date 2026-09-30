import { describe, expect, it } from 'vitest';
import { AIM_ZONE_Y, MAX_PULL, SAKA_START, ZONE } from '../src/game/config';
import { computeAim } from '../src/game/input/AimController';
import {
  ASYK_MIN_LOGICAL,
  BOTTOM_MARGIN,
  fitCamera,
  project,
  screenToGround,
  SIDE_MARGIN,
  TOP_RESERVED,
  VIEW_H,
  VIEW_W,
} from '../src/game/view3d/camera3d';
import { aimFromScreen } from '../src/game/view3d/aim3d';

/** Размер игрового контейнера 2:3 на экране (как в CSS #stage). */
const stage = (vw: number, vh: number) => {
  const w = Math.min(vw, (vh * 2) / 3);
  return { w, h: (w * 3) / 2 };
};

describe('fitCamera', () => {
  for (const [vw, vh] of [
    [390, 844],
    [360, 800],
    [768, 1024],
    [1440, 900],
  ]) {
    it(`${vw}×${vh}: кон виден с запасом, сақа видна, асык читаем`, () => {
      const s = stage(vw, vh);
      const { report: r } = fitCamera(s.w, s.h);
      expect(r.ok).toBe(true);
      expect(r.konLeft).toBeGreaterThanOrEqual(SIDE_MARGIN * VIEW_W);
      expect(r.konRight).toBeLessThanOrEqual((1 - SIDE_MARGIN) * VIEW_W);
      expect(r.konTop).toBeGreaterThanOrEqual(TOP_RESERVED * VIEW_H);
      expect(r.sakaBottom).toBeLessThanOrEqual((1 - BOTTOM_MARGIN) * VIEW_H);
      // ширина асыка в CSS px на этом экране ≥ 26 · (ширина / 390)
      const cssPx = (r.asykWidth * s.w) / VIEW_W;
      expect(cssPx).toBeGreaterThanOrEqual((26 * s.w) / 390 - 1e-9);
      expect(r.asykWidth).toBeGreaterThanOrEqual(ASYK_MIN_LOGICAL);
    });
  }

  it('сақа на линии броска попадает в зону начала прицеливания', () => {
    const { cam } = fitCamera();
    const p = project(cam, { x: SAKA_START.x, y: 0, z: SAKA_START.y });
    expect(p.y).toBeGreaterThan(AIM_ZONE_Y);
  });
});

describe('проекция', () => {
  it('screenToWorld(project(p)) = p в 20 точках поля (±0.5)', () => {
    const { cam } = fitCamera();
    for (let i = 0; i < 20; i++) {
      const x = 40 + ((i * 97) % 640);
      const z = 120 + ((i * 173) % 880);
      const s = project(cam, { x, y: 0, z });
      const g = screenToGround(cam, s.x, s.y)!;
      expect(g).not.toBeNull();
      expect(Math.abs(g.x - x)).toBeLessThan(0.5);
      expect(Math.abs(g.z - z)).toBeLessThan(0.5);
    }
  });

  it('луч выше горизонта не пересекает землю', () => {
    const { cam } = fitCamera();
    expect(screenToGround(cam, 360, -50_000)).toBeNull();
  });
});

describe('прицел в перспективе', () => {
  const { cam } = fitCamera();
  const anchor = { x: SAKA_START.x, y: SAKA_START.y - 30 };
  const toScreen = (x: number, y: number) => project(cam, { x, y: 0, z: y });

  it('жест даёт тот же вектор, что и оттягивание в мире (допуск 3 %)', () => {
    const pulls = [
      [0, 60],
      [0, 150],
      [40, 100],
      [-70, 90],
      [20, 30],
      [-10, 200],
    ];
    for (const [dx, dy] of pulls) {
      const want = computeAim(anchor.x, anchor.y, anchor.x + dx, anchor.y + dy);
      const s = toScreen(anchor.x + dx, anchor.y + dy);
      const { aim } = aimFromScreen(cam, anchor, s.x, s.y, null);
      expect(Math.abs(aim.power - want.power)).toBeLessThanOrEqual(0.03 * Math.max(1, want.power) + 1e-9);
      expect(Math.abs(Math.atan2(aim.dirX, -aim.dirY) - Math.atan2(want.dirX, -want.dirY))).toBeLessThan(0.03);
      expect(aim.valid).toBe(want.valid);
    }
  });

  it('оттягивание «к себе» (вниз по экрану) — бросок вперёд, к кону', () => {
    const a = toScreen(anchor.x, anchor.y);
    const { aim } = aimFromScreen(cam, anchor, a.x, a.y + 120, null);
    expect(aim.dirY).toBeLessThan(-0.95);
    // направление на кон: сақа → центр кона — вверх по физике
    expect(ZONE.y).toBeLessThan(SAKA_START.y);
  });

  it('длина зажимается; жест выше горизонта даёт последнее валидное значение', () => {
    const far = toScreen(anchor.x, anchor.y + MAX_PULL * 3);
    const { aim } = aimFromScreen(cam, anchor, far.x, far.y, null);
    expect(aim.power).toBe(1);
    const last = { x: anchor.x, y: anchor.y + 100 };
    const r = aimFromScreen(cam, anchor, 360, -50_000, last);
    expect(r.current).toEqual(last);
    expect(r.aim.power).toBeCloseTo(computeAim(anchor.x, anchor.y, last.x, last.y).power, 9);
  });
});
