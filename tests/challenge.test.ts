import { describe, expect, it } from 'vitest';
import {
  challengeToLevel,
  CODE_PREFIX,
  decodeChallenge,
  defaultPar,
  encodeChallenge,
  MAX_CODE_LENGTH,
  quantize,
  validateLayout,
  type Challenge,
} from '../src/challenge/codec';
import { buildLink, parseHash } from '../src/challenge/link';
import { generateLayout } from '../src/game/levels/generate';
import { mulberry32 } from '../src/game/levels/rng';
import { ZONE } from '../src/game/config';
import { endlessWave, nextReserve, waveCount, waveThrows } from '../src/game/levels/endless';

function randomChallenge(seed: number, blocks = 2): Challenge {
  const rnd = mulberry32(seed);
  const asyks = generateLayout(rnd, { zone: { ...ZONE }, count: 5 + Math.floor(rnd() * 6), golden: 1, heavy: 1, blocks, gap: 6 }).map(quantize);
  return { name: 'Той-сынақ ' + seed, throws: 3 + Math.floor(rnd() * 8), par: 2, asyks };
}

describe('кодек ссылки-вызова', () => {
  it('round-trip на случайных расстановках', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const c = randomChallenge(seed);
      const code = encodeChallenge(c);
      expect(code.startsWith(CODE_PREFIX)).toBe(true);
      expect(code.length).toBeLessThanOrEqual(400);
      const back = decodeChallenge(code);
      expect(back.ok).toBe(true);
      if (!back.ok) continue;
      expect(back.challenge.name).toBe(c.name);
      expect(back.challenge.throws).toBe(c.throws);
      expect(back.challenge.par).toBe(Math.min(c.par, c.throws));
      expect(back.challenge.asyks).toHaveLength(c.asyks.length);
      back.challenge.asyks.forEach((a, i) => {
        expect(a.x).toBe(c.asyks[i].x);
        expect(a.y).toBe(c.asyks[i].y);
        expect(a.type).toBe(c.asyks[i].type);
        expect(a.angle).toBeCloseTo(c.asyks[i].angle, 9);
      });
    }
  });

  it('отказ на некорректных входах', () => {
    const good = encodeChallenge(randomChallenge(7));
    const bad = [
      '',
      'abc',
      '2.' + good.slice(2), // чужая версия
      '1.',
      '1.!!!',
      good.slice(0, -3), // обрезан
      good.slice(0, 10) + (good[10] === 'A' ? 'B' : 'A') + good.slice(11), // испорчен
      '1.' + 'A'.repeat(500),
    ];
    for (const b of bad) expect(decodeChallenge(b).ok).toBe(false);
    expect(decodeChallenge('2.' + good.slice(2))).toEqual({ ok: false, error: 'version' });
  });

  it('декодер не принимает пересекающиеся тела (защита физики)', () => {
    const c = randomChallenge(3);
    const broken: Challenge = { ...c, asyks: [...c.asyks, { ...c.asyks[0] }] };
    expect(decodeChallenge(encodeChallenge(broken)).ok).toBe(false);
  });

  it('длина кода ≤ 400 даже для максимального испытания с длинным названием', () => {
    const rnd = mulberry32(5);
    const asyks = generateLayout(rnd, { zone: { ...ZONE }, count: 12, golden: 2, heavy: 2, blocks: 6, gap: 4 }).map(quantize);
    const code = encodeChallenge({ name: 'Ж'.repeat(24), throws: 10, par: 9, asyks });
    expect(code.length).toBeLessThanOrEqual(MAX_CODE_LENGTH);
  });

  it('название очищается от разметки', () => {
    const c = randomChallenge(9);
    const code = encodeChallenge({ ...c, name: '<img src=x onerror=alert(1)>' });
    const back = decodeChallenge(code);
    expect(back.ok && back.challenge.name.includes('<')).toBe(false);
  });

  it('challengeToLevel даёт корректный уровень', () => {
    const c = randomChallenge(11);
    const lv = challengeToLevel(c);
    expect(lv.asyks).toHaveLength(c.asyks.length);
    expect(lv.zone.r).toBe(ZONE.r);
  });
});

describe('валидация расстановки', () => {
  it('подсвечивает перекрытия и выход из кона', () => {
    const v = validateLayout([
      { x: ZONE.x, y: ZONE.y, angle: 0 },
      { x: ZONE.x + 10, y: ZONE.y, angle: 0 },
      { x: ZONE.x + 400, y: ZONE.y, angle: 0 },
    ]);
    expect(v.ok).toBe(false);
    expect([...v.bad].sort()).toEqual([0, 1, 2]);
  });
  it('ограничения на число объектов', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ x: ZONE.x - 150 + (i % 5) * 60, y: ZONE.y - 100 + Math.floor(i / 5) * 60, angle: 0 }));
    expect(validateLayout(many).tooMany).toBe(true);
    expect(validateLayout([]).tooFew).toBe(true);
    const blocks = Array.from({ length: 7 }, (_, i) => ({ x: ZONE.x - 120 + i * 45, y: ZONE.y, angle: 0, type: 'block' as const }));
    expect(validateLayout(blocks).tooManyBlocks).toBe(true);
  });
  it('par по умолчанию', () => {
    expect(defaultPar(6, 5)).toBe(4);
    expect(defaultPar(3, 12)).toBe(2);
    expect(defaultPar(10, 1)).toBe(1);
  });
});

describe('ссылки', () => {
  it('разбор и сборка', () => {
    const code = encodeChallenge(randomChallenge(2));
    const url = buildLink('https://x.test/', { kind: 'c', code, score: 85, name: 'Аян' });
    const parsed = parseHash(url.slice(url.indexOf('#')));
    expect(parsed).toEqual({ kind: 'c', code, score: 85, name: 'Аян' });
  });
  it('ежедневное и бесконечный режимы', () => {
    expect(parseHash('#d=2026-09-30&s=40')).toEqual({ kind: 'd', date: '2026-09-30', score: 40, name: undefined });
    expect(parseHash('#e=12345&s=300&w=4')).toMatchObject({ kind: 'e', seed: 12345, score: 300, wave: 4 });
  });
  it('мусор отвергается', () => {
    for (const h of ['', '#', '#x=1', '#d=nope', '#e=abc', '#c=' + 'A'.repeat(1000)]) expect(parseHash(h)).toBeNull();
    expect(parseHash('#d=2026-09-30&s=-5&n=<b>')?.['score' as never]).toBeUndefined();
  });
});

describe('бесконечный режим', () => {
  it('число асыков и бросков по формулам', () => {
    expect(waveCount(1)).toBe(4);
    expect(waveCount(20)).toBe(10);
    expect(waveThrows(1, 0)).toBe(5);
    expect(waveThrows(4, 3)).toBe(Math.ceil(7 * 1.2) + 3);
    expect(nextReserve(0)).toBe(2);
    expect(nextReserve(9)).toBe(8);
  });
  it('типы появляются с нужных волн', () => {
    const types = (w: number) => new Set(endlessWave(77, w).asyks.map((a) => a.type));
    expect(types(2)).toEqual(new Set(['normal']));
    expect(types(3).has('golden')).toBe(true);
    expect(types(5).has('heavy')).toBe(true);
    expect(types(7).has('block')).toBe(true);
  });
  it('детерминированность и корректность раскладок', () => {
    for (let w = 1; w <= 15; w++) {
      const a = endlessWave(42, w);
      expect(a).toEqual(endlessWave(42, w));
      expect(validateLayout(a.asyks).bad.size).toBe(0);
      expect(a.asyks.filter((x) => x.type !== 'block')).toHaveLength(waveCount(w));
    }
    expect(endlessWave(1, 3).asyks).not.toEqual(endlessWave(2, 3).asyks);
  });
});
