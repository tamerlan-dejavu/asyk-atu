import { describe, expect, it } from 'vitest';
import { economyBonus, ScoreKeeper, throwScore } from '../src/game/rules/scoring';
import { starsFor } from '../src/game/rules/stars';
import { Round } from '../src/game/rules/round';
import { LEVELS } from '../src/game/levels/levels';

describe('scoring', () => {
  it('формула 10k + 5(k-1)', () => {
    expect(throwScore(0)).toBe(0);
    expect(throwScore(1)).toBe(10);
    expect(throwScore(2)).toBe(25);
    expect(throwScore(3)).toBe(40);
    expect(throwScore(8)).toBe(115);
  });

  it('бонус за экономию только при полностью очищенном коне', () => {
    expect(economyBonus(3, true)).toBe(30);
    expect(economyBonus(3, false)).toBe(0);
    expect(economyBonus(0, true)).toBe(0);
    expect(economyBonus(Infinity, true)).toBe(0);
  });

  it('повторное начисление за один асык невозможно', () => {
    const keeper = new ScoreKeeper();
    expect(keeper.registerThrow(['a1', 'a2']).points).toBe(25);
    const again = keeper.registerThrow(['a1', 'a2', 'a3']);
    expect(again.k).toBe(1);
    expect(again.points).toBe(10);
    expect(keeper.registerThrow(['a1', 'a3']).points).toBe(0);
    expect(keeper.count).toBe(3);
  });
});

describe('stars', () => {
  it('границы par и par+1', () => {
    expect(starsFor(true, 3, 4)).toBe(3);
    expect(starsFor(true, 4, 4)).toBe(3);
    expect(starsFor(true, 5, 4)).toBe(2);
    expect(starsFor(true, 6, 4)).toBe(1);
    expect(starsFor(true, 7, 4)).toBe(1);
  });
  it('поражение — 0 звёзд', () => {
    expect(starsFor(false, 6, 4)).toBe(0);
  });
  it('обучение без par даёт 3★ за очистку', () => {
    expect(starsFor(true, 9, null)).toBe(3);
  });
});

describe('Round (кампания)', () => {
  it('победа: бонус за экономию и звёзды', () => {
    const r = new Round('campaign', LEVELS[1]); // 5 асыков, 6 бросков, par 4
    r.machine.go('LEVEL_INTRO');
    r.machine.go('AIMING');
    r.beginThrow();
    r.machine.go('SETTLING');
    r.machine.go('RESOLVING');
    const a = r.resolveThrow(['0', '1', '2']);
    expect(a.next).toBe('AIMING');
    r.machine.go('AIMING');
    r.beginThrow();
    r.machine.go('SETTLING');
    r.machine.go('RESOLVING');
    const b = r.resolveThrow(['3', '4']);
    expect(b.next).toBe('LEVEL_COMPLETE');
    const s = r.summary();
    expect(s.cleared).toBe(true);
    expect(s.throwsUsed).toBe(2);
    expect(s.bonus).toBe(40); // 4 неиспользованных × 10
    expect(s.score).toBe(40 + 25 + 40);
    expect(s.stars).toBe(3);
  });

  it('поражение: попытки кончились, асыки остались', () => {
    const r = new Round('campaign', LEVELS[1]);
    for (let i = 0; i < 6; i++) {
      r.machine.go(i === 0 ? 'LEVEL_INTRO' : 'AIMING');
      if (i === 0) r.machine.go('AIMING');
      r.beginThrow();
      r.machine.go('SETTLING');
      r.machine.go('RESOLVING');
      const res = r.resolveThrow([]);
      expect(res.next).toBe(i === 5 ? 'LEVEL_FAILED' : 'AIMING');
    }
    expect(r.summary().stars).toBe(0);
    expect(r.summary().bonus).toBe(0);
  });

  it('тренировка: попытки бесконечны', () => {
    const r = new Round('training', LEVELS[1]);
    expect(r.throwsLeft).toBe(Infinity);
  });
});
