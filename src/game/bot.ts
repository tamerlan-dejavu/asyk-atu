import { ASYK_VALUE, POWER_MAX, POWER_MIN, SAKA_START, MAX_AIM_ANGLE } from './config';
import { Sim } from './physics/sim';
import type { MatterNS } from './physics/bodies';
import { throwScoreValues } from './rules/scoring';
import type { AsykSpec, BotLevel, ZoneSpec } from '../types';

export interface Shot {
  power: number;
  dirX: number;
  dirY: number;
}

export interface Candidate extends Shot {
  points: number;
  out: number;
}

export const BOT_NOISE: Record<BotLevel, { angleDeg: number; power: number; pick: number[] }> = {
  // pick — вероятности выбора из лучших кандидатов по порядку
  easy: { angleDeg: 6, power: 0.15, pick: [0.2, 0.2, 0.2, 0.2, 0.2] },
  normal: { angleDeg: 3, power: 0.08, pick: [0.6, 0.3, 0.1] },
  hard: { angleDeg: 1, power: 0.03, pick: [1] },
};

const POWERS = [0.6, 0.75, 0.9, 1];
const D = Math.PI / 180;

/** Направление на точку с линии броска: угол от «вверх», в допустимых пределах. */
function angleTo(x: number, y: number): number {
  const a = Math.atan2(x - SAKA_START.x, -(y - SAKA_START.y));
  return Math.max(-MAX_AIM_ANGLE, Math.min(MAX_AIM_ANGLE, a));
}

/** ≈ 96 кандидатов: 24 направления (на цели ± небольшой разброс) × 4 силы. */
export function candidateShots(specs: AsykSpec[]): Shot[] {
  const targets = specs
    .filter((s) => s.type !== 'block')
    .sort((a, b) => ASYK_VALUE[b.type ?? 'normal'] - ASYK_VALUE[a.type ?? 'normal'])
    .slice(0, 12);
  const angles: number[] = [];
  for (const t of targets) {
    const base = angleTo(t.x, t.y);
    angles.push(base - 2.5 * D, base + 2.5 * D);
  }
  for (let deg = -33; angles.length < 24; deg += 6) angles.push(deg * D);
  const uniq = angles.slice(0, 24);
  const out: Shot[] = [];
  for (const a of uniq) for (const p of POWERS) out.push({ power: p, dirX: Math.sin(a), dirY: -Math.cos(a) });
  return out;
}

/** Симуляция одного броска в headless-мире тем же Matter и теми же константами. */
export function simulateShot(M: MatterNS, zone: ZoneSpec, specs: AsykSpec[], shot: Shot): { points: number; out: number; ticks: number } {
  const sim = new Sim(M, zone);
  specs.forEach((s, i) => sim.addAsyk(`a${i}`, s));
  const v = POWER_MIN + (POWER_MAX - POWER_MIN) * shot.power;
  sim.launchSaka(shot.dirX * v, shot.dirY * v, Math.atan2(shot.dirY, shot.dirX));
  const values: number[] = [];
  let ticks = 0;
  while (!sim.settled && ticks < 600) {
    const r = sim.step();
    for (const id of r.newlyScored) values.push(ASYK_VALUE[sim.bodies.get(id)?.type ?? 'normal']);
    ticks++;
  }
  return { points: throwScoreValues(values), out: values.length, ticks };
}

function gaussian(rnd: () => number): number {
  const u = Math.max(1e-9, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/** Применяет ошибку исполнения (зависит от сложности) к выбранному броску. */
export function applyNoise(shot: Shot, level: BotLevel, rnd: () => number): Shot {
  const n = BOT_NOISE[level];
  const a = Math.atan2(shot.dirX, -shot.dirY) + gaussian(rnd) * n.angleDeg * D;
  const clamped = Math.max(-MAX_AIM_ANGLE, Math.min(MAX_AIM_ANGLE, a));
  const power = Math.max(0.05, Math.min(1, shot.power * (1 + gaussian(rnd) * n.power)));
  return { power, dirX: Math.sin(clamped), dirY: -Math.cos(clamped) };
}

export function pickCandidate(sorted: Candidate[], level: BotLevel, rnd: () => number): Candidate {
  const weights = BOT_NOISE[level].pick.slice(0, sorted.length);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return sorted[i];
  }
  return sorted[0];
}

export interface BotOptions {
  /** лимит времени на поиск, мс */
  deadlineMs?: number;
  /** пауза для интерфейса, чтобы не подвешивать кадры */
  yieldEveryMs?: number;
  now?: () => number;
}

/**
 * Выбор броска ботом: перебор кандидатов в headless-симуляции (порциями, с паузами для интерфейса),
 * затем выбор по сложности и ошибка исполнения. Детерминирован при одном rnd.
 */
export async function chooseShot(
  M: MatterNS,
  zone: ZoneSpec,
  specs: AsykSpec[],
  level: BotLevel,
  rnd: () => number,
  opts: BotOptions = {},
): Promise<{ shot: Shot; predicted: number; tried: number }> {
  const now = opts.now ?? (() => performance.now());
  const deadline = opts.deadlineMs ?? 800;
  const yieldEvery = opts.yieldEveryMs ?? 10;
  const start = now();
  let lastYield = start;
  const scored: Candidate[] = [];
  for (const c of candidateShots(specs)) {
    const r = simulateShot(M, zone, specs, c);
    scored.push({ ...c, points: r.points, out: r.out });
    const t = now();
    if (t - start > deadline && scored.length >= 8) break;
    if (t - lastYield > yieldEvery) {
      await new Promise<void>((res) => setTimeout(res, 0));
      lastYield = now();
    }
  }
  scored.sort((a, b) => b.points - a.points || b.power - a.power);
  const chosen = pickCandidate(scored, level, rnd);
  return { shot: applyNoise(chosen, level, rnd), predicted: chosen.points, tried: scored.length };
}
