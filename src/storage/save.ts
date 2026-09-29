import type { Lang, LevelStat, Quality, SaveV1 } from '../types';

export const SAVE_KEY = 'asyk-atu:v1';
export const BACKUP_KEY = 'asyk-atu:backup';
export const MAX_LEVEL = 5;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultSave(): SaveV1 {
  return {
    v: 1,
    lang: 'ru',
    sound: true,
    quality: 'auto',
    tutorialDone: false,
    unlocked: 0,
    levels: {},
    stats: { throws: 0, asyksOut: 0, hits: 0 },
    daily: {},
    playerNames: ['', ''],
  };
}

const num = (x: unknown, d: number, min = 0): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.max(min, x) : d;

/** Приводит произвольный JSON к SaveV1: недостающее и битое заменяется значениями по умолчанию. */
export function sanitize(raw: unknown): SaveV1 {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const lang: Lang = r.lang === 'kk' || r.lang === 'en' || r.lang === 'ru' ? r.lang : d.lang;
  const quality: Quality = r.quality === 'high' || r.quality === 'low' || r.quality === 'auto' ? r.quality : d.quality;
  const levels: Record<string, LevelStat> = {};
  if (r.levels && typeof r.levels === 'object') {
    for (const [k, v] of Object.entries(r.levels as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const s = v as Record<string, unknown>;
      const stars = Math.min(3, Math.max(0, Math.floor(num(s.stars, 0)))) as 0 | 1 | 2 | 3;
      levels[k] = { best: num(s.best, 0), stars, plays: Math.floor(num(s.plays, 0)) };
    }
  }
  const st = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>;
  const daily: SaveV1['daily'] = {};
  if (r.daily && typeof r.daily === 'object') {
    for (const [k, v] of Object.entries(r.daily as Record<string, unknown>)) {
      if (v && typeof v === 'object') daily[k] = { best: num((v as Record<string, unknown>).best, 0) };
    }
  }
  const names = Array.isArray(r.playerNames) ? r.playerNames : [];
  return {
    v: 1,
    lang,
    sound: typeof r.sound === 'boolean' ? r.sound : d.sound,
    quality,
    tutorialDone: typeof r.tutorialDone === 'boolean' ? r.tutorialDone : d.tutorialDone,
    unlocked: Math.min(MAX_LEVEL, Math.floor(num(r.unlocked, 0))),
    levels,
    stats: {
      throws: Math.floor(num(st.throws, 0)),
      asyksOut: Math.floor(num(st.asyksOut, 0)),
      hits: Math.floor(num(st.hits, 0)),
    },
    daily,
    playerNames: [
      typeof names[0] === 'string' ? names[0].slice(0, 16) : '',
      typeof names[1] === 'string' ? names[1].slice(0, 16) : '',
    ],
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
  private cache: SaveV1 = defaultSave();

  constructor(private storage: StorageLike | null) {
    this.load();
  }

  get data(): SaveV1 {
    return this.cache;
  }

  load(): SaveV1 {
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
      if (parsed && typeof parsed === 'object' && (parsed as { v?: unknown }).v === 1) {
        this.cache = sanitize(parsed);
      } else {
        // Другая версия схемы: сброс к дефолту с бэкапом старого значения.
        this.backup(text);
        this.cache = defaultSave();
        this.persist();
      }
    } catch {
      this.backup(text); // битый JSON
      this.cache = defaultSave();
      this.persist();
    }
    return this.cache;
  }

  private backup(text: string): void {
    try {
      this.storage?.setItem(BACKUP_KEY, text);
    } catch {
      /* ignore */
    }
  }

  persist(): void {
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.cache));
    } catch {
      /* квота/приватный режим: игра продолжает работать без сохранения */
    }
  }

  update(fn: (s: SaveV1) => void): SaveV1 {
    fn(this.cache);
    this.persist();
    return this.cache;
  }

  reset(): void {
    const keep = { lang: this.cache.lang, sound: this.cache.sound, quality: this.cache.quality };
    this.cache = { ...defaultSave(), ...keep };
    this.persist();
  }
}

export interface LevelResultInfo {
  newRecord: boolean;
  bestStars: 0 | 1 | 2 | 3;
}

/** Записывает результат кампании: рекорд, звёзды (максимум), открытие следующего уровня. */
export function applyLevelResult(save: SaveV1, levelId: number, score: number, stars: 0 | 1 | 2 | 3): LevelResultInfo {
  const key = String(levelId);
  const prev = save.levels[key] ?? { best: 0, stars: 0 as const, plays: 0 };
  const newRecord = score > prev.best;
  const bestStars = Math.max(prev.stars, stars) as 0 | 1 | 2 | 3;
  save.levels[key] = { best: Math.max(prev.best, score), stars: bestStars, plays: prev.plays + 1 };
  if (stars >= 1) save.unlocked = Math.min(MAX_LEVEL, Math.max(save.unlocked, levelId + 1));
  return { newRecord, bestStars };
}

export const store = new SaveStore(typeof window === 'undefined' ? null : getStorage());
