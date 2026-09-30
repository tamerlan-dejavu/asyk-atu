import { CUSTOM_LIMIT, HISTORY_LIMIT, sanitize } from '../storage/save';
import type { SaveV2 } from '../types';

export interface Stamped {
  save: SaveV2;
  /** время последнего изменения (мс) — определяет «более свежую» запись */
  at: number;
}

const maxBy = <T>(a: T[], b: T[], key: (x: T) => string, pick: (x: T, y: T) => T): T[] => {
  const m = new Map<string, T>();
  for (const x of a) m.set(key(x), x);
  for (const y of b) {
    const k = key(y);
    const x = m.get(k);
    m.set(k, x === undefined ? y : pick(x, y));
  }
  return [...m.values()];
};

/** Детерминированное сравнение для ничьей по времени (чтобы слияние было коммутативным). */
const tieKey = (s: SaveV2): string => JSON.stringify({ ...s, resume: null });

/**
 * Слияние локального и облачного сохранения. Чистая функция, без потери прогресса:
 * - рекорды/звёзды/открытые уровни/лучшие результаты — максимум;
 * - достижения, покупки, подсказки — объединение (время достижения — раннее);
 * - история — объединение по (ts, mode, ref), последние 50;
 * - монеты, настройки, экипировка, серия дней — из более свежей записи (компромисс: монеты не суммируются,
 *   иначе один и тот же заработок посчитался бы дважды);
 * - resume не синхронизируется — берётся локальный.
 */
export function mergeSaves(local: Stamped, remote: Stamped): SaveV2 {
  const a = sanitize(local.save);
  const b = sanitize(remote.save);
  const aFresher = local.at > remote.at || (local.at === remote.at && tieKey(a) >= tieKey(b));
  const fresh = aFresher ? a : b;
  const old = aFresher ? b : a;

  const levels: SaveV2['levels'] = {};
  for (const k of new Set([...Object.keys(a.levels), ...Object.keys(b.levels)])) {
    const x = a.levels[k];
    const y = b.levels[k];
    levels[k] =
      x && y
        ? { best: Math.max(x.best, y.best), stars: Math.max(x.stars, y.stars) as 0 | 1 | 2 | 3, plays: Math.max(x.plays, y.plays) }
        : { ...(x ?? y)! };
  }

  const daily: SaveV2['daily'] = {};
  for (const k of new Set([...Object.keys(a.daily), ...Object.keys(b.daily)])) {
    daily[k] = { best: Math.max(a.daily[k]?.best ?? 0, b.daily[k]?.best ?? 0) };
  }

  const achievements: SaveV2['achievements'] = {};
  for (const k of new Set([...Object.keys(a.achievements), ...Object.keys(b.achievements)])) {
    const vals = [a.achievements[k], b.achievements[k]].filter((v): v is number => typeof v === 'number');
    achievements[k] = Math.min(...vals);
  }

  const history = maxBy(
    a.history,
    b.history,
    (e) => `${e.ts}|${e.mode}|${e.ref}`,
    (x, y) => (x.score >= y.score ? x : y),
  )
    .sort((x, y) => x.ts - y.ts || x.mode.localeCompare(y.mode) || x.ref.localeCompare(y.ref))
    .slice(-HISTORY_LIMIT);

  const customLevels = maxBy(
    a.customLevels,
    b.customLevels,
    (c) => c.id,
    (x, y) =>
      x.ts !== y.ts
        ? x.ts > y.ts
          ? x
          : y
        : x.code >= y.code
          ? { ...x, verified: x.verified || y.verified }
          : { ...y, verified: x.verified || y.verified },
  )
    .sort((x, y) => x.ts - y.ts || x.id.localeCompare(y.id))
    .slice(-CUSTOM_LIMIT);

  const union = (x: string[], y: string[]) => [...new Set([...x, ...y])].sort();

  const streak =
    a.dailyStreak.last === b.dailyStreak.last
      ? { last: a.dailyStreak.last, count: Math.max(a.dailyStreak.count, b.dailyStreak.count) }
      : a.dailyStreak.last > b.dailyStreak.last
        ? { ...a.dailyStreak }
        : { ...b.dailyStreak };

  const owned = union(a.owned, b.owned);
  const pro = a.pro || b.pro;

  return {
    ...fresh,
    v: 2,
    tutorialDone: a.tutorialDone || b.tutorialDone,
    unlocked: Math.max(a.unlocked, b.unlocked),
    levels,
    stats: {
      throws: Math.max(a.stats.throws, b.stats.throws),
      asyksOut: Math.max(a.stats.asyksOut, b.stats.asyksOut),
      hits: Math.max(a.stats.hits, b.stats.hits),
    },
    daily,
    resume: local.save.resume ?? null,
    history,
    achievements,
    coins: fresh.coins,
    owned,
    // экипировка из свежей записи, но только если предмет есть в объединённом наборе
    equipped: {
      saka: owned.includes(fresh.equipped.saka) || pro ? fresh.equipped.saka : old.equipped.saka,
      theme: owned.includes(fresh.equipped.theme) || pro ? fresh.equipped.theme : old.equipped.theme,
      asyk: owned.includes(fresh.equipped.asyk) || pro ? fresh.equipped.asyk : old.equipped.asyk,
    },
    pro,
    endlessBest: { score: Math.max(a.endlessBest.score, b.endlessBest.score), wave: Math.max(a.endlessBest.wave, b.endlessBest.wave) },
    customLevels,
    dailyStreak: streak,
    seenHints: union(a.seenHints, b.seenHints),
    counters: {
      hitStreak: fresh.counters.hitStreak,
      bestCombo: Math.max(a.counters.bestCombo, b.counters.bestCombo),
      goldenOut: Math.max(a.counters.goldenOut, b.counters.goldenOut),
      shared: Math.max(a.counters.shared, b.counters.shared),
      botWinsHard: Math.max(a.counters.botWinsHard, b.counters.botWinsHard),
    },
  };
}

/** Отпечаток сохранения без resume: синхронизация не отправляет данные, если меняется только текущий раунд. */
export function syncFingerprint(s: SaveV2): string {
  return JSON.stringify({ ...s, resume: null });
}
