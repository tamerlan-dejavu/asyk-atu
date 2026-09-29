import type { GameMode, SaveV2 } from '../../types';

export interface AchDef {
  id: string;
  /** награда в тиын */
  reward: number;
  icon: string;
  /** цель для индикатора прогресса (если применимо) */
  goal?: number;
}

export const ACHIEVEMENTS: AchDef[] = [
  { id: 'first_throw', reward: 5, icon: '🎯' },
  { id: 'first_win', reward: 10, icon: '🏁' },
  { id: 'combo3', reward: 15, icon: '✨' },
  { id: 'combo4', reward: 25, icon: '💥' },
  { id: 'sniper', reward: 20, icon: '🔭', goal: 5 },
  { id: 'saver', reward: 20, icon: '🪙', goal: 3 },
  { id: 'stars5', reward: 30, icon: '⭐', goal: 5 },
  { id: 'golden', reward: 10, icon: '🥇' },
  { id: 'marathon', reward: 30, icon: '🏃', goal: 5 },
  { id: 'duelist', reward: 40, icon: '⚔' },
  { id: 'designer', reward: 20, icon: '✏' },
  { id: 'daily3', reward: 30, icon: '📅', goal: 3 },
];

export type AchEvent =
  | { type: 'throw'; mode: GameMode; k: number; golden: number }
  | { type: 'levelEnd'; mode: GameMode; cleared: boolean; throwsLeft: number; botHardWon?: boolean }
  | { type: 'wave'; wave: number }
  | { type: 'share' }
  | { type: 'daily'; date: string };

export interface AchResult {
  unlocked: string[];
  /** сколько тиын добавлено наградами */
  coins: number;
}

const DAY = 86400000;

/** Предыдущая календарная дата YYYY-MM-DD. */
export function prevDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d).getTime() - DAY;
  const p = new Date(t);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(p.getDate()).padStart(2, '0')}`;
}

/** Награды тиын за события (не достижения). */
export const COIN = {
  levelBase: 10,
  levelPerStar: 5,
  daily: 10,
  wave: 3,
};

export function levelCoins(stars: number): number {
  return COIN.levelBase + COIN.levelPerStar * stars;
}

/**
 * Чистая обработка события: обновляет счётчики и выдаёт новые достижения.
 * Достижение выдаётся один раз — повторная награда невозможна.
 */
export function processEvent(save: SaveV2, ev: AchEvent, now = Date.now()): AchResult {
  const unlocked: string[] = [];
  const grant = (id: string) => {
    if (save.achievements[id] !== undefined) return;
    const def = ACHIEVEMENTS.find((a) => a.id === id);
    if (!def) return;
    save.achievements[id] = now;
    save.coins += def.reward;
    unlocked.push(id);
  };

  switch (ev.type) {
    case 'throw': {
      if (ev.mode === 'training') break;
      grant('first_throw');
      if (ev.k >= 1) save.counters.hitStreak++;
      else save.counters.hitStreak = 0;
      save.counters.bestCombo = Math.max(save.counters.bestCombo, ev.k);
      save.counters.goldenOut += ev.golden;
      if (ev.k >= 3) grant('combo3');
      if (ev.k >= 4) grant('combo4');
      if (save.counters.hitStreak >= 5) grant('sniper');
      if (ev.golden >= 1) grant('golden');
      break;
    }
    case 'levelEnd': {
      if (ev.cleared && (ev.mode === 'campaign' || ev.mode === 'custom')) {
        grant('first_win');
        if (ev.throwsLeft >= 3) grant('saver');
        const threeStars = Object.values(save.levels).filter((l) => l.stars === 3).length;
        if (threeStars >= 5) grant('stars5');
      }
      if (ev.mode === 'duel' && ev.botHardWon) {
        save.counters.botWinsHard++;
        grant('duelist');
      }
      break;
    }
    case 'wave':
      if (ev.wave >= 5) grant('marathon');
      break;
    case 'share':
      save.counters.shared++;
      grant('designer');
      break;
    case 'daily': {
      if (save.dailyStreak.last !== ev.date) {
        save.dailyStreak.count = save.dailyStreak.last === prevDate(ev.date) ? save.dailyStreak.count + 1 : 1;
        save.dailyStreak.last = ev.date;
      }
      if (save.dailyStreak.count >= 3) grant('daily3');
      break;
    }
  }
  const coins = unlocked.reduce((s, id) => s + (ACHIEVEMENTS.find((a) => a.id === id)?.reward ?? 0), 0);
  return { unlocked, coins };
}

/** Прогресс достижения для списка: [текущее, цель] или null. */
export function progressOf(save: SaveV2, id: string): [number, number] | null {
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def?.goal) return null;
  const cur =
    id === 'sniper'
      ? save.counters.hitStreak
      : id === 'stars5'
        ? Object.values(save.levels).filter((l) => l.stars === 3).length
        : id === 'daily3'
          ? save.dailyStreak.count
          : 0;
  return id === 'saver' || id === 'marathon' ? null : [Math.min(def.goal, cur), def.goal];
}
