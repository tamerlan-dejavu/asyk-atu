import { VERSUS_THROWS_EACH } from '../config';
import type { GameMode, LevelDef } from '../../types';
import { economyBonus, ScoreKeeper, type ThrowOutcome } from './scoring';
import { starsFor } from './stars';
import { nextAfterThrow, nextPlayer, StateMachine, type AfterThrow, type Player } from './turnState';

export interface RoundSummary {
  mode: GameMode;
  cleared: boolean;
  score: number;
  bonus: number;
  asykTotal: number;
  asykOut: number;
  throwsUsed: number;
  throwsAllowed: number;
  bestCombo: number;
  stars: 0 | 1 | 2 | 3;
  scores: [number, number];
  /** режим вдвоём: 0/1 — победитель, -1 — ничья, null — не вдвоём */
  winner: 0 | 1 | -1 | null;
}

export interface ResolveResult {
  outcome: ThrowOutcome;
  player: Player;
  next: AfterThrow;
}

/**
 * Состояние одного раунда (кампания / тренировка / вдвоём / ежедневное).
 * Чистая логика: Phaser сообщает «бросок сделан» и «вот кто вылетел», Round считает.
 */
export class Round {
  readonly machine = new StateMachine();
  readonly keeper = new ScoreKeeper();
  readonly asykTotal: number;
  throwsUsed = 0;
  bestCombo = 0;
  player: Player = 0;
  readonly scores: [number, number] = [0, 0];
  private readonly versusThrows: [number, number] = [0, 0];

  constructor(
    readonly mode: GameMode,
    readonly level: LevelDef,
  ) {
    this.asykTotal = level.asyks.length;
  }

  get infinite(): boolean {
    return this.mode === 'training' || !Number.isFinite(this.level.throws);
  }

  get throwsAllowed(): number {
    return this.infinite ? Infinity : this.level.throws;
  }

  get throwsLeft(): number {
    return this.infinite ? Infinity : this.throwsAllowed - this.throwsUsed;
  }

  /** Броски, оставшиеся у конкретного игрока (режим вдвоём). */
  versusThrowsLeft(p: Player): number {
    return VERSUS_THROWS_EACH - this.versusThrows[p];
  }

  get asyksLeft(): number {
    return this.asykTotal - this.keeper.count;
  }

  get score(): number {
    return this.mode === 'versus' ? this.scores[0] + this.scores[1] : this.scores[0];
  }

  /** Бросок совершён (AIMING → FLYING). */
  beginThrow(): void {
    this.throwsUsed++;
    if (this.mode === 'versus') this.versusThrows[this.player]++;
    this.machine.go('FLYING');
  }

  /** Подсчёт очков после остановки тел. `outIds` — асыки, вышедшие за кон за этот бросок. */
  resolveThrow(outIds: string[]): ResolveResult {
    const outcome = this.keeper.registerThrow(outIds);
    const who = this.player;
    this.scores[who] += outcome.points;
    this.bestCombo = Math.max(this.bestCombo, outcome.k);

    let next: AfterThrow;
    if (this.mode === 'versus') {
      const throwsLeft = 2 * VERSUS_THROWS_EACH - this.throwsUsed;
      next = nextAfterThrow(this.asyksLeft, throwsLeft);
      // в «вдвоём» раунд всегда завершается «итогом», а не поражением
      if (next === 'LEVEL_FAILED') next = 'LEVEL_COMPLETE';
      if (next === 'AIMING') this.player = nextPlayer(this.player);
    } else {
      next = nextAfterThrow(this.asyksLeft, this.throwsLeft);
    }
    return { outcome, player: who, next };
  }

  summary(): RoundSummary {
    const cleared = this.asyksLeft === 0;
    const bonus = this.mode === 'campaign' ? economyBonus(this.throwsLeft, cleared) : 0;
    const scores: [number, number] = [this.scores[0], this.scores[1]];
    if (this.mode !== 'versus') scores[0] += bonus;
    let winner: RoundSummary['winner'] = null;
    if (this.mode === 'versus') winner = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : -1;
    return {
      mode: this.mode,
      cleared,
      score: this.mode === 'versus' ? scores[0] + scores[1] : scores[0],
      bonus,
      asykTotal: this.asykTotal,
      asykOut: this.keeper.count,
      throwsUsed: this.throwsUsed,
      throwsAllowed: this.throwsAllowed,
      bestCombo: this.bestCombo,
      stars: this.mode === 'versus' ? 0 : starsFor(cleared, this.throwsUsed, this.level.par),
      scores,
      winner,
    };
  }
}
