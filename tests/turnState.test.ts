import { describe, expect, it } from 'vitest';
import { canTransition, InvalidTransitionError, nextAfterThrow, nextPlayer, StateMachine } from '../src/game/rules/turnState';
import { Round } from '../src/game/rules/round';
import { VERSUS_LEVEL } from '../src/game/levels/levels';

describe('turnState', () => {
  it('основная цепочка допустима', () => {
    const m = new StateMachine(true);
    for (const s of ['LEVEL_INTRO', 'AIMING', 'FLYING', 'SETTLING', 'RESOLVING', 'AIMING'] as const) {
      expect(m.go(s)).toBe(true);
    }
  });

  it('недопустимые переходы: ошибка в dev, игнор в prod', () => {
    expect(canTransition('MENU', 'FLYING')).toBe(false);
    const dev = new StateMachine(true);
    expect(() => dev.go('FLYING')).toThrow(InvalidTransitionError);
    const prod = new StateMachine(false);
    expect(prod.go('FLYING')).toBe(false);
    expect(prod.state).toBe('MENU');
  });

  it('пауза возвращает в то же состояние', () => {
    const m = new StateMachine(true);
    m.go('LEVEL_INTRO');
    m.go('AIMING');
    m.go('FLYING');
    expect(m.pause()).toBe(true);
    expect(m.state).toBe('PAUSED');
    expect(m.resume()).toBe(true);
    expect(m.state).toBe('FLYING');
  });

  it('из паузы нельзя перескочить в другое игровое состояние', () => {
    const m = new StateMachine(false);
    m.go('LEVEL_INTRO');
    m.go('AIMING');
    m.pause();
    expect(m.go('SETTLING')).toBe(false);
    expect(m.state).toBe('PAUSED');
  });

  it('исход после броска', () => {
    expect(nextAfterThrow(0, 3)).toBe('LEVEL_COMPLETE');
    expect(nextAfterThrow(2, 0)).toBe('LEVEL_FAILED');
    expect(nextAfterThrow(2, 1)).toBe('AIMING');
    expect(nextAfterThrow(0, 0)).toBe('LEVEL_COMPLETE');
  });

  it('режим вдвоём: ход переходит, очки идут бросившему, итог — победитель/ничья', () => {
    const r = new Round('versus', VERSUS_LEVEL);
    r.machine.go('LEVEL_INTRO');
    r.machine.go('AIMING');
    let idx = 0;
    const order: number[] = [];
    for (let i = 0; i < 12; i++) {
      order.push(r.player);
      r.beginThrow();
      r.machine.go('SETTLING');
      r.machine.go('RESOLVING');
      // игрок 0 выбивает по одному асыку каждый бросок, игрок 1 — ничего
      const ids = r.player === 0 ? [String(idx++)] : [];
      const res = r.resolveThrow(ids);
      if (i < 11) {
        expect(res.next).toBe('AIMING');
        r.machine.go('AIMING');
      } else {
        expect(res.next).toBe('LEVEL_COMPLETE');
      }
    }
    expect(order).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    const s = r.summary();
    expect(s.scores).toEqual([60, 0]);
    expect(s.winner).toBe(0);
  });

  it('ничья при равном счёте', () => {
    const r = new Round('versus', VERSUS_LEVEL);
    r.machine.go('LEVEL_INTRO');
    r.machine.go('AIMING');
    r.beginThrow();
    r.machine.go('SETTLING');
    r.machine.go('RESOLVING');
    r.resolveThrow(['a']);
    r.machine.go('AIMING');
    r.beginThrow();
    r.machine.go('SETTLING');
    r.machine.go('RESOLVING');
    r.resolveThrow(['b']);
    const s = r.summary();
    expect(s.scores).toEqual([10, 10]);
    expect(s.winner).toBe(-1);
  });

  it('nextPlayer', () => {
    expect(nextPlayer(0)).toBe(1);
    expect(nextPlayer(1)).toBe(0);
  });
});
