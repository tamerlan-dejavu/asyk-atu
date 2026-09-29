import {
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
import type { AsykSpec, ZoneSpec } from '../../types';
import { createAsykBody, createSakaBody, createWalls, type MatterNS, type MBody } from './bodies';
import { isSettledNow } from './settle';

export interface SimBody {
  id: string;
  kind: 'asyk' | 'saka';
  body: MBody;
  scored: boolean;
  /** тик, когда асык был засчитан (для удаления через OUT_FADE_MS) */
  scoredTick: number;
  removed: boolean;
}

export interface HitEvent {
  a: string;
  b: string; // id или 'wall'
  /** относительная скорость столкнувшихся тел, px/шаг — мера силы удара */
  impulse: number;
  x: number;
  y: number;
}

export interface StepResult {
  hits: HitEvent[];
  newlyScored: string[];
  removed: string[];
}

const SUB_DELTA = STEP_MS / SUBSTEPS;
const OUT_TICKS = Math.round(OUT_FADE_MS / STEP_MS);
const HOLD_TICKS = Math.round(SETTLE_HOLD_MS / STEP_MS);
const TIMEOUT_TICKS = Math.round(TURN_TIMEOUT_MS / STEP_MS);

/**
 * Физический мир без Phaser: тестируется в Node, а Phaser только рисует его состояние.
 * Шаг фиксированный (1/60 с, SUBSTEPS подшагов) — результат не зависит от FPS.
 * Никакой случайности и никаких визуальных параметров здесь нет.
 */
export class Sim {
  readonly engine: MBody;
  readonly bodies = new Map<string, SimBody>();
  tick = 0;
  saka: SimBody | null = null;
  /** тик броска (для тайм-аута и тишины) */
  throwTick = -1;
  timedOut = false;
  private stillTicks = 0;
  private pendingHits: HitEvent[] = [];

  constructor(
    private readonly M: MatterNS,
    readonly zone: ZoneSpec,
  ) {
    this.engine = M.Engine.create({
      gravity: { x: 0, y: 0, scale: 0 },
      positionIterations: POSITION_ITERATIONS,
      velocityIterations: VELOCITY_ITERATIONS,
      enableSleeping: false,
    });
    M.Composite.add(this.engine.world, createWalls(M));
    M.Events.on(this.engine, 'collisionStart', (e: { pairs: { bodyA: MBody; bodyB: MBody; collision: { supports: { x: number; y: number }[] } }[] }) => {
      for (const p of e.pairs) {
        const va = p.bodyA.velocity;
        const vb = p.bodyB.velocity;
        const imp = Math.hypot(va.x - vb.x, va.y - vb.y);
        const sup = p.collision.supports?.[0] ?? p.bodyA.position;
        const a = p.bodyA.label;
        const b = p.bodyB.label;
        this.pendingHits.push({ a, b, impulse: imp, x: sup.x, y: sup.y });
      }
    });
  }

  addAsyk(id: string, spec: AsykSpec): SimBody {
    const body = createAsykBody(this.M, id, spec.x, spec.y, spec.angle);
    this.M.Composite.add(this.engine.world, body);
    const sb: SimBody = { id, kind: 'asyk', body, scored: false, scoredTick: -1, removed: false };
    this.bodies.set(id, sb);
    return sb;
  }

  /** Новая сақа на линии броска. Возвращает тело; velocity в px за шаг 1/60 с. */
  launchSaka(vx: number, vy: number, angle = 0): SimBody {
    this.dropSaka();
    const body = createSakaBody(this.M, 'saka', SAKA_START.x, SAKA_START.y, angle);
    body.deltaTime = SUB_DELTA;
    this.M.Composite.add(this.engine.world, body);
    this.M.Body.setVelocity(body, { x: vx, y: vy });
    this.saka = { id: 'saka', kind: 'saka', body, scored: false, scoredTick: -1, removed: false };
    this.bodies.set('saka', this.saka);
    this.throwTick = this.tick;
    this.timedOut = false;
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

  /** Асыки, ещё стоящие в коне (не засчитанные). */
  standing(): SimBody[] {
    return this.asyks().filter((b) => !b.scored);
  }

  /** Один шаг физики 1/60 с (внутри — SUBSTEPS подшагов). */
  step(): StepResult {
    const M = this.M;
    for (let i = 0; i < SUBSTEPS; i++) {
      M.Engine.update(this.engine, SUB_DELTA);
      for (const sb of this.bodies.values()) {
        const b = sb.body;
        if (b.speed > MAX_BODY_SPEED) {
          const k = MAX_BODY_SPEED / b.speed;
          M.Body.setVelocity(b, { x: b.velocity.x * k, y: b.velocity.y * k });
        }
      }
    }
    this.tick++;

    const newlyScored: string[] = [];
    const removed: string[] = [];
    for (const sb of this.bodies.values()) {
      if (sb.kind !== 'asyk' || sb.removed) continue;
      if (!sb.scored) {
        const p = sb.body.position;
        // «Выбит»: центр вышел за границу кона. Один раз, навсегда.
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
    return { hits, newlyScored, removed };
  }

  private allStill(): boolean {
    for (const sb of this.bodies.values()) {
      if (sb.removed) continue;
      if (sb.kind === 'asyk' && sb.scored) return false; // ждём удаления
      if (!isSettledNow(sb.body.speed, sb.body.angularSpeed, SETTLE_SPEED, SETTLE_ANGULAR)) return false;
    }
    return true;
  }

  /** Все тела стоят дольше SETTLE_HOLD_MS или сработал тайм-аут. */
  get settled(): boolean {
    return this.throwTick >= 0 && (this.timedOut || this.stillTicks >= HOLD_TICKS);
  }

  /** Принудительная остановка (тайм-аут): обнуляем скорости всех тел. */
  forceStop(): void {
    for (const sb of this.bodies.values()) {
      this.M.Body.setVelocity(sb.body, { x: 0, y: 0 });
      this.M.Body.setAngularVelocity(sb.body, 0);
    }
  }

  /** Завершить ход: сбросить счётчики остановки (сақа остаётся до удаления сценой). */
  endThrow(): void {
    this.throwTick = -1;
    this.stillTicks = 0;
    this.timedOut = false;
  }

  /** Снимок положений тел (для тестов «render-isolation»). */
  snapshot(): { id: string; x: number; y: number; a: number }[] {
    return [...this.bodies.values()]
      .filter((b) => !b.removed)
      .map((b) => ({ id: b.id, x: b.body.position.x, y: b.body.position.y, a: b.body.angle }))
      .sort((p, q) => (p.id < q.id ? -1 : 1));
  }
}
