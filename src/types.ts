export type Lang = 'ru' | 'kk' | 'en';
export type Quality = 'auto' | 'high' | 'low';
export type GameMode = 'campaign' | 'training' | 'versus' | 'daily' | 'endless' | 'duel' | 'custom';
export type Difficulty = 'easy' | 'normal';
export type BotLevel = 'easy' | 'normal' | 'hard';

/** Тип тела в кону. block — статичное препятствие (не выбивается, очков не даёт). */
export type AsykType = 'normal' | 'golden' | 'heavy' | 'block';

export interface AsykSpec {
  x: number;
  y: number;
  /** угол в радианах */
  angle: number;
  type?: AsykType;
  /** стабильный id (нужен при восстановлении раунда); по умолчанию a<индекс> */
  id?: string;
}

export interface ZoneSpec {
  x: number;
  y: number;
  r: number;
}

export interface LevelDef {
  id: number;
  nameKey: string;
  /** пользовательское название (свои испытания, вызовы) */
  name?: string;
  /** число бросков; Infinity — без лимита (обучение) */
  throws: number;
  /** ожидаемое число бросков для 3★; null — не применяется */
  par: number | null;
  zone: ZoneSpec;
  asyks: AsykSpec[];
}

export interface LevelStat {
  best: number;
  stars: 0 | 1 | 2 | 3;
  plays: number;
}

/** Схема v1 (для миграции). */
export interface SaveV1 {
  v: 1;
  lang: Lang;
  sound: boolean;
  quality: Quality;
  tutorialDone: boolean;
  unlocked: number;
  levels: Record<string, LevelStat>;
  stats: { throws: number; asyksOut: number; hits: number };
  daily: Record<string, { best: number }>;
  playerNames: [string, string];
}

/** Состояние раунда (чистые данные) — для «Продолжить». */
export interface RoundSnapshot {
  throwsUsed: number;
  scores: [number, number];
  player: 0 | 1;
  versusThrows: [number, number];
  bestCombo: number;
  scoredIds: string[];
  asykTotal: number;
}

export interface ResumeState {
  v: 1;
  ts: number;
  mode: GameMode;
  levelId: number;
  /** оставшиеся асыки/блоки с исходными id; throws=null — без лимита */
  level: {
    id: number;
    nameKey: string;
    name?: string;
    throws: number | null;
    par: number | null;
    zone: ZoneSpec;
    asyks: AsykSpec[];
  };
  round: RoundSnapshot;
  extra: {
    wave?: number;
    runSeed?: number;
    totalScore?: number;
    reserve?: number;
    botLevel?: BotLevel;
    dailyKey?: string;
    challengeScore?: number;
    challengeName?: string;
  };
}

export interface ResultEntry {
  ts: number;
  mode: GameMode;
  ref: string;
  score: number;
  stars: number;
  throws: number;
  combo: number;
}

export interface CustomLevel {
  id: string;
  name: string;
  /** компактный код (см. challenge/codec.ts) */
  code: string;
  /** автор прошёл своё испытание — можно делиться */
  verified: boolean;
  ts: number;
}

export interface Counters {
  hitStreak: number;
  bestCombo: number;
  goldenOut: number;
  shared: number;
  botWinsHard: number;
}

export interface SaveV2 extends Omit<SaveV1, 'v'> {
  v: 2;
  resume: ResumeState | null;
  history: ResultEntry[];
  achievements: Record<string, number>;
  coins: number;
  owned: string[];
  equipped: { saka: string; theme: string; asyk: string };
  pro: boolean;
  endlessBest: { score: number; wave: number };
  difficulty: Difficulty;
  vibration: boolean;
  customLevels: CustomLevel[];
  dailyStreak: { last: string; count: number };
  seenHints: string[];
  counters: Counters;
}
