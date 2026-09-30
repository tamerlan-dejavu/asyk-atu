const env = import.meta.env ?? {};

/** Облако включено сборкой: флаг + обе переменные окружения (иначе игра полностью локальная). */
const cloudConfigured = env.VITE_CLOUD_ENABLED === 'true' && Boolean(env.VITE_SUPABASE_URL) && Boolean(env.VITE_SUPABASE_ANON_KEY);

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
  /** облако (Supabase): вход, синхронизация, рейтинг, короткие ссылки */
  cloud: cloudConfigured,
  /** Vercel Speed Insights (только на реальном домене) */
  analytics: true,
  /** Vercel Web Analytics: скрипт есть, только если аналитика включена в проекте Vercel, иначе 404 */
  webAnalytics: env.VITE_VERCEL_WEB_ANALYTICS === 'true',
} as const;
