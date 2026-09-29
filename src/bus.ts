import type { GameMode } from './types';
import type { GameState } from './game/rules/turnState';
import type { RoundSummary } from './game/rules/round';

export interface HudData {
  mode: GameMode;
  levelId: number;
  score: number;
  /** оставшиеся броски; Infinity — без лимита */
  throwsLeft: number;
  throwsTotal: number;
  asyksLeft: number;
  asykTotal: number;
  /** режим вдвоём */
  player: 0 | 1;
  scores: [number, number];
  versusLeft: [number, number];
  /** подсказка у линии броска (до первого броска) */
  showHint: boolean;
}

export interface ResultData {
  summary: RoundSummary;
  levelId: number;
  newRecord: boolean;
  bestStars: 0 | 1 | 2 | 3;
  hasNext: boolean;
  /** ежедневное: лучший результат за дату */
  dailyBest?: number;
}

/** Типизированные события: UI ↔ игра. UI не знает о Phaser, игра не знает о DOM-экранах. */
export interface BusEvents {
  // UI → игра
  start: { mode: GameMode; levelId: number };
  restart: undefined;
  next: undefined;
  pause: undefined;
  resume: undefined;
  toMenu: undefined;
  skipTutorial: undefined;
  settings: undefined;
  // игра → UI
  hud: HudData;
  state: GameState;
  tutorial: { step: number }; // -1 — скрыть
  turn: { player: 0 | 1 } ;
  result: ResultData;
  float: { x: number; y: number; text: string; kind: 'pts' | 'combo' };
  toast: { key: string; params?: Record<string, string | number> };
}

type Handler<T> = (payload: T) => void;

export class Bus<E extends object> {
  private handlers: { [K in keyof E]?: Handler<E[K]>[] } = {};

  on<K extends keyof E>(event: K, fn: Handler<E[K]>): () => void {
    (this.handlers[event] ??= []).push(fn);
    return () => {
      this.handlers[event] = (this.handlers[event] ?? []).filter((h) => h !== fn);
    };
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    for (const h of [...(this.handlers[event] ?? [])]) h(payload);
  }
}

export const bus = new Bus<BusEvents>();
