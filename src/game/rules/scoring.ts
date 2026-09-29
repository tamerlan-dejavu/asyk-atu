import { COMBO_BONUS, ECONOMY_BONUS, POINTS_PER_ASYK } from '../config';

/** Очки за один бросок: k выбитых → 10·k + 5·(k−1); k = 0 → 0. Примеры: 1→10, 2→25, 3→40. */
export function throwScore(k: number): number {
  if (!Number.isFinite(k) || k < 1) return 0;
  return POINTS_PER_ASYK * k + COMBO_BONUS * (k - 1);
}

/** Бонус за экономию (только кампания): +10 за каждую неиспользованную попытку при полностью очищенном коне. */
export function economyBonus(unusedThrows: number, cleared: boolean): number {
  if (!cleared || !Number.isFinite(unusedThrows) || unusedThrows <= 0) return 0;
  return ECONOMY_BONUS * unusedThrows;
}

export interface ThrowOutcome {
  /** сколько асыков выбито ЭТИМ броском (без уже засчитанных) */
  k: number;
  points: number;
  /** id, засчитанные этим броском */
  ids: string[];
}

/**
 * Учёт выбитых асыков. Асык засчитывается один раз, навсегда:
 * повторное «выбивание» того же id очков не даёт.
 */
export class ScoreKeeper {
  private readonly scored = new Set<string>();

  has(id: string): boolean {
    return this.scored.has(id);
  }

  get count(): number {
    return this.scored.size;
  }

  /** Регистрирует выбитые асыки одного броска и возвращает результат броска. */
  registerThrow(outIds: string[]): ThrowOutcome {
    const fresh: string[] = [];
    for (const id of outIds) {
      if (!this.scored.has(id)) {
        this.scored.add(id);
        fresh.push(id);
      }
    }
    return { k: fresh.length, points: throwScore(fresh.length), ids: fresh };
  }
}
