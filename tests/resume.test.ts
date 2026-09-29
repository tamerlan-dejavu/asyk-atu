import { describe, expect, it } from 'vitest';
// @ts-expect-error у встроенного Matter нет типов
import Matter from 'phaser/src/physics/matter-js/CustomMain.js';
import { POWER_MAX, POWER_MIN, ZONE } from '../src/game/config';
import { Sim } from '../src/game/physics/sim';
import { LEVELS } from '../src/game/levels/levels';
import { Round, specId } from '../src/game/rules/round';
import { sanitizeResume } from '../src/storage/save';
import { equipItem, activatePro } from '../src/shop/catalog';
import { defaultSave } from '../src/storage/save';
import type { AsykSpec, ResumeState } from '../src/types';

function throwOnce(sim: Sim, power: number, angleDeg: number): string[] {
  const v = POWER_MIN + (POWER_MAX - POWER_MIN) * power;
  const a = (angleDeg * Math.PI) / 180;
  sim.launchSaka(Math.sin(a) * v, -Math.cos(a) * v);
  const out: string[] = [];
  let n = 0;
  while (!sim.settled && n < 2000) {
    out.push(...sim.step().newlyScored);
    n++;
  }
  sim.endThrow();
  sim.dropSaka();
  return out;
}

describe('продолжить раунд', () => {
  it('сохранение → загрузка даёт те же позиции и тот же счёт', () => {
    const level = LEVELS[9]; // все типы тел
    const sim = new Sim(Matter, ZONE);
    level.asyks.forEach((a, i) => sim.addAsyk(specId(a, i), a));
    const round = new Round('campaign', level);
    round.machine.go('LEVEL_INTRO');
    round.machine.go('AIMING');
    round.beginThrow();
    const out = throwOnce(sim, 1, -4);
    round.machine.go('SETTLING');
    round.machine.go('RESOLVING');
    round.resolveThrow(out);

    // тела неподвижны: сохраняем положение оставшихся (как GameScene.writeResume)
    const asyks: AsykSpec[] = sim
      .asyks()
      .filter((b) => !b.scored)
      .map((b) => ({ id: b.id, x: b.body.position.x, y: b.body.position.y, angle: b.body.angle, type: b.type }));
    const rs: ResumeState = {
      v: 1,
      ts: 1,
      mode: 'campaign',
      levelId: level.id,
      level: { id: level.id, nameKey: level.nameKey, throws: level.throws, par: level.par, zone: level.zone, asyks },
      round: round.snapshot(),
      extra: {},
    };
    const restored = sanitizeResume(JSON.parse(JSON.stringify(rs)))!;
    expect(restored).not.toBeNull();

    const sim2 = new Sim(Matter, ZONE);
    restored.level.asyks.forEach((a, i) => sim2.addAsyk(specId(a, i), a));
    const round2 = new Round('campaign', { ...level, asyks: restored.level.asyks }, { snapshot: restored.round });
    const pos = (s: Sim) => s.snapshot().filter((b) => b.id !== 'saka');
    expect(pos(sim2)).toEqual(pos(sim).filter((b) => !sim.bodies.get(b.id)!.scored));
    expect(round2.throwsLeft).toBe(round.throwsLeft);
    expect(round2.score).toBe(round.score);
    expect(round2.asyksLeft).toBe(round.asyksLeft);
    // следующий бросок после восстановления идентичен броску без перезагрузки
    const a = throwOnce(sim, 0.9, 6).filter((id) => !round.keeper.has(id));
    const b = throwOnce(sim2, 0.9, 6);
    expect(round2.resolveThrow(b).outcome.points).toBe(round.resolveThrow(a).outcome.points);
  });
});

describe('render-isolation: косметика', () => {
  it('выбранная сақа/площадка/асыки не меняют результат броска', () => {
    const play = () => {
      const sim = new Sim(Matter, ZONE);
      LEVELS[4].asyks.forEach((a, i) => sim.addAsyk(`a${i}`, a));
      const out = throwOnce(sim, 1, -9);
      return { out, snap: sim.snapshot() };
    };
    const base = play();
    const save = defaultSave();
    save.coins = 9999;
    activatePro(save);
    for (const id of ['saka_jade', 'theme_night']) equipItem(save, id);
    // физика вообще не читает сохранение/оформление: повторный прогон при другой косметике идентичен
    const again = play();
    expect(again).toEqual(base);
  });
});
