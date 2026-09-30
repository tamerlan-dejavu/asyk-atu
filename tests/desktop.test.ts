import { describe, expect, it } from 'vitest';
import { layoutFor } from '../src/ui/layout';
import { adjustAim, computeAim, keyAim, KEY_ANGLE_STEP, KEY_POWER_STEP } from '../src/game/input/AimController';
import { MAX_AIM_ANGLE, MAX_PULL, MIN_PULL } from '../src/game/config';

const deg = (r: number) => (r * 180) / Math.PI;
const angleOf = (a: { dirX: number; dirY: number }) => Math.atan2(a.dirX, -a.dirY);

describe('раскладка по размеру окна', () => {
  it('телефон: портрет, узкое окно и телефон боком — без изменений', () => {
    expect(layoutFor(390, 844, true)).toBe('phone');
    expect(layoutFor(360, 740, true)).toBe('phone');
    expect(layoutFor(768, 1024, true)).toBe('phone'); // планшет-портрет
    expect(layoutFor(844, 390, true)).toBe('phone'); // телефон боком: «поверните устройство»
    expect(layoutFor(600, 400, false)).toBe('phone'); // ширина ≤ 600
    expect(layoutFor(1920, 1920, false)).toBe('phone'); // квадрат — не ландшафт
  });

  it('планшет и небольшое окно в ландшафте — компактно', () => {
    expect(layoutFor(900, 600, false)).toBe('compact');
    expect(layoutFor(1023, 700, true)).toBe('compact');
    expect(layoutFor(700, 530, true)).toBe('compact');
  });

  it('десктоп — ландшафт от 1024 px', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1440, 900],
      [1366, 768],
      [2560, 1440],
      [1024, 768],
    ])
      expect(layoutFor(w, h, false)).toBe('desktop');
  });
});

describe('точная подстройка прицела стрелками', () => {
  const base = computeAim(360, 900, 360, 900 + MIN_PULL + 60); // строго вверх, средняя сила

  it('без поправок прицел не меняется', () => {
    expect(adjustAim(base, 0, 0)).toBe(base);
  });

  it('угол — шаг 1°, сила — шаг 2 %', () => {
    const a = adjustAim(base, KEY_ANGLE_STEP * 3, KEY_POWER_STEP * 2);
    expect(deg(angleOf(a) - angleOf(base))).toBeCloseTo(3, 6);
    expect(a.power).toBeCloseTo(base.power + 0.04, 6);
    expect(a.valid).toBe(true);
    expect(a.pull).toBeCloseTo(MIN_PULL + a.power * (MAX_PULL - MIN_PULL), 6);
  });

  it('угол и сила не выходят за пределы', () => {
    const a = adjustAim(base, Math.PI, 5);
    expect(angleOf(a)).toBeCloseTo(MAX_AIM_ANGLE, 6);
    expect(a.power).toBe(1);
    const b = adjustAim(base, -Math.PI, -5);
    expect(angleOf(b)).toBeCloseTo(-MAX_AIM_ANGLE, 6);
    expect(b.power).toBe(0);
    expect(b.dirY).toBeLessThan(0); // бросок всегда «вперёд»
  });

  it('короткое оттягивание становится броском, если прибавить силы', () => {
    const short = computeAim(360, 900, 360, 905);
    expect(short.valid).toBe(false);
    expect(adjustAim(short, 0, KEY_POWER_STEP).valid).toBe(true);
    expect(adjustAim(short, KEY_ANGLE_STEP, 0).valid).toBe(false);
  });

  it('прицел только с клавиатуры', () => {
    const k = keyAim(10 * KEY_ANGLE_STEP, 0.5);
    expect(deg(angleOf(k))).toBeCloseTo(10, 6);
    expect(k.power).toBe(0.5);
    expect(k.valid).toBe(true);
    expect(keyAim(9, 9).power).toBe(1);
  });
});
