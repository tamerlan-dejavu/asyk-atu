/**
 * par для набора «навес» (бета). Классический par не меняется.
 * Значения — число бросков «Сильного» (жадного) бота на навесной физике + 1 бросок запаса;
 * таблица прогона — docs/loft/passability.json и docs/LOFT_PHYSICS.md.
 * Пересчитать: GEN_LOFT=1 npx vitest run tests/loft-par.gen.test.ts
 */
export const LOFT_PAR: Record<number, number> = {
  1: 4,
  2: 2,
  3: 3,
  4: 4,
  5: 6,
  6: 3,
  7: 6,
  8: 5,
  9: 5,
  10: 3,
  11: 5,
  12: 4,
  13: 6,
  14: 5,
  15: 5,
};
