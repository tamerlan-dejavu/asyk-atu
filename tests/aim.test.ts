import { describe, expect, it } from 'vitest';
import { computeAim } from '../src/game/input/AimController';
import { MAX_PULL, MIN_PULL } from '../src/game/config';

describe('computeAim', () => {
  it('короткое оттягивание — отмена', () => {
    expect(computeAim(100, 800, 100, 800 + MIN_PULL - 1).valid).toBe(false);
    expect(computeAim(100, 800, 100, 800).valid).toBe(false);
  });

  it('вернуть на якорь — бросок отменяется', () => {
    expect(computeAim(300, 800, 300, 800).valid).toBe(false);
  });

  it('сила нормализуется 0…1 между MIN_PULL и MAX_PULL', () => {
    expect(computeAim(0, 0, 0, MIN_PULL).power).toBe(0);
    expect(computeAim(0, 0, 0, MAX_PULL).power).toBe(1);
    expect(computeAim(0, 0, 0, MAX_PULL * 3).power).toBe(1);
    const mid = computeAim(0, 0, 0, (MIN_PULL + MAX_PULL) / 2).power;
    expect(mid).toBeCloseTo(0.5, 5);
  });

  it('направление противоположно оттягиванию', () => {
    const a = computeAim(300, 800, 300, 900); // тянем вниз → бросок вверх
    expect(a.dirX).toBeCloseTo(0, 5);
    expect(a.dirY).toBeCloseTo(-1, 5);
    const b = computeAim(300, 800, 250, 900); // тянем вниз-влево → бросок вверх-вправо
    expect(b.dirX).toBeGreaterThan(0);
    expect(b.dirY).toBeLessThan(0);
  });

  it('бросить «назад» нельзя: угол ограничен', () => {
    const a = computeAim(300, 800, 300, 700); // тянем вверх → нельзя бросить вниз
    expect(a.dirY).toBeLessThan(0);
    expect(Math.hypot(a.dirX, a.dirY)).toBeCloseTo(1, 5);
  });
});
