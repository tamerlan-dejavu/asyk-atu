/**
 * Флаги функций. Недоделанное скрывается одной строкой: выключенная функция
 * не видна в меню (нет мёртвых кнопок).
 */
export const FEATURES = {
  resume: true,
  endless: true,
  editor: true,
  bot: true,
  shop: true,
  achievements: true,
} as const;
