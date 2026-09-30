import { ASYK_VALUE, COMBO_BONUS, DAILY_THROWS, ECONOMY_BONUS } from '../game/config';
import { LEVELS } from '../game/levels/levels';
import { PRO_LEVELS } from '../game/levels/levels-pro';
import type { LevelDef } from '../types';

export interface LevelLimit {
  mode: 'level' | 'daily' | 'endless' | 'challenge';
  key: string;
  maxScore: number;
}

/** Максимально возможный счёт уровня: все выбиваемые за один бросок + бонус за все остальные броски (+1 бросок «Лёгкого»). */
export function levelMax(l: LevelDef): number {
  const real = l.asyks.filter((a) => a.type !== 'block');
  const sum = real.reduce((s, a) => s + ASYK_VALUE[a.type ?? 'normal'], 0);
  const combo = COMBO_BONUS * Math.max(0, real.length - 1);
  const throws = Number.isFinite(l.throws) ? l.throws : 0;
  return sum + combo + ECONOMY_BONUS * throws;
}

/** Общие пределы: ежедневное (6 обычных), свои испытания (12 золотых, 10 бросков), бесконечный — глобальный. */
export const GENERIC_LIMITS: LevelLimit[] = [
  { mode: 'daily', key: '*', maxScore: 6 * ASYK_VALUE.normal + COMBO_BONUS * 5 + ECONOMY_BONUS * DAILY_THROWS },
  { mode: 'challenge', key: '*', maxScore: 12 * ASYK_VALUE.golden + COMBO_BONUS * 11 + ECONOMY_BONUS * 10 },
  { mode: 'endless', key: '*', maxScore: 5000 },
];

export function allLimits(): LevelLimit[] {
  const levels = [...LEVELS, ...PRO_LEVELS];
  return [
    ...levels.map((l) => ({ mode: 'level' as const, key: `level:${l.id}`, maxScore: levelMax(l) })),
    // навес: те же формулы очков — те же пределы; ключ с набором правил (как в рейтинге)
    ...levels.map((l) => ({ mode: 'level' as const, key: `level:${l.id}:loft`, maxScore: levelMax(l) })),
    ...GENERIC_LIMITS,
  ];
}

/** SQL-миграция с пределами: клиент и БД не расходятся (тест сравнивает файл с генерацией). */
export function limitsSql(): string {
  const rows = allLimits().map((l) => `  ('${l.mode}', '${l.key}', ${l.maxScore})`);
  return [
    '-- СГЕНЕРИРОВАНО scripts/gen-level-limits.mjs из src/game/levels — не править вручную.',
    '-- Верхняя граница правдоподобного счёта для submit_result().',
    'insert into public.level_limits (mode, key, max_score) values',
    rows.join(',\n'),
    'on conflict (mode, key) do update set max_score = excluded.max_score;',
    '',
  ].join('\n');
}
