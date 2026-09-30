import type { BotLevel, GameMode, LoftLevel, Ruleset } from './types';
import type { GameState } from './game/rules/turnState';
import type { RoundSummary } from './game/rules/round';
import type { Key } from './i18n';

/** Запрос на старт раунда (UI → игра). */
export interface StartRequest {
  mode: GameMode;
  levelId: number;
  /** код своего испытания / вызова друга (mode custom) */
  code?: string;
  /** короткий id вызова из облака (#k=…) */
  shortId?: string;
  /** режим custom запущен из редактора («Проверить») */
  editorTest?: boolean;
  /** результат друга, который нужно побить */
  challengeScore?: number;
  challengeName?: string;
  /** ежедневное: конкретная дата (вызов по ссылке) */
  dailyKey?: string;
  /** дуэль: сложность бота */
  botLevel?: BotLevel;
  /** бесконечный: seed забега (вызов по ссылке) */
  runSeed?: number;
  /** набор правил (вызов по ссылке задаёт его принудительно) */
  ruleset?: Ruleset;
}

export interface HudData {
  mode: GameMode;
  levelId: number;
  /** название пользовательского испытания */
  name?: string;
  score: number;
  /** оставшиеся броски; Infinity — без лимита */
  throwsLeft: number;
  throwsTotal: number;
  asyksLeft: number;
  asykTotal: number;
  /** режим вдвоём / дуэль */
  player: 0 | 1;
  scores: [number, number];
  versusLeft: [number, number];
  /** бесконечный режим */
  wave?: number;
  botLevel?: BotLevel;
  botThinking?: boolean;
  /** набор правил раунда и выбранная высота броска */
  ruleset: Ruleset;
  loft: LoftLevel;
  /** подсказка у линии броска (до первого броска) */
  showHint: boolean;
}

export interface ResultData {
  summary: RoundSummary;
  mode: GameMode;
  levelId: number;
  name?: string;
  newRecord: boolean;
  bestStars: 0 | 1 | 2 | 3;
  hasNext: boolean;
  /** ежедневное: лучший результат за дату */
  dailyBest?: number;
  dailyKey?: string;
  /** бесконечный режим */
  endless?: { wave: number; total: number; best: number; newBest: boolean; runSeed: number };
  /** вызов друга / свои испытания */
  challenge?: { code?: string; shortId?: string; friendName?: string; friendScore?: number };
  editorTest?: boolean;
  botLevel?: BotLevel;
  ruleset: Ruleset;
  /** сколько тиын получено за раунд (включая достижения) */
  coins: number;
}

/** Типизированные события: UI ↔ игра. UI не знает о Phaser, игра не знает о DOM-экранах. */
export interface BusEvents {
  // UI → игра
  start: StartRequest;
  continue: undefined;
  restart: undefined;
  next: undefined;
  pause: undefined;
  resume: undefined;
  toMenu: undefined;
  skipTutorial: undefined;
  settings: undefined;
  /** пере-запечь оформление (сақа/площадка/асыки) */
  look: undefined;
  // игра → UI
  hud: HudData;
  state: GameState;
  tutorial: { step: number }; // -1 — скрыть
  turn: { player: 0 | 1 };
  result: ResultData;
  float: { x: number; y: number; text: string; kind: 'pts' | 'combo' };
  banner: { key: Key; params?: Record<string, string | number> };
  /** первое появление нового типа тела */
  hint: { type: 'golden' | 'heavy' | 'block' | 'loft' };
  achievement: { id: string };
  toast: { key: Key; params?: Record<string, string | number> };
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
