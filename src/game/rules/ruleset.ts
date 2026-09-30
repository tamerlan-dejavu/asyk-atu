import type { LevelDef, Ruleset } from '../../types';
import { LOFT_PAR } from '../levels/levels-loft';

/**
 * Раздельные рекорды по набору правил. Классика хранится по прежним ключам (миграция не нужна:
 * все существующие записи — классические), навес — с суффиксом «:loft».
 */
export const levelKey = (id: number, rs: Ruleset): string => (rs === 'loft' ? `${id}:loft` : String(id));
export const dailyKey = (date: string, rs: Ruleset): string => (rs === 'loft' ? `${date}:loft` : date);
/** Ключ рейтинга в облаке: к ключу режима добавляется набор правил. */
export const cloudKey = (key: string, rs: Ruleset): string => (rs === 'loft' ? `${key}:loft` : key);

/** Уровень с par для набора правил (у навеса свой par, подобранный «Сильным» ботом). */
export function withRulesetPar(level: LevelDef, rs: Ruleset): LevelDef {
  if (rs !== 'loft') return level;
  const par = LOFT_PAR[level.id];
  return par === undefined ? level : { ...level, par: Math.min(par, level.throws) };
}
