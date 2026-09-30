import type { SupabaseClient } from '@supabase/supabase-js';
import { FEATURES } from '../config/features';

const URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

let clientPromise: Promise<SupabaseClient | null> | null = null;

/**
 * Проверка доступности облака с тайм-аутом 2 с. Без сети, без настроек или при «спящем» проекте — false;
 * игра при этом работает полностью локально.
 */
export async function isAvailable(timeoutMs = 2000): Promise<boolean> {
  if (!FEATURES.cloud) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${URL}/auth/v1/health`, { headers: { apikey: KEY }, signal: ctrl.signal, cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Клиент Supabase. Библиотека подгружается динамическим импортом — в стартовый бандл не входит. */
export function getClient(): Promise<SupabaseClient | null> {
  if (!FEATURES.cloud) return Promise.resolve(null);
  clientPromise ??= import('@supabase/supabase-js')
    .then(({ createClient }) =>
      createClient(URL, KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'asyk-atu:auth' },
      }),
    )
    .catch(() => null);
  return clientPromise;
}
