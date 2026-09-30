import type {
  AsykSpec,
  AsykType,
  BotLevel,
  Counters,
  CustomLevel,
  Difficulty,
  GameMode,
  Lang,
  LevelStat,
  Quality,
  ResultEntry,
  ResumeState,
  SaveV2,
} from '../types';

export const SAVE_KEY = 'asyk-atu:v1';
export const BACKUP_KEY = 'asyk-atu:backup';
export const BACKUP_V1_KEY = 'asyk-atu:backup-v1';
/** Время последнего локального изменения (для слияния с облаком). */
export const UPDATED_KEY = 'asyk-atu:updated';
/** Последний уровень основной кампании (главы «Двор» и «Дала»). */
export const MAX_LEVEL = 10;
/** Последний из дополнительных (Pro) уровней. */
export const MAX_PRO_LEVEL = 15;
export const HISTORY_LIMIT = 50;
export const CUSTOM_LIMIT = 20;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultCounters(): Counters {
  return { hitStreak: 0, bestCombo: 0, goldenOut: 0, shared: 0, botWinsHard: 0 };
}

export function defaultSave(): SaveV2 {
  return {
    v: 2,
    lang: 'ru',
    sound: true,
    volume: 0.8,
    musicOn: true,
    musicVolume: 0.35,
    quality: 'auto',
    tutorialDone: false,
    unlocked: 0,
    levels: {},
    stats: { throws: 0, asyksOut: 0, hits: 0 },
    daily: {},
    playerNames: ['', ''],
    resume: null,
    history: [],
    achievements: {},
    coins: 0,
    owned: ['saka_bronze', 'theme_yard', 'asyk_bone'],
    equipped: { saka: 'saka_bronze', theme: 'theme_yard', asyk: 'asyk_bone' },
    pro: false,
    endlessBest: { score: 0, wave: 0 },
    difficulty: 'normal',
    vibration: true,
    customLevels: [],
    dailyStreak: { last: '', count: 0 },
    seenHints: [],
    counters: defaultCounters(),
    view: '3d',
    viewChosen: false,
    view3dBlocked: false,
    ruleset: 'loft',
    rulesetChosen: false,
    loft: 'mid',
    endlessBestLoft: { score: 0, wave: 0 },
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown, d: number, min = 0): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(min, x) : d);
const str = (x: unknown, d: string, max = 200): string => (typeof x === 'string' ? x.slice(0, max) : d);
const MODES: GameMode[] = ['campaign', 'training', 'versus', 'daily', 'endless', 'duel', 'custom'];
const TYPES: AsykType[] = ['normal', 'golden', 'heavy', 'block'];
const BOTS: BotLevel[] = ['easy', 'normal', 'hard'];

function sanitizeAsyks(raw: unknown): AsykSpec[] | null {
  if (!Array.isArray(raw) || raw.length > 40) return null;
  const out: AsykSpec[] = [];
  for (const a of raw) {
    if (!isObj(a)) return null;
    const { x, y, angle } = a;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof angle !== 'number') return null;
    if (![x, y, angle].every(Number.isFinite) || x < -50 || x > 770 || y < -50 || y > 1130) return null;
    const type: AsykType = TYPES.includes(a.type as AsykType) ? (a.type as AsykType) : 'normal';
    const spec: AsykSpec = { x, y, angle, type };
    if (typeof a.id === 'string' && a.id.length <= 24) spec.id = a.id;
    out.push(spec);
  }
  return out;
}

/** Проверяет сохранённый раунд; повреждённый или чужой версии → null (без падения). */
export function sanitizeResume(raw: unknown): ResumeState | null {
  try {
    if (!isObj(raw) || raw.v !== 1) return null;
    if (!MODES.includes(raw.mode as GameMode)) return null;
    const lv = raw.level;
    const rd = raw.round;
    if (!isObj(lv) || !isObj(rd) || !isObj(lv.zone)) return null;
    const asyks = sanitizeAsyks(lv.asyks);
    if (!asyks || asyks.length === 0) return null;
    const zone = lv.zone;
    if (![zone.x, zone.y, zone.r].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const scores = rd.scores;
    const vt = rd.versusThrows;
    if (!Array.isArray(scores) || !Array.isArray(vt) || !Array.isArray(rd.scoredIds)) return null;
    const throws = lv.throws === null ? null : num(lv.throws, NaN);
    if (throws !== null && !Number.isFinite(throws)) return null;
    const ex = isObj(raw.extra) ? raw.extra : {};
    return {
      v: 1,
      ts: num(raw.ts, 0),
      mode: raw.mode as GameMode,
      levelId: Math.floor(num(raw.levelId, 0)),
      level: {
        id: Math.floor(num(lv.id, 0)),
        nameKey: str(lv.nameKey, 'level1', 40),
        name: typeof lv.name === 'string' ? lv.name.slice(0, 24) : undefined,
        throws,
        par: lv.par === null ? null : num(lv.par, 0),
        zone: { x: zone.x as number, y: zone.y as number, r: zone.r as number },
        asyks,
      },
      round: {
        throwsUsed: Math.floor(num(rd.throwsUsed, 0)),
        scores: [num(scores[0], 0), num(scores[1], 0)],
        player: rd.player === 1 ? 1 : 0,
        versusThrows: [Math.floor(num(vt[0], 0)), Math.floor(num(vt[1], 0))],
        bestCombo: Math.floor(num(rd.bestCombo, 0)),
        scoredIds: (rd.scoredIds as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 60),
        asykTotal: Math.floor(num(rd.asykTotal, asyks.length)),
      },
      extra: {
        wave: typeof ex.wave === 'number' ? Math.floor(num(ex.wave, 1, 1)) : undefined,
        runSeed: typeof ex.runSeed === 'number' ? Math.floor(num(ex.runSeed, 0)) : undefined,
        totalScore: typeof ex.totalScore === 'number' ? num(ex.totalScore, 0) : undefined,
        reserve: typeof ex.reserve === 'number' ? num(ex.reserve, 0) : undefined,
        botLevel: BOTS.includes(ex.botLevel as BotLevel) ? (ex.botLevel as BotLevel) : undefined,
        dailyKey: typeof ex.dailyKey === 'string' ? ex.dailyKey.slice(0, 10) : undefined,
        challengeScore: typeof ex.challengeScore === 'number' ? num(ex.challengeScore, 0) : undefined,
        challengeName: typeof ex.challengeName === 'string' ? ex.challengeName.slice(0, 16) : undefined,
        ruleset: ex.ruleset === 'loft' ? 'loft' : undefined,
      },
    };
  } catch {
    return null;
  }
}

function sanitizeHistory(raw: unknown): ResultEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ResultEntry[] = [];
  for (const e of raw) {
    if (!isObj(e) || !MODES.includes(e.mode as GameMode)) continue;
    out.push({
      ts: num(e.ts, 0),
      mode: e.mode as GameMode,
      ref: str(e.ref, '', 40),
      score: num(e.score, 0),
      stars: Math.min(3, Math.floor(num(e.stars, 0))),
      throws: Math.floor(num(e.throws, 0)),
      combo: Math.floor(num(e.combo, 0)),
    });
  }
  return out.slice(-HISTORY_LIMIT);
}

function sanitizeCustom(raw: unknown): CustomLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomLevel[] = [];
  for (const e of raw) {
    if (!isObj(e) || typeof e.code !== 'string' || e.code.length > 600) continue;
    out.push({
      id: str(e.id, String(out.length), 24),
      name: str(e.name, '', 24),
      code: e.code,
      verified: e.verified === true,
      ts: num(e.ts, 0),
    });
  }
  return out.slice(0, CUSTOM_LIMIT);
}

/** Приводит произвольный JSON (v1 или v2) к SaveV2: недостающее и битое заменяется значениями по умолчанию. */
export function sanitize(raw: unknown): SaveV2 {
  const d = defaultSave();
  if (!isObj(raw)) return d;
  const r = raw;
  const lang: Lang = r.lang === 'kk' || r.lang === 'en' || r.lang === 'ru' ? r.lang : d.lang;
  const quality: Quality =
    r.quality === 'high' || r.quality === 'medium' || r.quality === 'low' || r.quality === 'auto' ? r.quality : d.quality;
  const levels: Record<string, LevelStat> = {};
  if (isObj(r.levels)) {
    for (const [k, v] of Object.entries(r.levels)) {
      if (!isObj(v)) continue;
      const stars = Math.min(3, Math.max(0, Math.floor(num(v.stars, 0)))) as 0 | 1 | 2 | 3;
      levels[k] = { best: num(v.best, 0), stars, plays: Math.floor(num(v.plays, 0)) };
    }
  }
  const st = isObj(r.stats) ? r.stats : {};
  const daily: SaveV2['daily'] = {};
  if (isObj(r.daily)) {
    for (const [k, v] of Object.entries(r.daily)) if (isObj(v)) daily[k] = { best: num(v.best, 0) };
  }
  const names = Array.isArray(r.playerNames) ? r.playerNames : [];
  const isV2 = r.v === 2;
  const ach: Record<string, number> = {};
  if (isV2 && isObj(r.achievements))
    for (const [k, v] of Object.entries(r.achievements)) if (typeof v === 'number') ach[k.slice(0, 30)] = v;
  const eq = isV2 && isObj(r.equipped) ? r.equipped : {};
  const owned = isV2 && Array.isArray(r.owned) ? r.owned.filter((s): s is string => typeof s === 'string').slice(0, 60) : [];
  for (const id of d.owned) if (!owned.includes(id)) owned.push(id);
  const cnt = isV2 && isObj(r.counters) ? r.counters : {};
  const eb = isV2 && isObj(r.endlessBest) ? r.endlessBest : {};
  const ds = isV2 && isObj(r.dailyStreak) ? r.dailyStreak : {};
  const difficulty: Difficulty = isV2 && r.difficulty === 'easy' ? 'easy' : 'normal';
  return {
    v: 2,
    lang,
    sound: typeof r.sound === 'boolean' ? r.sound : d.sound,
    volume: typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : d.volume,
    musicOn: typeof r.musicOn === 'boolean' ? r.musicOn : d.musicOn,
    musicVolume:
      typeof r.musicVolume === 'number' && Number.isFinite(r.musicVolume) ? Math.min(1, Math.max(0, r.musicVolume)) : d.musicVolume,
    quality,
    tutorialDone: typeof r.tutorialDone === 'boolean' ? r.tutorialDone : d.tutorialDone,
    unlocked: Math.min(MAX_PRO_LEVEL, Math.floor(num(r.unlocked, 0))),
    levels,
    stats: {
      throws: Math.floor(num(st.throws, 0)),
      asyksOut: Math.floor(num(st.asyksOut, 0)),
      hits: Math.floor(num(st.hits, 0)),
    },
    daily,
    playerNames: [typeof names[0] === 'string' ? names[0].slice(0, 16) : '', typeof names[1] === 'string' ? names[1].slice(0, 16) : ''],
    resume: isV2 ? sanitizeResume(r.resume) : null,
    history: isV2 ? sanitizeHistory(r.history) : [],
    achievements: ach,
    coins: isV2 ? Math.floor(num(r.coins, 0)) : 0,
    owned,
    equipped: {
      saka: str(eq.saka, d.equipped.saka, 30),
      theme: str(eq.theme, d.equipped.theme, 30),
      asyk: str(eq.asyk, d.equipped.asyk, 30),
    },
    pro: isV2 && r.pro === true,
    endlessBest: { score: Math.floor(num(eb.score, 0)), wave: Math.floor(num(eb.wave, 0)) },
    difficulty,
    vibration: isV2 && typeof r.vibration === 'boolean' ? r.vibration : true,
    customLevels: isV2 ? sanitizeCustom(r.customLevels) : [],
    dailyStreak: { last: str(ds.last, '', 10), count: Math.floor(num(ds.count, 0)) },
    seenHints: isV2 && Array.isArray(r.seenHints) ? r.seenHints.filter((s): s is string => typeof s === 'string').slice(0, 20) : [],
    counters: {
      hitStreak: Math.floor(num(cnt.hitStreak, 0)),
      bestCombo: Math.floor(num(cnt.bestCombo, 0)),
      goldenOut: Math.floor(num(cnt.goldenOut, 0)),
      shared: Math.floor(num(cnt.shared, 0)),
      botWinsHard: Math.floor(num(cnt.botWinsHard, 0)),
    },
    // 2D — только если игрок выбрал его сам; прежний сохранённый '2d' был лишь значением по умолчанию → 3D
    view: isV2 && r.viewChosen === true && r.view === '2d' ? '2d' : '3d',
    viewChosen: isV2 && r.viewChosen === true,
    view3dBlocked: isV2 && r.view3dBlocked === true,
    // миграция: полей нет → классика и средняя высота
    // классика — только если игрок выбрал её сам; прежний сохранённый 'classic' был лишь значением по умолчанию → навес
    ruleset: isV2 && r.rulesetChosen === true && r.ruleset === 'classic' ? 'classic' : 'loft',
    rulesetChosen: isV2 && r.rulesetChosen === true,
    loft: isV2 && (r.loft === 'low' || r.loft === 'high') ? r.loft : 'mid',
    endlessBestLoft: {
      score: Math.floor(num(isObj(r.endlessBestLoft) ? r.endlessBestLoft.score : 0, 0)),
      wave: Math.floor(num(isObj(r.endlessBestLoft) ? r.endlessBestLoft.wave : 0, 0)),
    },
  };
}

/** Безопасно достаёт localStorage (приватный режим/запрет — null). */
export function getStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = '__asyk_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Хранилище сохранений: вся работа с localStorage — только здесь, всё в try/catch. */
export class SaveStore {
  private cache: SaveV2 = defaultSave();
  private listeners = new Set<() => void>();
  /** время последнего изменения (мс) */
  updatedAt = 0;

  constructor(private storage: StorageLike | null) {
    this.load();
    try {
      this.updatedAt = Number(this.storage?.getItem(UPDATED_KEY)) || 0;
    } catch {
      this.updatedAt = 0;
    }
  }

  /** Подписка на изменения (облачная синхронизация). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get data(): SaveV2 {
    return this.cache;
  }

  load(): SaveV2 {
    let text: string | null = null;
    try {
      text = this.storage ? this.storage.getItem(SAVE_KEY) : null;
    } catch {
      text = null;
    }
    if (text === null) {
      this.cache = defaultSave();
      return this.cache;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      const v = isObj(parsed) ? parsed.v : undefined;
      if (v === 2) {
        this.cache = sanitize(parsed);
      } else if (v === 1) {
        // Миграция v1 → v2 без потери прогресса; старое значение — в бэкап.
        this.backup(BACKUP_V1_KEY, text);
        this.cache = sanitize(parsed);
        this.persist();
      } else {
        this.backup(BACKUP_KEY, text);
        this.cache = defaultSave();
        this.persist();
      }
    } catch {
      this.backup(BACKUP_KEY, text); // битый JSON
      this.cache = defaultSave();
      this.persist();
    }
    return this.cache;
  }

  private backup(key: string, text: string): void {
    try {
      this.storage?.setItem(key, text);
    } catch {
      /* ignore */
    }
  }

  persist(): void {
    this.updatedAt = Date.now();
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.cache));
      this.storage?.setItem(UPDATED_KEY, String(this.updatedAt));
    } catch {
      /* квота/приватный режим: игра продолжает работать без сохранения */
    }
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* слушатель не должен ломать сохранение */
      }
    }
  }

  /** Заменить сохранение целиком (результат слияния с облаком). */
  replace(next: SaveV2): void {
    this.cache = sanitize(next);
    this.persist();
  }

  update(fn: (s: SaveV2) => void): SaveV2 {
    fn(this.cache);
    this.persist();
    return this.cache;
  }

  reset(): void {
    const keep = {
      lang: this.cache.lang,
      sound: this.cache.sound,
      volume: this.cache.volume,
      musicOn: this.cache.musicOn,
      musicVolume: this.cache.musicVolume,
      quality: this.cache.quality,
      vibration: this.cache.vibration,
      difficulty: this.cache.difficulty,
    };
    this.cache = { ...defaultSave(), ...keep };
    this.persist();
  }
}

export interface LevelResultInfo {
  newRecord: boolean;
  bestStars: 0 | 1 | 2 | 3;
}

/** Записывает результат кампании: рекорд, звёзды (максимум), открытие следующего уровня. */
export function applyLevelResult(
  save: SaveV2,
  levelId: number,
  score: number,
  stars: 0 | 1 | 2 | 3,
  key = String(levelId),
): LevelResultInfo {
  const prev = save.levels[key] ?? { best: 0, stars: 0 as const, plays: 0 };
  const newRecord = score > prev.best;
  const bestStars = Math.max(prev.stars, stars) as 0 | 1 | 2 | 3;
  save.levels[key] = { best: Math.max(prev.best, score), stars: bestStars, plays: prev.plays + 1 };
  if (stars >= 1) save.unlocked = Math.min(MAX_PRO_LEVEL, Math.max(save.unlocked, levelId + 1));
  return { newRecord, bestStars };
}

export const store = new SaveStore(typeof window === 'undefined' ? null : getStorage());
