/**
 * Звёзды за испытание: 3★ — очищено за par бросков или меньше; 2★ — за par + 1;
 * 1★ — очищено за любое число доступных бросков; 0★ — не очищено.
 * Для обучения (par = null) очищение даёт 3★.
 */
export function starsFor(cleared: boolean, throwsUsed: number, par: number | null): 0 | 1 | 2 | 3 {
  if (!cleared) return 0;
  if (par === null) return 3;
  if (throwsUsed <= par) return 3;
  if (throwsUsed <= par + 1) return 2;
  return 1;
}
