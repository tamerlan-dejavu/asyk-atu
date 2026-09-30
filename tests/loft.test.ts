import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error у встроенного Matter нет типов
import Matter from 'phaser/src/physics/matter-js/CustomMain.js';
import { FIELD_W, LOFT, POWER_MAX, POWER_MIN, SAKA_START, STEP_MS, ZONE } from '../src/game/config';
import { LEVELS } from '../src/game/levels/levels';
import { launchVelocity, LOFTS, predictLanding, simulateFlight, vMax, type Loft } from '../src/game/physics/ballistics';
import { Sim } from '../src/game/physics/sim';
import { heightOverlap, integrate, popVz } from '../src/game/physics/vertical';
import type { AsykSpec } from '../src/types';
import { LOFT_ANGLE_DEG } from '../src/game/config';

const zone = { ...ZONE };

function throwLoft(sim: Sim, power: number, loft: Loft, dirX = 0, dirY = -1) {
  const l = launchVelocity(power, loft, dirX, dirY);
  sim.launchSaka(l.vx, l.vy, Math.atan2(dirY, dirX), l.vz, LOFT.Z0);
}

/** Прогон до первого приземления сақа на пустом поле: где она коснулась земли. */
function firstLanding(power: number, loft: Loft) {
  const sim = new Sim(Matter, zone, { loft: true });
  throwLoft(sim, power, loft);
  for (let i = 0; i < 400; i++) {
    const r = sim.step();
    const l = r.landed.find((x) => x.id === 'saka');
    if (l) return { x: l.x, y: l.y };
  }
  throw new Error('no landing');
}

describe('баллистика', () => {
  it('при 100 % силы первое приземление — TARGET_RANGE (с точностью до одного шага)', () => {
    for (const loft of LOFTS) {
      const f = simulateFlight(vMax(loft), LOFT_ANGLE_DEG[loft]);
      // приземление фиксируется раз в шаг 1/60 с: дальность растёт ступеньками ≈ 25 px
      expect(Math.abs(f.range - LOFT.TARGET_RANGE)).toBeLessThan(30);
    }
  });

  it('предсказание приземления совпадает с симуляцией Matter (±2 %)', () => {
    for (const loft of LOFTS) {
      for (const p of [0.3, 0.6, 0.9]) {
        const want = predictLanding(p, loft, 0, -1, SAKA_START.x, SAKA_START.y);
        const got = firstLanding(p, loft);
        const range = SAKA_START.y - want.y;
        expect(Math.abs(got.y - want.y)).toBeLessThanOrEqual(0.02 * range);
        expect(Math.abs(got.x - want.x)).toBeLessThan(1);
      }
    }
  });

  it('дальность монотонно растёт с силой и примерно линейна (√p)', () => {
    for (const loft of LOFTS) {
      let prev = 0;
      for (let p = 0.1; p <= 1.0001; p += 0.1) {
        const r = SAKA_START.y - predictLanding(p, loft, 0, -1, SAKA_START.x, SAKA_START.y).y;
        expect(r).toBeGreaterThan(prev);
        prev = r;
      }
      const half = SAKA_START.y - predictLanding(0.5, loft, 0, -1, SAKA_START.x, SAKA_START.y).y;
      expect(half / LOFT.TARGET_RANGE).toBeGreaterThan(0.44);
      expect(half / LOFT.TARGET_RANGE).toBeLessThan(0.57);
    }
  });

  it('высота и время полёта в заданных пределах', () => {
    const high = simulateFlight(vMax('high'), LOFT_ANGLE_DEG.high);
    expect(high.apex).toBeGreaterThanOrEqual(70);
    expect(high.apex).toBeLessThanOrEqual(110);
    expect((high.steps * STEP_MS) / 1000).toBeGreaterThanOrEqual(0.7);
    expect((high.steps * STEP_MS) / 1000).toBeLessThanOrEqual(1.15); // полёт спокойнее: гравитация 0,28
    const low = simulateFlight(vMax('low'), LOFT_ANGLE_DEG.low);
    expect((low.steps * STEP_MS) / 1000).toBeGreaterThanOrEqual(0.3);
    expect((low.steps * STEP_MS) / 1000).toBeLessThanOrEqual(0.6);
  });
});

describe('вертикаль', () => {
  it('энергия не растёт: каждый подскок ниже прежнего, 1–4 подскока, конечная остановка', () => {
    const s = { z: 0, vz: 10 };
    const peaks: number[] = [];
    let peak = 0;
    let bounces = 0;
    for (let i = 0; i < 500; i++) {
      const l = integrate(s, 'saka');
      peak = Math.max(peak, s.z);
      expect(Number.isFinite(s.z) && Number.isFinite(s.vz)).toBe(true);
      if (l) {
        peaks.push(peak);
        peak = 0;
        if (l.bounced) bounces++;
        else break;
      }
    }
    expect(bounces).toBeGreaterThanOrEqual(1);
    expect(bounces).toBeLessThanOrEqual(4);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    expect(s.z).toBe(0);
    expect(s.vz).toBe(0);
  });

  it('повторный прогон даёт побитово те же позиции и высоты', () => {
    const run = () => {
      const sim = new Sim(Matter, zone, { loft: true });
      LEVELS[9].asyks.forEach((a, i) => sim.addAsyk(`a${i}`, a));
      throwLoft(sim, 0.75, 'mid', -0.05, -0.998);
      for (let i = 0; i < 2000 && !sim.settled; i++) sim.step();
      return sim.snapshot();
    };
    expect(run()).toEqual(run());
  });
});

describe('пересечение по высоте', () => {
  const block: AsykSpec = { x: SAKA_START.x, y: 700, angle: 0, type: 'block' };
  const asyk: AsykSpec = { x: SAKA_START.x, y: 700, angle: Math.PI / 2 };

  /** Сақа летит горизонтально на заданной высоте через препятствие (гравитация выключена «удержанием»). */
  function passOver(z: number, spec: AsykSpec): { hit: boolean; y: number } {
    const sim = new Sim(Matter, zone, { loft: true });
    sim.addAsyk('a0', spec);
    sim.launchSaka(0, -14, -Math.PI / 2, 0, z);
    let hit = false;
    for (let i = 0; i < 40; i++) {
      sim.saka!.z = z; // держим высоту — проверяем только фильтр
      sim.saka!.vz = 0;
      const r = sim.step();
      if (r.hits.some((h) => h.a === 'saka' || h.b === 'saka')) hit = true;
    }
    return { hit, y: sim.saka!.body.position.y };
  }

  it('на высоте 50 сақа пролетает над блоком, на высоте 10 — сталкивается', () => {
    expect(passOver(50, block).hit).toBe(false);
    expect(passOver(10, block).hit).toBe(true);
  });

  it('на высоте 20 проходит над асыком, но бьётся о блок', () => {
    expect(passOver(20, asyk).hit).toBe(false);
    expect(passOver(20, block).hit).toBe(true);
  });

  it('формула пересечения', () => {
    expect(heightOverlap(0, 20, 0, 16)).toBe(true);
    expect(heightOverlap(20, 20, 0, 16)).toBe(false);
    expect(heightOverlap(15, 20, 0, 16)).toBe(false); // зазор MARGIN_Z
    expect(heightOverlap(13, 20, 0, 16)).toBe(true);
  });

  it('спуск на асык вытесняет его без «взрыва» скорости', () => {
    const sim = new Sim(Matter, zone, { loft: true });
    sim.addAsyk('a0', { x: SAKA_START.x, y: 700, angle: 0 });
    sim.launchSaka(0, 0, 0, -3, 30);
    const s = sim.saka!;
    Matter.Body.setPosition(s.body, { x: SAKA_START.x + 6, y: 702 });
    let maxSpeed = 0;
    for (let i = 0; i < 120; i++) {
      sim.step();
      maxSpeed = Math.max(maxSpeed, Matter.Body.getSpeed(sim.bodies.get('a0')!.body));
    }
    expect(maxSpeed).toBeLessThan(20);
  });
});

describe('подпрыгивание асыков', () => {
  it('ограничено POP_MAX; тяжёлый ниже золотого; слабый удар не подбрасывает', () => {
    expect(popVz(100, 'golden')).toBe(LOFT.POP_MAX);
    expect(popVz(20, 'heavy')).toBeLessThan(popVz(20, 'golden'));
    expect(popVz(3, 'normal')).toBe(0);
    expect(popVz(20, 'block')).toBe(0);
  });

  it('сильный низкий бросок подбрасывает асык в воздух', () => {
    const sim = new Sim(Matter, zone, { loft: true });
    sim.addAsyk('a0', { x: SAKA_START.x, y: 600, angle: 0 });
    throwLoft(sim, 0.4, 'low'); // после смягчения броска (гравитация 0,28, дальность 800) удар «с земли» — на 0,4
    let maxZ = 0;
    for (let i = 0; i < 300 && !sim.settled; i++) {
      sim.step();
      const a = sim.bodies.get('a0');
      if (a && !a.removed) maxZ = Math.max(maxZ, a.z);
    }
    expect(maxZ).toBeGreaterThan(0);
  });
});

describe('перелёт', () => {
  it('сақа, вылетевшая за поле в воздухе, даёт перелёт, ход завершается', () => {
    const sim = new Sim(Matter, zone, { loft: true });
    LEVELS[1].asyks.forEach((a, i) => sim.addAsyk(`a${i}`, a));
    // высокий бросок вбок на полной силе — улетает за левую границу
    throwLoft(sim, 1, 'high', -0.9, -0.436);
    let over = false;
    for (let i = 0; i < 2000 && !sim.settled; i++) if (sim.step().overshoot) over = true;
    expect(over).toBe(true);
    expect(sim.overshoot).toBe(true);
    expect(sim.saka).toBeNull();
    expect(sim.settled).toBe(true);
  });

  it('асыки у стены не улетают за поле: стены для них остаются', () => {
    const sim = new Sim(Matter, zone, { loft: true });
    sim.addAsyk('a0', { x: 40, y: 500, angle: 0 });
    Matter.Body.setVelocity(sim.bodies.get('a0')!.body, { x: -25, y: 0 });
    sim.bodies.get('a0')!.vz = 5;
    sim.launchSaka(0, 0, 0, 0, 0);
    for (let i = 0; i < 300; i++) sim.step();
    const x = sim.bodies.get('a0')!.body.position.x;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(FIELD_W);
  });
});

describe('классика не изменилась', () => {
  it('эталонные броски дают побитово прежние результаты', () => {
    const golden = JSON.parse(readFileSync('tests/fixtures/classic-golden.json', 'utf8')) as {
      lvl: number;
      p: number;
      a: number;
      ticks: number;
      scored: string[];
      snap: unknown;
    }[];
    for (const g of golden) {
      const sim = new Sim(Matter, zone);
      LEVELS[g.lvl].asyks.forEach((s, i) => sim.addAsyk(`a${i}`, s));
      const v = POWER_MIN + (POWER_MAX - POWER_MIN) * g.p;
      const ang = (g.a * Math.PI) / 180;
      sim.launchSaka(Math.sin(ang) * v, -Math.cos(ang) * v);
      const scored: string[] = [];
      let n = 0;
      while (!sim.settled && n < 2000) {
        scored.push(...sim.step().newlyScored);
        n++;
      }
      expect({ ticks: n, scored, snap: sim.snapshot() }).toEqual({ ticks: g.ticks, scored: g.scored, snap: g.snap });
    }
  });
});

describe('производительность', () => {
  it('шаг симуляции с 12 телами в воздухе ≤ 1 мс (в среднем)', () => {
    const sim = new Sim(Matter, zone, { loft: true });
    for (let i = 0; i < 12; i++) {
      sim.addAsyk(`a${i}`, { x: 200 + (i % 4) * 90, y: 250 + Math.floor(i / 4) * 80, angle: 0 });
      sim.bodies.get(`a${i}`)!.vz = 6;
    }
    throwLoft(sim, 0.7, 'mid');
    for (let i = 0; i < 20; i++) sim.step(); // прогрев
    const t0 = performance.now();
    const N = 200;
    for (let i = 0; i < N; i++) sim.step();
    expect((performance.now() - t0) / N).toBeLessThan(1);
  });
});
