import { ZONE } from '../config';
import type { LevelDef } from '../../types';
import { generateLayout } from './generate';
import { mulberry32 } from './rng';

interface ProCfg {
  id: number;
  seed: number;
  throws: number;
  par: number;
  count: number;
  golden: number;
  heavy: number;
  blocks: number;
  gap: number;
}

/**
 * Дополнительная глава «Той» (набор «Той-Pro»): 5 уровней. Расстановки — из seed-генератора
 * (детерминированно); сиды подобраны прогоном бота: каждый уровень проходим за ≤ par бросков.
 */
const CFG: ProCfg[] = [
  { id: 11, seed: 12103, throws: 7, par: 5, count: 6, golden: 2, heavy: 0, blocks: 2, gap: 12 },
  { id: 12, seed: 13104, throws: 8, par: 6, count: 7, golden: 1, heavy: 3, blocks: 2, gap: 10 },
  { id: 13, seed: 14108, throws: 8, par: 6, count: 8, golden: 2, heavy: 2, blocks: 3, gap: 8 },
  { id: 14, seed: 15110, throws: 9, par: 7, count: 9, golden: 2, heavy: 3, blocks: 3, gap: 6 },
  { id: 15, seed: 16143, throws: 10, par: 8, count: 10, golden: 3, heavy: 3, blocks: 4, gap: 6 },
];

export const PRO_LEVELS: LevelDef[] = CFG.map((c) => ({
  id: c.id,
  nameKey: `level${c.id}`,
  throws: c.throws,
  par: c.par,
  zone: { ...ZONE },
  asyks: generateLayout(mulberry32(c.seed), {
    zone: { ...ZONE },
    count: c.count,
    golden: c.golden,
    heavy: c.heavy,
    blocks: c.blocks,
    gap: c.gap,
  }),
}));
