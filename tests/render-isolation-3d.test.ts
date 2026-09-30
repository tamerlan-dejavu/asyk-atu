import { describe, expect, it } from 'vitest';
// @ts-expect-error у встроенного Matter нет типов
import Matter from 'phaser/src/physics/matter-js/CustomMain.js';
import { POWER_MAX, POWER_MIN, ZONE } from '../src/game/config';
import { LEVELS } from '../src/game/levels/levels';
import { Sim } from '../src/game/physics/sim';
import { meshTransform, type BodySnapshot } from '../src/game/view3d/sync';
import { fitCamera, project } from '../src/game/view3d/camera3d';
import { defaultSave, sanitize } from '../src/storage/save';

function play(level: number, power: number, angleDeg: number, view: '2d' | '3d') {
  const sim = new Sim(Matter, ZONE);
  LEVELS[level].asyks.forEach((a, i) => sim.addAsyk(`a${i}`, a));
  const v = POWER_MIN + (POWER_MAX - POWER_MIN) * power;
  const ang = (angleDeg * Math.PI) / 180;
  sim.launchSaka(Math.sin(ang) * v, -Math.cos(ang) * v);
  const { cam } = fitCamera();
  let n = 0;
  while (!sim.settled && n < 2000) {
    sim.step();
    if (view === '3d') {
      // как ThreeView каждый кадр: читаем снимок, считаем трансформы мешей и проекцию оверлея
      for (const b of sim.bodies.values()) {
        const snap: BodySnapshot = {
          id: b.id,
          kind: b.kind,
          type: b.type,
          x: b.body.position.x,
          y: b.body.position.y,
          angle: b.body.angle,
          z: 3,
          alpha: 1,
        };
        const t = meshTransform(snap);
        project(cam, { x: t.px, y: t.py, z: t.pz });
      }
    }
    n++;
  }
  return sim.snapshot();
}

describe('render-isolation: 2D и 3D', () => {
  it('одна расстановка и один бросок дают одинаковые финальные позиции в 2D и 3D', () => {
    for (const [lvl, p, a] of [
      [1, 1, 0],
      [9, 0.9, -5],
      [10, 1, 4],
    ] as const) {
      expect(play(lvl, p, a, '3d')).toEqual(play(lvl, p, a, '2d'));
    }
  }, 60_000); // под сбором покрытия физика заметно медленнее

  it('трансформ меша: X = x, Z = y, поворот против часовой, подъём = z', () => {
    const t = meshTransform({ id: 'a', kind: 'asyk', type: 'normal', x: 100, y: 200, angle: 0.5, z: 7, alpha: 1 });
    expect(t).toEqual({ px: 100, py: 7, pz: 200, rotY: -0.5, scale: 1 });
  });
});

describe('настройка вида', () => {
  it('по умолчанию 3D; 2D — только если игрок выбрал его сам', () => {
    expect(defaultSave().view).toBe('3d');
    const old = { ...defaultSave() } as Record<string, unknown>;
    delete old.view;
    delete old.viewChosen;
    delete old.view3dBlocked;
    expect(sanitize(old).view).toBe('3d');
    // прежнее сохранение со значением по умолчанию '2d' переходит на 3D
    expect(sanitize({ ...old, view: '2d' }).view).toBe('3d');
    expect(sanitize({ ...old, view: '2d', viewChosen: true }).view).toBe('2d');
    expect(sanitize({ ...old, view: '3d', viewChosen: true }).view).toBe('3d');
    expect(sanitize({ ...old, view: 'vr', viewChosen: true }).view).toBe('3d');
    expect(sanitize({ v: 1, unlocked: 2 }).view).toBe('3d');
  });
});
