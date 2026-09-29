export type Lang = 'ru' | 'kk' | 'en';
export type Quality = 'auto' | 'high' | 'low';
export type GameMode = 'campaign' | 'training' | 'versus' | 'daily';

export interface AsykSpec {
  x: number;
  y: number;
  /** угол в радианах */
  angle: number;
}

export interface ZoneSpec {
  x: number;
  y: number;
  r: number;
}

export interface LevelDef {
  id: number;
  nameKey: string;
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
