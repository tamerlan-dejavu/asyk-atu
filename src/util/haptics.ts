import { store } from '../storage/save';

/** Вибро-отклик (только устройства с поддержкой; настройка «Вибрация»). */
export function vibrate(pattern: number | number[]): void {
  try {
    if (!store.data.vibration) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(pattern);
  } catch {
    /* не критично */
  }
}

export const HAPTIC = {
  hit: 10,
  out: 20,
  combo: [20, 30, 40] as number[],
};
