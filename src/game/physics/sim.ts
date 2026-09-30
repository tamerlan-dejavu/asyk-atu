import {
  FIELD_H,
  FIELD_W,
  LOFT,
  MAX_BODY_SPEED,
  OUT_FADE_MS,
  POSITION_ITERATIONS,
  SAKA_START,
  SETTLE_ANGULAR,
  SETTLE_HOLD_MS,
  SETTLE_SPEED,
  STEP_MS,
  SUBSTEPS,
  TURN_TIMEOUT_MS,
  VELOCITY_ITERATIONS,
} from '../config';
import type { AsykType, AsykSpec, ZoneSpec } from '../../types';
import { createAsykBody, createSakaBody, createWalls, type MatterNS, type MBody } from './bodies';
import { isSettledNow } from './settle';
import { airborne, heightOverlap, integrate, popVz, thickness } from './vertical';

export interface SimBody {
  id: string;
  kind: 'asyk' | 'saka';
  type: AsykType;
  body: MBody;
  scored: boolean;
  /** тик, когда асык был засчитан (для удаления через OUT_FADE_MS) */
  scoredTick: number;
  removed: boolean;
  /** навесной режим: высота нижней грани над землёй и вертикальная скорость (в классике всегда 0) */
  z: number;
  vz: number;
  /** толщина тела по высоте */
  h: number;
  /** сопротивление воздуха на земле (базовое frictionAir тела) */
  groundAir: number;
}

export interface HitEvent {
  a: string;
  b: string; // id или 'wall'
  /** относительная скорость столкнувшихся тел, px/шаг — мера силы удара */
  impulse: number;
  x: number;
  y: number;
}

export interface LandEvent {
  id: string;
  /** скорость удара о землю, px/шаг */
  impact: number;
  x: number;
  y: number;
}

export interface StepResult {
  hits: HitEvent[];
  newlyScored: string[];
  removed: string[];
  /** навесной режим: удары о землю за шаг */
  landed: LandEvent[];
  /** навесной режим: сақа в воздухе вылетела за поле (перелёт) */
  overshoot: boolean;
}

export interface SimOptions {
  /** набор правил «навес»: вертикальный канал, фильтр столкновений по высоте, перелёт */
  loft?: boolean;
}

const SUB_DELTA = STEP_MS / SUBSTEPS;
const OUT_TICKS = Math.round(OUT_FADE_MS / STEP_MS);
const HOLD_TICKS = Math.round(SETTLE_HOLD_MS / STEP_MS);
const TIMEOUT_TICKS = Math.round(TURN_TIMEOUT_MS / STEP_MS);

interface MPair {
  bodyA: MBody;
  bodyB: MBody;
  isSensor: boolean;
  collision: { supports: { x: number; y: number }[] };
}

/**
 * Физический мир без Phaser: тестируется в Node, а Phaser только рисует его состояние.
 * Шаг фиксированный (1/60 с, SUBSTEPS подшагов) — результат не зависит от FPS.
 * Никакой случайности и никаких визуальных параметров здесь нет.
 *
 * Навесной режим («2,5D»): плоская физика Matter остаётся основой, поверх неё — вертикальный канал
 * (vertical.ts). Пары тел без пересечения по высоте помечаются сенсорами — Matter их не разрешает.
 */
export class Sim {
  readonly engine: MBody;
  readonly bodies = new Map<string, SimBody>();
  readonly loft: boolean;
  tick = 0;
  saka: SimBody | null = null;
  /** тик броска (для тайм-аута и тишины) */
  throwTick = -1;
  timedOut = false;
  /** навесной режим: сақа улетела за поле в этом ходе */
  overshoot = false;
  private stillTicks = 0;
  private pendingHits: HitEvent[] = [];

  constructor(
    private readonly M: MatterNS,
    readonly zone: ZoneSpec,
    opts: SimOptions = {},
  ) {
    this.loft = Boolean(opts.loft);
    this.engine = M.Engine.create({
      gravity: { x: 0, y: 0, scale: 0 },
      positionIterations: POSITION_ITERATIONS,
      velocityIterations: VELOCITY_ITERATIONS,
      enableSleeping: false,
    });
    M.Composite.add(this.engine.world, createWalls(M));
    M.Events.on(this.engine, 'collisionStart', (e: { pairs: MPair[] }) => {
      for (const p of e.pairs) {
        if (this.loft) {
          // новые пары: решаем до разрешения контакта (collisionStart приходит раньше Resolver)
          const solid = this.pairSolid(p);
          p.isSensor = !solid;
          if (!solid) continue;
          this.onContact(p);
        } else this.recordHit(p);
      }
    });
  }

  private recordHit(p: MPair): number {
    const va = p.bodyA.velocity;
    const vb = p.bodyB.velocity;
    const imp = Math.hypot(va.x - vb.x, va.y - vb.y);
    const sup = p.collision.supports?.[0] ?? p.bodyA.position;
    this.pendingHits.push({ a: label(p.bodyA), b: label(p.bodyB), impulse: imp, x: sup.x, y: sup.y });
    return imp;
  }

  /** Контакт в навесном режиме: удар (звук, пыль) и подпрыгивание асыка от сақа. */
  private onContact(p: MPair): void {
    const imp = this.recordHit(p);
    const a = this.bodies.get(label(p.bodyA));
    const b = this.bodies.get(label(p.bodyB));
    if (!a || !b) return;
    const saka = a.kind === 'saka' ? a : b.kind === 'saka' ? b : null;
    const other = saka === a ? b : a;
    if (!saka || other.kind !== 'asyk' || airborne(other)) return;
    // body.velocity у Matter — смещение за подшаг; в px/шаг ×SUBSTEPS
    const vz = popVz(imp * SUBSTEPS, other.type);
    if (vz > 0) other.vz = vz;
  }

  /** Сталкиваются ли тела пары с учётом высоты. Стены: сақа в воздухе пролетает (перелёт), асыки — нет. */
  private pairSolid(p: MPair): boolean {
    const la = label(p.bodyA);
    const lb = label(p.bodyB);
    if (la === 'wall' || lb === 'wall') {
      const o = this.bodies.get(la === 'wall' ? lb : la);
      return !o || o.kind !== 'saka' || o.z <= LOFT.MARGIN_Z;
    }
    const a = this.bodies.get(la);
    const b = this.bodies.get(lb);
    if (!a || !b) return true;
    return heightOverlap(a.z, a.h, b.z, b.h);
  }

  /** Перед подшагом Matter: существующим парам выставляем «сенсор» по текущей высоте. */
  private syncPairs(): void {
    for (const p of this.engine.pairs.list as MPair[]) {
      const solid = this.pairSolid(p);
      const was = p.isSensor;
      p.isSensor = !solid;
      if (was && solid) this.onContact(p); // сақа опустилась на асык — это начало контакта
    }
  }

  private makeBody(id: string, kind: 'asyk' | 'saka', type: AsykType, body: MBody): SimBody {
    return {
      id,
      kind,
      type,
      body,
      scored: false,
      scoredTick: -1,
      removed: false,
      z: 0,
      vz: 0,
      h: thickness(kind, type),
      groundAir: body.frictionAir,
    };
  }

  addAsyk(id: string, spec: AsykSpec): SimBody {
    const type = spec.type ?? 'normal';
    const body = createAsykBody(this.M, id, spec.x, spec.y, spec.angle, type);
    this.M.Composite.add(this.engine.world, body);
    const sb = this.makeBody(id, 'asyk', type, body);
    this.bodies.set(id, sb);
    return sb;
  }

  /**
   * Новая сақа на линии броска; velocity в px за шаг 1/60 с.
   * Навесной режим: vz — вертикальная скорость, z0 — стартовая высота.
   */
  launchSaka(vx: number, vy: number, angle = 0, vz = 0, z0 = 0): SimBody {
    this.dropSaka();
    const body = createSakaBody(this.M, 'saka', SAKA_START.x, SAKA_START.y, angle);
    body.deltaTime = SUB_DELTA;
    this.M.Composite.add(this.engine.world, body);
    this.M.Body.setVelocity(body, { x: vx, y: vy });
    this.saka = this.makeBody('saka', 'saka', 'normal', body);
    if (this.loft) {
      this.saka.z = z0;
      this.saka.vz = vz;
    }
    this.bodies.set('saka', this.saka);
    this.throwTick = this.tick;
    this.timedOut = false;
    this.overshoot = false;
    this.stillTicks = 0;
    return this.saka;
  }

  dropSaka(): void {
    if (this.saka) {
      this.M.Composite.remove(this.engine.world, this.saka.body);
      this.bodies.delete('saka');
      this.saka = null;
    }
  }

  /** Активные (не удалённые) асыки. */
  asyks(): SimBody[] {
    return [...this.bodies.values()].filter((b) => b.kind === 'asyk' && !b.removed);
  }

  /** Выбиваемые асыки, ещё стоящие в коне (блоки не в счёте). */
  standing(): SimBody[] {
    return this.asyks().filter((b) => !b.scored && b.type !== 'block');
  }

  /** Вертикальный шаг до Matter: интегрирование, приземление (отскок, потеря горизонтальной скорости), сопротивление. */
  private verticalStep(landed: LandEvent[]): void {
    const M = this.M;
    for (const sb of this.bodies.values()) {
      if (sb.removed || sb.type === 'block') continue;
      const l = integrate(sb, sb.kind);
      if (l) {
        const v = M.Body.getVelocity(sb.body);
        M.Body.setVelocity(sb.body, { x: v.x * l.hKeep, y: v.y * l.hKeep });
        landed.push({ id: sb.id, impact: l.impact, x: sb.body.position.x, y: sb.body.position.y });
      }
      sb.body.frictionAir = airborne(sb) ? LOFT.AIR_DRAG_FLIGHT : sb.groundAir;
    }
  }

  /** Один шаг физики 1/60 с (внутри — SUBSTEPS подшагов). */
  step(): StepResult {
    const M = this.M;
    const landed: LandEvent[] = [];
    if (this.loft) this.verticalStep(landed);
    for (let i = 0; i < SUBSTEPS; i++) {
      if (this.loft) this.syncPairs();
      M.Engine.update(this.engine, SUB_DELTA);
      const maxSpeed = this.loft ? LOFT.MAX_SPEED : MAX_BODY_SPEED;
      for (const sb of this.bodies.values()) {
        const b = sb.body;
        if (b.speed > maxSpeed) {
          const k = maxSpeed / b.speed;
          M.Body.setVelocity(b, { x: b.velocity.x * k, y: b.velocity.y * k });
        }
      }
    }
    this.tick++;

    const newlyScored: string[] = [];
    const removed: string[] = [];
    for (const sb of this.bodies.values()) {
      if (sb.kind !== 'asyk' || sb.removed || sb.type === 'block') continue;
      if (!sb.scored) {
        const p = sb.body.position;
        // «Выбит»: центр вышел за границу кона (по плоскости, в том числе в воздухе). Один раз, навсегда.
        if (Math.hypot(p.x - this.zone.x, p.y - this.zone.y) > this.zone.r) {
          sb.scored = true;
          sb.scoredTick = this.tick;
          newlyScored.push(sb.id);
        }
      } else if (this.tick - sb.scoredTick >= OUT_TICKS) {
        sb.removed = true;
        M.Composite.remove(this.engine.world, sb.body);
        removed.push(sb.id);
      }
    }

    // перелёт: сақа в воздухе ушла за поле — бросок потрачен, сақа исчезает
    let overshoot = false;
    const sk = this.saka;
    if (this.loft && sk && sk.z > LOFT.MARGIN_Z) {
      const p = sk.body.position;
      if (p.x < 0 || p.x > FIELD_W || p.y < 0 || p.y > FIELD_H) {
        overshoot = true;
        this.overshoot = true;
        this.dropSaka();
        removed.push('saka');
      }
    }

    // остановка
    if (this.throwTick >= 0 && !this.timedOut) {
      if (this.tick - this.throwTick >= TIMEOUT_TICKS) {
        this.forceStop();
        this.timedOut = true;
      } else if (this.allStill()) this.stillTicks++;
      else this.stillTicks = 0;
    }

    const hits = this.pendingHits;
    this.pendingHits = [];
    return { hits, newlyScored, removed, landed, overshoot };
  }

  private allStill(): boolean {
    for (const sb of this.bodies.values()) {
      if (sb.removed) continue;
      if (sb.kind === 'asyk' && sb.scored) return false; // ждём удаления
      if (this.loft && airborne(sb)) return false;
      if (!isSettledNow(sb.body.speed, sb.body.angularSpeed, SETTLE_SPEED, SETTLE_ANGULAR)) return false;
    }
    return true;
  }

  /** Все тела стоят дольше SETTLE_HOLD_MS или сработал тайм-аут. */
  get settled(): boolean {
    return this.throwTick >= 0 && (this.timedOut || this.stillTicks >= HOLD_TICKS);
  }

  /** Принудительная остановка (тайм-аут): обнуляем скорости всех тел (и высоту в навесном режиме). */
  forceStop(): void {
    for (const sb of this.bodies.values()) {
      this.M.Body.setVelocity(sb.body, { x: 0, y: 0 });
      this.M.Body.setAngularVelocity(sb.body, 0);
      sb.z = 0;
      sb.vz = 0;
      sb.body.frictionAir = sb.groundAir;
    }
  }

  /** Завершить ход: сбросить счётчики остановки (сақа остаётся до удаления сценой). */
  endThrow(): void {
    this.throwTick = -1;
    this.stillTicks = 0;
    this.timedOut = false;
  }

  /** Снимок положений тел (для тестов «render-isolation»); в навесном режиме — с высотой. */
  snapshot(): { id: string; x: number; y: number; a: number; z?: number }[] {
    return [...this.bodies.values()]
      .filter((b) => !b.removed)
      .map((b) =>
        this.loft
          ? { id: b.id, x: b.body.position.x, y: b.body.position.y, a: b.body.angle, z: b.z }
          : { id: b.id, x: b.body.position.x, y: b.body.position.y, a: b.body.angle },
      )
      .sort((p, q) => (p.id < q.id ? -1 : 1));
  }
}

const label = (b: MBody): string => (b.parent ?? b).label;
