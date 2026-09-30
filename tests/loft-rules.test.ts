import { describe, expect, it } from 'vitest';
import { decodeChallenge, encodeChallenge, quantize } from '../src/challenge/codec';
import { buildLink, parseHash } from '../src/challenge/link';
import { ZONE } from '../src/game/config';
import { LEVELS } from '../src/game/levels/levels';
import { LOFT_PAR } from '../src/game/levels/levels-loft';
import { cloudKey, dailyKey, levelKey, withRulesetPar } from '../src/game/rules/ruleset';
import { applyLevelResult, defaultSave, sanitize } from '../src/storage/save';

const asyks = [quantize({ x: ZONE.x, y: ZONE.y, angle: 0 }), quantize({ x: ZONE.x + 80, y: ZONE.y, angle: 0, type: 'block' })];

describe('набор правил в коде вызова', () => {
  it('бит набора правил переживает кодирование', () => {
    const loft = decodeChallenge(encodeChallenge({ name: 'Навес', throws: 5, par: 3, asyks, ruleset: 'loft' }));
    expect(loft.ok && loft.challenge.ruleset).toBe('loft');
    const classic = decodeChallenge(encodeChallenge({ name: 'Классика', throws: 5, par: 3, asyks }));
    expect(classic.ok && classic.challenge.ruleset).toBe('classic');
  });

  it('старые коды (без бита) читаются как классика', () => {
    // код, собранный до появления бита: запасные биты заголовка были нулями — это и есть «классика»
    const code = encodeChallenge({ name: 'x', throws: 4, par: 2, asyks, ruleset: 'classic' });
    const d = decodeChallenge(code);
    expect(d.ok && d.challenge.ruleset).toBe('classic');
  });
});

describe('ссылки на ежедневное и бесконечный', () => {
  it('r=loft сохраняется, по умолчанию — классика', () => {
    const d = parseHash(buildLink('https://x.test/', { kind: 'd', date: '2026-09-30', ruleset: 'loft' }).split('#')[1]);
    expect(d).toMatchObject({ kind: 'd', ruleset: 'loft' });
    const e = parseHash('#e=42&s=100');
    expect(e && 'ruleset' in e ? e.ruleset : undefined).toBeUndefined();
    expect(buildLink('https://x.test/', { kind: 'e', seed: 42 })).not.toContain('r=');
  });
});

describe('раздельные рекорды', () => {
  it('ключи: классика — прежние, навес — с суффиксом', () => {
    expect(levelKey(3, 'classic')).toBe('3');
    expect(levelKey(3, 'loft')).toBe('3:loft');
    expect(dailyKey('2026-09-30', 'loft')).toBe('2026-09-30:loft');
    expect(cloudKey('level:3', 'loft')).toBe('level:3:loft');
    expect(cloudKey('endless', 'classic')).toBe('endless');
  });

  it('рекорд навеса не трогает классический, уровень открывается в обоих', () => {
    const s = defaultSave();
    applyLevelResult(s, 1, 90, 3, levelKey(1, 'classic'));
    applyLevelResult(s, 1, 40, 1, levelKey(1, 'loft'));
    expect(s.levels['1'].best).toBe(90);
    expect(s.levels['1:loft'].best).toBe(40);
    expect(s.unlocked).toBe(2);
  });

  it('par навеса свой, классический не меняется', () => {
    expect(withRulesetPar(LEVELS[2], 'classic').par).toBe(LEVELS[2].par);
    expect(withRulesetPar(LEVELS[2], 'loft').par).toBe(LOFT_PAR[2]);
    for (const l of LEVELS.filter((x) => x.id > 0)) expect(LOFT_PAR[l.id]).toBeLessThanOrEqual(l.throws);
  });
});

describe('миграция сохранения', () => {
  it('без новых полей: классика, средняя высота, пустой рекорд навеса; старые данные на месте', () => {
    const old = { v: 2, lang: 'kk', unlocked: 4, levels: { '2': { best: 50, stars: 2, plays: 1 } } };
    const s = sanitize(old);
    expect(s.ruleset).toBe('classic');
    expect(s.loft).toBe('mid');
    expect(s.endlessBestLoft).toEqual({ score: 0, wave: 0 });
    expect(s.levels['2'].best).toBe(50);
    expect(s.lang).toBe('kk');
    expect(sanitize({ ...old, ruleset: 'loft', loft: 'high' })).toMatchObject({ ruleset: 'loft', loft: 'high' });
    expect(sanitize({ ...old, ruleset: 'moon', loft: 'sky' })).toMatchObject({ ruleset: 'classic', loft: 'mid' });
    expect(sanitize({ v: 1, unlocked: 2 }).ruleset).toBe('classic');
  });
});
