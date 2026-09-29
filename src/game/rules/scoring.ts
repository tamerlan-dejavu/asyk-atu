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

/** Очки за бросок по значениям выбитых тел: сумма value_i + 5·(k − 1) при k ≥ 1. Для одних обычных совпадает с throwScore. */
export function throwScoreValues(values: number[]): number {
  const k = values.length;
  if (k < 1) return 0;
  return values.reduce((a, b) => a + b, 0) + COMBO_BONUS * (k - 1);
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

  /** Восстановление после перезагрузки: эти асыки уже засчитаны. */
  restore(ids: string[]): void {
    for (const id of ids) this.scored.add(id);
  }

  ids(): string[] {
    return [...this.scored];
  }

  /**
   * Регистрирует выбитые асыки одного броска и возвращает результат броска.
   * valueOf — очки за конкретное тело (по умолчанию 10, как у обычного асыка).
   */
  registerThrow(outIds: string[], valueOf: (id: string) => number = () => POINTS_PER_ASYK): ThrowOutcome {
    const fresh: string[] = [];
    for (const id of outIds) {
      if (!this.scored.has(id)) {
        this.scored.add(id);
        fresh.push(id);
      }
    }
    return { k: fresh.length, points: throwScoreValues(fresh.map(valueOf)), ids: fresh };
  }
}
