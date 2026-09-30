/**
 * Проходимость уровней в наборе «навес» и par для него (жадный «Сильный» бот).
 * Долгий прогон, по умолчанию пропускается: GEN_LOFT=1 npx vitest run tests/loft-par.gen.test.ts
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
// @ts-expect-error у встроенного Matter нет типов
import Matter from 'phaser/src/physics/matter-js/CustomMain.js';
import { LOFT, POWER_MAX, POWER_MIN, ZONE } from '../src/game/config';
import { candidateShots, type Shot } from '../src/game/bot';
import { LEVELS } from '../src/game/levels/levels';
import { PRO_LEVELS } from '../src/game/levels/levels-pro';
import { launchVelocity, LOFTS, type Loft } from '../src/game/physics/ballistics';
import { Sim } from '../src/game/physics/sim';
import type { AsykSpec } from '../src/types';

const zone = { ...ZONE };

function play(specs: AsykSpec[], shot: Shot): { k: number; rest: AsykSpec[] } {
  const sim = new Sim(Matter, zone, { loft: Boolean(shot.loft) });
  specs.forEach((s, i) => sim.addAsyk(`a${i}`, s));
  if (shot.loft) {
    const l = launchVelocity(shot.power, shot.loft, shot.dirX, shot.dirY);
    sim.launchSaka(l.vx, l.vy, Math.atan2(shot.dirY, shot.dirX), l.vz, LOFT.Z0);
  } else {
    const v = POWER_MIN + (POWER_MAX - POWER_MIN) * shot.power;
    sim.launchSaka(shot.dirX * v, shot.dirY * v, Math.atan2(shot.dirY, shot.dirX));
  }
  let k = 0;
  for (let n = 0; n < 700 && !sim.settled; n++) k += sim.step().newlyScored.length;
  const rest = [
    ...specs.filter((s) => s.type === 'block'),
    ...sim.standing().map((b) => ({ x: b.body.position.x, y: b.body.position.y, angle: b.body.angle, type: b.type })),
  ];
  return { k, rest };
}

/** Жадный бот: каждый бросок — вариант с наибольшим числом выбитых. Возвращает число бросков или null. */
function greedy(level: (typeof LEVELS)[number], lofts: Loft[] | null): number | null {
  let specs = level.asyks;
  const limit = Number.isFinite(level.throws) ? level.throws : 8;
  for (let t = 1; t <= limit; t++) {
    let best: { k: number; rest: AsykSpec[] } | null = null;
    for (const c of candidateShots(specs, lofts)) {
      const r = play(specs, c);
      if (!best || r.k > best.k) best = r;
    }
    if (!best || best.k === 0) return null;
    specs = best.rest;
    if (!specs.some((s) => s.type !== 'block')) return t;
  }
  return null;
}

describe('навес: проходимость и par', () => {
  it.skipIf(!process.env.GEN_LOFT)(
    'прогон бота по всем уровням',
    () => {
      const rows: string[] = [];
      const par: Record<number, number> = {};
      for (const l of [...LEVELS.filter((x) => x.id > 0), ...PRO_LEVELS]) {
        const all = greedy(l, LOFTS);
        const hasBlocks = l.asyks.some((a) => a.type === 'block');
        const low = hasBlocks ? greedy(l, ['low']) : null;
        const classic = greedy(l, null);
        if (all !== null) par[l.id] = Math.min(l.throws, all + 1);
        const row = {
          id: l.id,
          throws: l.throws,
          parClassic: l.par,
          classic,
          loftAll: all,
          loftLowOnly: hasBlocks ? low : '-',
          parLoft: par[l.id] ?? null,
        };
        rows.push(JSON.stringify(row));
        console.log('ROW', JSON.stringify(row));
      }
      writeFileSync('docs/loft/passability.json', `[\n${rows.join(',\n')}\n]\n`);
      console.log('PAR', JSON.stringify(par));
    },
    3_600_000,
  );
});
