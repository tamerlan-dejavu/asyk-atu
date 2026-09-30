/// <reference types="vite/client" />

/** Короткий SHA коммита сборки (vite.config.ts → define). */
declare const __BUILD_SHA__: string;
/** Время сборки, ISO. */
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_CLOUD_ENABLED?: string;
}
