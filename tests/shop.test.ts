import { describe, expect, it } from 'vitest';
import { activatePro, buyItem, equipItem, isOwned, ITEMS, PRO_BUNDLE } from '../src/shop/catalog';
import { defaultSave } from '../src/storage/save';
import { PRO_LEVELS } from '../src/game/levels/levels-pro';
import { nextLevelId } from '../src/game/levels/levels';
import { validateLayout } from '../src/challenge/codec';

describe('магазин', () => {
  it('по умолчанию куплены бесплатные предметы', () => {
    const s = defaultSave();
    for (const id of ['saka_bronze', 'theme_yard', 'asyk_bone']) expect(isOwned(s, id)).toBe(true);
    expect(isOwned(s, 'saka_gold')).toBe(false);
  });

  it('покупка списывает тиын один раз', () => {
    const s = defaultSave();
    s.coins = 250;
    expect(buyItem(s, 'saka_silver')).toBe('ok');
    expect(s.coins).toBe(150);
    expect(buyItem(s, 'saka_silver')).toBe('owned');
    expect(s.coins).toBe(150);
    expect(buyItem(s, 'saka_oyu')).toBe('poor');
    expect(s.coins).toBe(150);
    expect(buyItem(s, 'nope')).toBe('unknown');
  });

  it('надеть можно только купленное', () => {
    const s = defaultSave();
    expect(equipItem(s, 'saka_gold')).toBe(false);
    s.coins = 200;
    buyItem(s, 'saka_gold');
    expect(equipItem(s, 'saka_gold')).toBe(true);
    expect(s.equipped.saka).toBe('saka_gold');
  });

  it('Pro-предметы за тиын не продаются, тестовая покупка реально открывает набор', () => {
    const s = defaultSave();
    s.coins = 9999;
    expect(buyItem(s, 'saka_jade')).toBe('proOnly');
    expect(equipItem(s, 'theme_night')).toBe(false);
    const coinsBefore = s.coins;
    expect(activatePro(s)).toBe(true);
    expect(s.coins).toBe(coinsBefore); // деньги/тиын не списываются
    for (const id of PRO_BUNDLE) expect(isOwned(s, id)).toBe(true);
    expect(equipItem(s, 'theme_night')).toBe(true);
    expect(activatePro(s)).toBe(false);
  });

  it('косметика не имеет физических параметров', () => {
    for (const it of ITEMS) expect(Object.keys(it).sort()).toEqual(expect.arrayContaining(['cat', 'id', 'price']));
  });
});

describe('Pro-уровни', () => {
  it('5 уровней 11–15 с корректными расстановками', () => {
    expect(PRO_LEVELS.map((l) => l.id)).toEqual([11, 12, 13, 14, 15]);
    for (const l of PRO_LEVELS) {
      expect(validateLayout(l.asyks).bad.size).toBe(0);
      expect(l.par).toBeLessThanOrEqual(l.throws);
      expect(l.asyks.some((a) => a.type === 'block')).toBe(true);
    }
  });
  it('навигация: после 10-го — только с Pro', () => {
    expect(nextLevelId(5, false)).toBe(6);
    expect(nextLevelId(10, false)).toBeUndefined();
    expect(nextLevelId(10, true)).toBe(11);
    expect(nextLevelId(15, true)).toBeUndefined();
  });
});
