/**
 * Конечный автомат игры — единый источник истины. Без Phaser и DOM (тестируется в Node).
 *
 * MENU → LEVEL_INTRO → AIMING → FLYING → SETTLING → RESOLVING → (AIMING | LEVEL_COMPLETE | LEVEL_FAILED)
 * PAUSED — из любого игрового состояния, возврат в то же.
 */
export type GameState =
  | 'MENU'
  | 'LEVEL_INTRO'
  | 'AIMING'
  | 'FLYING'
  | 'SETTLING'
  | 'RESOLVING'
  | 'LEVEL_COMPLETE'
  | 'LEVEL_FAILED'
  | 'PAUSED';

const ALLOWED: Record<GameState, GameState[]> = {
  MENU: ['LEVEL_INTRO'],
  LEVEL_INTRO: ['AIMING', 'MENU'],
  AIMING: ['FLYING', 'PAUSED', 'LEVEL_INTRO', 'MENU'],
  FLYING: ['SETTLING', 'PAUSED'],
  SETTLING: ['RESOLVING', 'PAUSED'],
  RESOLVING: ['AIMING', 'LEVEL_COMPLETE', 'LEVEL_FAILED', 'PAUSED'],
  LEVEL_COMPLETE: ['LEVEL_INTRO', 'MENU'],
  LEVEL_FAILED: ['LEVEL_INTRO', 'MENU'],
  PAUSED: ['AIMING', 'FLYING', 'SETTLING', 'RESOLVING', 'LEVEL_INTRO', 'MENU'],
};

export function canTransition(from: GameState, to: GameState): boolean {
  return ALLOWED[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(from: GameState, to: GameState) {
    super(`Invalid transition ${from} → ${to}`);
  }
}

export class StateMachine {
  state: GameState = 'MENU';
  private resumeTo: GameState = 'AIMING';
  /** dev: недопустимый переход — ошибка; prod: молча игнорируется. */
  constructor(private readonly strict: boolean = Boolean(import.meta.env?.DEV)) {}

  /** Возвращает true, если переход выполнен. */
  go(to: GameState): boolean {
    if (to === this.state) return false;
    if (!canTransition(this.state, to)) {
      if (this.strict) throw new InvalidTransitionError(this.state, to);
      return false;
    }
    // Возврат из паузы допустим только в то состояние, из которого вошли (или в рестарт/меню).
    if (this.state === 'PAUSED' && to !== 'LEVEL_INTRO' && to !== 'MENU' && to !== this.resumeTo) {
      if (this.strict) throw new InvalidTransitionError(this.state, to);
      return false;
    }
    if (to === 'PAUSED') this.resumeTo = this.state;
    this.state = to;
    return true;
  }

  pause(): boolean {
    return this.go('PAUSED');
  }

  resume(): boolean {
    return this.state === 'PAUSED' ? this.go(this.resumeTo) : false;
  }
}

export type AfterThrow = 'AIMING' | 'LEVEL_COMPLETE' | 'LEVEL_FAILED';

/** Что происходит после подсчёта очков броска. */
export function nextAfterThrow(asyksLeft: number, throwsLeft: number): AfterThrow {
  if (asyksLeft <= 0) return 'LEVEL_COMPLETE';
  if (throwsLeft <= 0) return 'LEVEL_FAILED';
  return 'AIMING';
}

export type Player = 0 | 1;

/** Режим вдвоём: игроки чередуются 0,1,0,1… */
export function nextPlayer(p: Player): Player {
  return p === 0 ? 1 : 0;
}
