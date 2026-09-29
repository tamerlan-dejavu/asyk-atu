import { describe, expect, it } from 'vitest';
import { LEVELS, VERSUS_LEVEL } from '../src/game/levels/levels';
import { asykGap, insideZone } from '../src/game/levels/layout';
import { dailyLevel } from '../src/game/levels/daily';
import { hashString, mulberry32 } from '../src/game/levels/rng';

describe('levels', () => {
  it('id уникальны', () => {
    const ids = [...LEVELS, VERSUS_LEVEL].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const level of [...LEVELS, VERSUS_LEVEL, dailyLevel('2026-10-01')]) {
    describe(`уровень ${level.id}`, () => {
      it('все асыки внутри кона', () => {
        for (const a of level.asyks) expect(insideZone(a, level.zone, 4)).toBe(true);
      });
      it('асыки не перекрываются на старте', () => {
        for (let i = 0; i < level.asyks.length; i++)
          for (let j = i + 1; j < level.asyks.length; j++)
            expect(asykGap(level.asyks[i], level.asyks[j])).toBeGreaterThan(0);
      });
      it('par ≤ throws и уровень проходим (асыков ≤ throws·3)', () => {
        if (level.par !== null) expect(level.par).toBeLessThanOrEqual(level.throws);
        expect(level.asyks.length).toBeLessThanOrEqual(level.throws * 3);
      });
    });
  }

  it('таблица ТЗ: число асыков и бросков', () => {
    expect(LEVELS.map((l) => l.asyks.filter((a) => a.type !== 'block').length)).toEqual([3, 5, 6, 8, 8, 7, 5, 7, 6, 7, 9]);
    expect(LEVELS.map((l) => l.throws)).toEqual([Infinity, 6, 6, 7, 7, 7, 6, 7, 7, 8, 8]);
    expect(LEVELS.map((l) => l.par)).toEqual([null, 4, 4, 5, 5, 6, 4, 5, 5, 6, 6]);
  });
});

describe('seed / ежедневное испытание', () => {
  it('одна дата — одна расстановка', () => {
    expect(dailyLevel('2026-09-30')).toEqual(dailyLevel('2026-09-30'));
  });
  it('разные даты — разные расстановки', () => {
    expect(dailyLevel('2026-09-30').asyks).not.toEqual(dailyLevel('2026-10-01').asyks);
  });
  it('6 асыков', () => {
    expect(dailyLevel('2026-09-30').asyks).toHaveLength(6);
  });
  it('mulberry32 детерминирован и в [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});
