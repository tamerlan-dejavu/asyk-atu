import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergeSaves, syncFingerprint } from '../src/cloud/merge';
import { allLimits, levelMax, limitsSql } from '../src/cloud/limits';
import { applyLevelResult, defaultSave } from '../src/storage/save';
import { LEVELS } from '../src/game/levels/levels';
import type { SaveV2 } from '../src/types';

function phone(): SaveV2 {
  const s = defaultSave();
  s.lang = 'kk';
  applyLevelResult(s, 1, 80, 3);
  applyLevelResult(s, 2, 40, 1);
  s.achievements = { first_throw: 100, combo3: 300 };
  s.owned.push('saka_silver');
  s.coins = 50;
  s.history = [{ ts: 10, mode: 'campaign', ref: 'L1', score: 80, stars: 3, throws: 3, combo: 2 }];
  s.daily = { '2026-09-30': { best: 40 } };
  s.endlessBest = { score: 300, wave: 4 };
  s.customLevels = [{ id: 'p1', name: 'A', code: '1.AAAA', verified: true, ts: 5 }];
  s.dailyStreak = { last: '2026-09-30', count: 2 };
  return s;
}

function laptop(): SaveV2 {
  const s = defaultSave();
  s.lang = 'en';
  applyLevelResult(s, 1, 60, 2);
  applyLevelResult(s, 2, 70, 3);
  applyLevelResult(s, 3, 50, 2);
  s.achievements = { first_throw: 50, golden: 400 };
  s.owned.push('theme_steppe');
  s.equipped.theme = 'theme_steppe';
  s.coins = 120;
  s.history = [
    { ts: 10, mode: 'campaign', ref: 'L1', score: 80, stars: 3, throws: 3, combo: 2 },
    { ts: 20, mode: 'daily', ref: '2026-09-29', score: 55, stars: 0, throws: 6, combo: 1 },
  ];
  s.daily = { '2026-09-30': { best: 60 }, '2026-09-29': { best: 55 } };
  s.endlessBest = { score: 200, wave: 6 };
  s.customLevels = [{ id: 'l1', name: 'B', code: '1.BBBB', verified: false, ts: 7 }];
  s.dailyStreak = { last: '2026-09-29', count: 5 };
  return s;
}

const noResume = (s: SaveV2) => ({ ...s, resume: null, owned: [...s.owned].sort(), seenHints: [...s.seenHints].sort() });

describe('слияние сохранений', () => {
  it('не теряет прогресс: рекорды, звёзды, открытые уровни — максимум', () => {
    const m = mergeSaves({ save: phone(), at: 1000 }, { save: laptop(), at: 2000 });
    expect(m.levels['1']).toEqual({ best: 80, stars: 3, plays: 1 });
    expect(m.levels['2']).toEqual({ best: 70, stars: 3, plays: 1 });
    expect(m.levels['3'].best).toBe(50);
    expect(m.unlocked).toBe(4);
    expect(m.daily['2026-09-30'].best).toBe(60);
    expect(m.daily['2026-09-29'].best).toBe(55);
    expect(m.endlessBest).toEqual({ score: 300, wave: 6 });
  });

  it('достижения и покупки — объединение, время достижения раннее', () => {
    const m = mergeSaves({ save: phone(), at: 1000 }, { save: laptop(), at: 2000 });
    expect(m.achievements).toEqual({ first_throw: 50, combo3: 300, golden: 400 });
    expect(m.owned).toEqual(expect.arrayContaining(['saka_silver', 'theme_steppe', 'saka_bronze']));
    expect(m.customLevels.map((c) => c.id).sort()).toEqual(['l1', 'p1']);
  });

  it('монеты, настройки и экипировка — из более свежей записи', () => {
    const m = mergeSaves({ save: phone(), at: 1000 }, { save: laptop(), at: 2000 });
    expect(m.coins).toBe(120);
    expect(m.lang).toBe('en');
    expect(m.equipped.theme).toBe('theme_steppe');
    const m2 = mergeSaves({ save: phone(), at: 3000 }, { save: laptop(), at: 2000 });
    expect(m2.coins).toBe(50);
    expect(m2.lang).toBe('kk');
  });

  it('история — объединение без дублей, по времени', () => {
    const m = mergeSaves({ save: phone(), at: 1000 }, { save: laptop(), at: 2000 });
    expect(m.history.map((e) => e.ts)).toEqual([10, 20]);
  });

  it('коммутативность', () => {
    const x = mergeSaves({ save: phone(), at: 1000 }, { save: laptop(), at: 2000 });
    const y = mergeSaves({ save: laptop(), at: 2000 }, { save: phone(), at: 1000 });
    expect(noResume(x)).toEqual(noResume(y));
    // и при одинаковом времени (детерминированная ничья)
    const p = mergeSaves({ save: phone(), at: 5 }, { save: laptop(), at: 5 });
    const q = mergeSaves({ save: laptop(), at: 5 }, { save: phone(), at: 5 });
    expect(noResume(p)).toEqual(noResume(q));
  });

  it('идемпотентность: повторное слияние ничего не меняет', () => {
    const a = { save: phone(), at: 1000 };
    const b = { save: laptop(), at: 2000 };
    const m = mergeSaves(a, b);
    expect(mergeSaves({ save: m, at: 2000 }, b)).toEqual(m);
    expect(noResume(mergeSaves({ save: phone(), at: 1 }, { save: phone(), at: 1 }))).toEqual(noResume(phone()));
  });

  it('resume не синхронизируется: берётся локальный', () => {
    const local = phone();
    local.resume = null;
    const remote = laptop();
    remote.resume = {
      v: 1,
      ts: 1,
      mode: 'campaign',
      levelId: 1,
      level: { id: 1, nameKey: 'level1', throws: 6, par: 4, zone: { x: 1, y: 1, r: 1 }, asyks: [{ x: 1, y: 1, angle: 0 }] },
      round: { throwsUsed: 1, scores: [0, 0], player: 0, versusThrows: [0, 0], bestCombo: 0, scoredIds: [], asykTotal: 5 },
      extra: {},
    };
    expect(mergeSaves({ save: local, at: 1 }, { save: remote, at: 2 }).resume).toBeNull();
  });

  it('миграция схемы: облачная запись v1 сливается без потерь', () => {
    const v1 = {
      v: 1,
      lang: 'ru',
      sound: true,
      quality: 'auto',
      tutorialDone: true,
      unlocked: 5,
      levels: { '4': { best: 99, stars: 2, plays: 3 } },
      stats: { throws: 1, asyksOut: 1, hits: 1 },
      daily: {},
      playerNames: ['', ''],
    };
    const m = mergeSaves({ save: phone(), at: 1 }, { save: v1 as unknown as SaveV2, at: 2 });
    expect(m.v).toBe(2);
    expect(m.levels['4'].best).toBe(99);
    expect(m.levels['1'].best).toBe(80);
    expect(m.unlocked).toBe(5);
  });

  it('отпечаток синхронизации не зависит от resume', () => {
    const s = phone();
    const f = syncFingerprint(s);
    s.resume = null;
    expect(syncFingerprint(s)).toBe(f);
    s.coins++;
    expect(syncFingerprint(s)).not.toBe(f);
  });
});

describe('пределы счёта для сервера', () => {
  it('максимум уровня — все асыки одним броском + бонус', () => {
    expect(levelMax(LEVELS[1])).toBe(50 + 20 + 60);
    for (const l of allLimits()) expect(l.maxScore).toBeGreaterThan(0);
  });
  it('миграция 0002 совпадает с генерацией из levels.ts (клиент и БД не расходятся)', () => {
    const file = readFileSync('supabase/migrations/0002_level_limits.sql', 'utf8');
    expect(file).toBe(limitsSql());
  });
});
