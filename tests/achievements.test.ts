import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, levelCoins, prevDate, processEvent } from '../src/game/rules/achievements';
import { defaultSave } from '../src/storage/save';

describe('достижения', () => {
  it('первый бросок выдаётся один раз, награда не повторяется', () => {
    const s = defaultSave();
    const a = processEvent(s, { type: 'throw', mode: 'campaign', k: 0, golden: 0 });
    expect(a.unlocked).toEqual(['first_throw']);
    expect(s.coins).toBe(5);
    const b = processEvent(s, { type: 'throw', mode: 'campaign', k: 0, golden: 0 });
    expect(b.unlocked).toEqual([]);
    expect(s.coins).toBe(5);
  });

  it('комбо 3 и 4, золотой асык', () => {
    const s = defaultSave();
    const r = processEvent(s, { type: 'throw', mode: 'campaign', k: 4, golden: 1 });
    expect(r.unlocked.sort()).toEqual(['combo3', 'combo4', 'first_throw', 'golden'].sort());
    expect(r.coins).toBe(15 + 25 + 5 + 10);
  });

  it('снайпер: 5 попаданий подряд, промах сбрасывает серию', () => {
    const s = defaultSave();
    for (let i = 0; i < 4; i++) processEvent(s, { type: 'throw', mode: 'campaign', k: 1, golden: 0 });
    processEvent(s, { type: 'throw', mode: 'campaign', k: 0, golden: 0 });
    for (let i = 0; i < 4; i++) processEvent(s, { type: 'throw', mode: 'campaign', k: 1, golden: 0 });
    expect(s.achievements.sniper).toBeUndefined();
    const r = processEvent(s, { type: 'throw', mode: 'campaign', k: 1, golden: 0 });
    expect(r.unlocked).toContain('sniper');
  });

  it('тренировка не даёт достижений за броски', () => {
    const s = defaultSave();
    expect(processEvent(s, { type: 'throw', mode: 'training', k: 4, golden: 1 }).unlocked).toEqual([]);
  });

  it('экономист и первый двор', () => {
    const s = defaultSave();
    const r = processEvent(s, { type: 'levelEnd', mode: 'campaign', cleared: true, throwsLeft: 3 });
    expect(r.unlocked.sort()).toEqual(['first_win', 'saver']);
    expect(processEvent(s, { type: 'levelEnd', mode: 'campaign', cleared: false, throwsLeft: 3 }).unlocked).toEqual([]);
  });

  it('пятёрка звёзд: 3★ на 5 разных уровнях', () => {
    const s = defaultSave();
    for (let i = 1; i <= 4; i++) s.levels[String(i)] = { best: 10, stars: 3, plays: 1 };
    expect(processEvent(s, { type: 'levelEnd', mode: 'campaign', cleared: true, throwsLeft: 0 }).unlocked).not.toContain('stars5');
    s.levels['5'] = { best: 10, stars: 3, plays: 1 };
    expect(processEvent(s, { type: 'levelEnd', mode: 'campaign', cleared: true, throwsLeft: 0 }).unlocked).toContain('stars5');
  });

  it('дуэлянт — только победа над сильным ботом', () => {
    const s = defaultSave();
    expect(processEvent(s, { type: 'levelEnd', mode: 'duel', cleared: true, throwsLeft: 0, botHardWon: false }).unlocked).toEqual([]);
    expect(processEvent(s, { type: 'levelEnd', mode: 'duel', cleared: true, throwsLeft: 0, botHardWon: true }).unlocked).toEqual([
      'duelist',
    ]);
  });

  it('марафонец на волне 5, дизайнер при «поделиться»', () => {
    const s = defaultSave();
    expect(processEvent(s, { type: 'wave', wave: 4 }).unlocked).toEqual([]);
    expect(processEvent(s, { type: 'wave', wave: 5 }).unlocked).toEqual(['marathon']);
    expect(processEvent(s, { type: 'share' }).unlocked).toEqual(['designer']);
  });

  it('серия дней: 3 подряд открывают «Постоянство», пропуск сбрасывает', () => {
    const s = defaultSave();
    processEvent(s, { type: 'daily', date: '2026-09-28' });
    processEvent(s, { type: 'daily', date: '2026-09-29' });
    expect(s.dailyStreak.count).toBe(2);
    expect(processEvent(s, { type: 'daily', date: '2026-09-30' }).unlocked).toEqual(['daily3']);
    processEvent(s, { type: 'daily', date: '2026-09-30' });
    expect(s.dailyStreak.count).toBe(3);
    processEvent(s, { type: 'daily', date: '2026-10-05' });
    expect(s.dailyStreak.count).toBe(1);
    expect(prevDate('2026-10-01')).toBe('2026-09-30');
    expect(prevDate('2026-03-01')).toBe('2026-02-28');
  });

  it('12 достижений, идентификаторы уникальны', () => {
    expect(ACHIEVEMENTS).toHaveLength(12);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(12);
    expect(levelCoins(3)).toBe(25);
  });
});
