import { describe, expect, it } from 'vitest';
// @ts-expect-error у встроенного Matter нет типов
import Matter from 'phaser/src/physics/matter-js/CustomMain.js';
import { ZONE } from '../src/game/config';
import { applyNoise, candidateShots, chooseShot, simulateShot } from '../src/game/bot';
import { LEVELS } from '../src/game/levels/levels';
import { mulberry32 } from '../src/game/levels/rng';
import type { AsykSpec, BotLevel } from '../src/types';

const zone = { ...ZONE };

describe('бот', () => {
  it('на пустом поле возвращает корректный бросок', async () => {
    const r = await chooseShot(Matter, zone, [], 'normal', mulberry32(1));
    expect(r.shot.power).toBeGreaterThan(0);
    expect(r.shot.power).toBeLessThanOrEqual(1);
    expect(Math.hypot(r.shot.dirX, r.shot.dirY)).toBeCloseTo(1, 5);
    expect(r.shot.dirY).toBeLessThan(0);
  });

  it('на одиночном асыке «Сильный» выбивает его', async () => {
    const specs: AsykSpec[] = [{ x: 360, y: 350, angle: 0 }];
    const r = await chooseShot(Matter, zone, specs, 'hard', mulberry32(2));
    expect(r.predicted).toBe(10);
    const real = simulateShot(Matter, zone, specs, r.shot);
    expect(real.points).toBeGreaterThanOrEqual(0);
  });

  it('число кандидатов ≈ 96, направления «вперёд»', () => {
    const c = candidateShots(LEVELS[3].asyks);
    expect(c.length).toBe(96);
    for (const s of c) expect(s.dirY).toBeLessThan(0);
  });

  it('детерминизм headless-симуляции: тот же бросок → тот же результат', () => {
    const shot = { power: 0.9, dirX: -0.05, dirY: -0.9987 };
    const a = simulateShot(Matter, zone, LEVELS[4].asyks, shot);
    const b = simulateShot(Matter, zone, LEVELS[4].asyks, shot);
    expect(b).toEqual(a);
  });

  it('ошибка исполнения растёт с ослаблением сложности', () => {
    const shot = { power: 0.8, dirX: 0, dirY: -1 };
    const spread = (lvl: BotLevel) => {
      const rnd = mulberry32(9);
      let s = 0;
      for (let i = 0; i < 200; i++) s += Math.abs(applyNoise(shot, lvl, rnd).dirX);
      return s / 200;
    };
    expect(spread('easy')).toBeGreaterThan(spread('normal'));
    expect(spread('normal')).toBeGreaterThan(spread('hard'));
  });

  it('баланс: «Сильный» в среднем выбивает больше «Лёгкого» (реальные броски)', async () => {
    const levels = [1, 2, 3, 4, 5];
    const total = async (lvl: BotLevel) => {
      let sum = 0;
      for (const l of levels) {
        for (let seed = 0; seed < 3; seed++) {
          const specs = LEVELS[l].asyks;
          const { shot } = await chooseShot(Matter, zone, specs, lvl, mulberry32(seed * 31 + l), { yieldEveryMs: 1e9 });
          sum += simulateShot(Matter, zone, specs, shot).points;
        }
      }
      return sum;
    };
    const hard = await total('hard');
    const easy = await total('easy');
    expect(hard).toBeGreaterThan(easy);
  }, 120000);
});
