import { describe, expect, it } from 'vitest';
// @ts-expect-error у встроенного Matter нет типов
import Matter from 'phaser/src/physics/matter-js/CustomMain.js';
import { POWER_MAX, POWER_MIN, TURN_TIMEOUT_MS, ZONE, STEP_MS } from '../src/game/config';
import { Sim } from '../src/game/physics/sim';
import { LEVELS } from '../src/game/levels/levels';
import { DepthTracker } from '../src/game/render/depth';
import { ScoreKeeper } from '../src/game/rules/scoring';

interface Opts {
  level: number;
  power: number;
  angleDeg: number;
  /** имитация слоя рендера: z-высота, тени и т.д. — не должны менять физику */
  withRender: boolean;
}

function playThrow({ level, power, angleDeg, withRender }: Opts) {
  const sim = new Sim(Matter, ZONE);
  LEVELS[level].asyks.forEach((a, i) => sim.addAsyk(`a${i}`, a));
  const v = POWER_MIN + (POWER_MAX - POWER_MIN) * power;
  const a = (angleDeg * Math.PI) / 180;
  sim.launchSaka(Math.sin(a) * v, -Math.cos(a) * v);
  const depth = new DepthTracker();
  const keeper = new ScoreKeeper();
  let points = 0;
  let n = 0;
  while (!sim.settled && n < 2000) {
    const r = sim.step();
    if (withRender) {
      for (const h of r.hits) {
        depth.onHit(h.a, h.impulse, n * STEP_MS);
        depth.onHit(h.b, h.impulse, n * STEP_MS);
      }
      for (const b of sim.bodies.values()) depth.z(b.id, n * STEP_MS);
    }
    points += keeper.registerThrow(r.newlyScored).points;
    n++;
  }
  return { snap: sim.snapshot(), points, ticks: n, timedOut: sim.timedOut };
}

describe('физика', () => {
  it('детерминизм: один и тот же бросок даёт одинаковый результат', () => {
    const a = playThrow({ level: 3, power: 0.9, angleDeg: -6, withRender: false });
    const b = playThrow({ level: 3, power: 0.9, angleDeg: -6, withRender: false });
    expect(b.snap).toEqual(a.snap);
    expect(b.ticks).toBe(a.ticks);
  });

  it('render-isolation: эффекты (quality high/low) не влияют на финальные позиции тел', () => {
    for (const [level, power, angle] of [
      [1, 1, 0],
      [3, 0.9, -6],
      [4, 1, -9],
      [5, 0.8, 12],
    ] as const) {
      const high = playThrow({ level, power, angleDeg: angle, withRender: true });
      const low = playThrow({ level, power, angleDeg: angle, withRender: false });
      expect(high.snap).toEqual(low.snap);
      expect(high.points).toBe(low.points);
    }
  });

  it('слабый бросок не доходит до кона, сильный — чуть дальше дальнего края', () => {
    const farEdge = ZONE.y - ZONE.r;
    const nearEdge = ZONE.y + ZONE.r;
    const stop = (p: number) => {
      const sim = new Sim(Matter, ZONE);
      const v = POWER_MIN + (POWER_MAX - POWER_MIN) * p;
      sim.launchSaka(0, -v);
      for (let i = 0; i < 2000 && !sim.settled; i++) sim.step();
      return sim.saka!.body.position.y;
    };
    expect(stop(0)).toBeGreaterThan(nearEdge);
    const full = stop(1);
    expect(full).toBeLessThan(farEdge);
    expect(full).toBeGreaterThan(farEdge - 120);
  });

  it('ход завершается: остановка или тайм-аут 7 с', () => {
    const r = playThrow({ level: 3, power: 1, angleDeg: 0, withRender: false });
    expect(r.ticks * STEP_MS).toBeLessThanOrEqual(TURN_TIMEOUT_MS + STEP_MS);
  });

  it('очки за бросок считаются по выбитым асыкам', () => {
    const r = playThrow({ level: 1, power: 1, angleDeg: 0, withRender: false });
    expect([0, 10, 25, 40, 55]).toContain(r.points);
  });

  it('z-высота: подпрыгивание только выше порога и возврат за ~200 мс', () => {
    const d = new DepthTracker();
    d.onHit('a', 0.1, 0);
    expect(d.z('a', 50)).toBe(0);
    d.onHit('a', 8, 0);
    const mid = d.z('a', 100);
    expect(mid).toBeGreaterThanOrEqual(6);
    expect(mid).toBeLessThanOrEqual(10);
    expect(d.z('a', 250)).toBe(0);
  });
});
