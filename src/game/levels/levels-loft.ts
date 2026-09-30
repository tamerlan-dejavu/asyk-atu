/**
 * par для набора «навес» (бета). Классический par не меняется.
 * Значения — число бросков «Сильного» (жадного) бота на навесной физике + 1 бросок запаса;
 * таблица прогона — в docs/LOFT_PHYSICS.md. Пересчитать: npx vitest run scripts/loft-par.gen.test.ts
 */
export const LOFT_PAR: Record<number, number> = {};
