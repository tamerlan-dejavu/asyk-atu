import { ASYK_VALUE, VERSUS_THROWS_EACH } from '../config';
import type { GameMode, LevelDef, RoundSnapshot } from '../../types';
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
  /** режим вдвоём/дуэль: 0/1 — победитель, -1 — ничья, null — не вдвоём */
  winner: 0 | 1 | -1 | null;
}

export interface ResolveResult {
  outcome: ThrowOutcome;
  player: Player;
  next: AfterThrow;
  /** сколько золотых асыков выбито этим броском (для достижений) */
  goldenOut: number;
}

export interface RoundOptions {
  /** дополнительные броски (режим «Лёгкий») */
  bonusThrows?: number;
  /** восстановление раунда после перезагрузки */
  snapshot?: RoundSnapshot;
}

export const specId = (spec: { id?: string }, index: number): string => spec.id ?? `a${index}`;

/**
 * Состояние одного раунда (кампания / тренировка / вдвоём / дуэль / ежедневное / бесконечный / свои).
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
  private readonly values = new Map<string, number>();
  private readonly types = new Map<string, string>();
  private readonly extraThrows: number;

  constructor(
    readonly mode: GameMode,
    readonly level: LevelDef,
    opts: RoundOptions = {},
  ) {
    let total = 0;
    level.asyks.forEach((a, i) => {
      const id = specId(a, i);
      const type = a.type ?? 'normal';
      this.values.set(id, ASYK_VALUE[type]);
      this.types.set(id, type);
      if (type !== 'block') total++;
    });
    this.extraThrows = opts.bonusThrows ?? 0;
    const s = opts.snapshot;
    if (s) {
      this.asykTotal = s.asykTotal;
      this.throwsUsed = s.throwsUsed;
      this.bestCombo = s.bestCombo;
      this.player = s.player;
      this.scores[0] = s.scores[0];
      this.scores[1] = s.scores[1];
      this.versusThrows[0] = s.versusThrows[0];
      this.versusThrows[1] = s.versusThrows[1];
      this.keeper.restore(s.scoredIds);
    } else {
      this.asykTotal = total;
    }
  }

  get isVersus(): boolean {
    return this.mode === 'versus' || this.mode === 'duel';
  }

  get infinite(): boolean {
    return this.mode === 'training' || !Number.isFinite(this.level.throws);
  }

  get throwsAllowed(): number {
    return this.infinite ? Infinity : this.level.throws + (this.isVersus ? 0 : this.extraThrows);
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
    return this.isVersus ? this.scores[0] + this.scores[1] : this.scores[0];
  }

  typeOf(id: string): string {
    return this.types.get(id) ?? 'normal';
  }

  valueOf(id: string): number {
    return this.values.get(id) ?? ASYK_VALUE.normal;
  }

  /** Бросок совершён (AIMING → FLYING). */
  beginThrow(): void {
    this.throwsUsed++;
    if (this.isVersus) this.versusThrows[this.player]++;
    this.machine.go('FLYING');
  }

  /** Подсчёт очков после остановки тел. outIds — тела, вышедшие за кон за этот бросок (блоки игнорируются). */
  resolveThrow(outIds: string[]): ResolveResult {
    const real = outIds.filter((id) => this.typeOf(id) !== 'block');
    const outcome = this.keeper.registerThrow(real, (id) => this.valueOf(id));
    const who = this.player;
    this.scores[who] += outcome.points;
    this.bestCombo = Math.max(this.bestCombo, outcome.k);
    const goldenOut = outcome.ids.filter((id) => this.typeOf(id) === 'golden').length;

    let next: AfterThrow;
    if (this.isVersus) {
      const throwsLeft = 2 * VERSUS_THROWS_EACH - this.throwsUsed;
      next = nextAfterThrow(this.asyksLeft, throwsLeft);
      // в «вдвоём» раунд всегда завершается «итогом», а не поражением
      if (next === 'LEVEL_FAILED') next = 'LEVEL_COMPLETE';
      if (next === 'AIMING') this.player = nextPlayer(this.player);
    } else {
      next = nextAfterThrow(this.asyksLeft, this.throwsLeft);
    }
    return { outcome, player: who, next, goldenOut };
  }

  /** Данные для сохранения между бросками («Продолжить»). */
  snapshot(): RoundSnapshot {
    return {
      throwsUsed: this.throwsUsed,
      scores: [this.scores[0], this.scores[1]],
      player: this.player,
      versusThrows: [this.versusThrows[0], this.versusThrows[1]],
      bestCombo: this.bestCombo,
      scoredIds: this.keeper.ids(),
      asykTotal: this.asykTotal,
    };
  }

  summary(): RoundSummary {
    const cleared = this.asyksLeft === 0;
    const withBonus = this.mode === 'campaign' || this.mode === 'endless' || this.mode === 'custom';
    const bonus = withBonus ? economyBonus(this.throwsLeft, cleared) : 0;
    const scores: [number, number] = [this.scores[0], this.scores[1]];
    if (!this.isVersus) scores[0] += bonus;
    let winner: RoundSummary['winner'] = null;
    if (this.isVersus) winner = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : -1;
    const starsMode = this.mode === 'campaign' || this.mode === 'custom' || this.mode === 'training';
    return {
      mode: this.mode,
      cleared,
      score: this.isVersus ? scores[0] + scores[1] : scores[0],
      bonus,
      asykTotal: this.asykTotal,
      asykOut: this.keeper.count,
      throwsUsed: this.throwsUsed,
      throwsAllowed: this.throwsAllowed,
      bestCombo: this.bestCombo,
      stars: starsMode ? starsFor(cleared, this.throwsUsed, this.level.par) : 0,
      scores,
      winner,
    };
  }
}
