import { FEATURES } from '../config/features';
import { cloud } from '../cloud/cloud';

let sent = 0;
const MAX_PER_SESSION = 5;

/** Сообщение без персональных данных: только текст ошибки, обрезанный до 300 символов, без стека и путей. */
export function scrubError(message: unknown): string {
  return String(message ?? 'unknown')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[A-Za-z]:\[^\s]+/g, '<path>')
    .replace(/\S+@\S+\.\S+/g, '<email>')
    .slice(0, 300);
}

function report(message: unknown): void {
  if (sent >= MAX_PER_SESSION) return;
  sent++;
  cloud.reportError(scrubError(message));
}

/** Глобальные ошибки: в консоль (браузер делает сам) и, если облако включено, в client_errors (≤ 5 за сессию). */
export function initErrorReporting(): void {
  window.addEventListener('error', (e) => report(e.message));
  window.addEventListener('unhandledrejection', (e) => report((e.reason as Error)?.message ?? e.reason));
}

/** Vercel Speed Insights и (если включена в проекте) Web Analytics: без cookie; только на реальном домене и в production-сборке. */
export function initAnalytics(): void {
  if (!FEATURES.analytics || !import.meta.env.PROD) return;
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return;
  const w = window as unknown as { va?: (...a: unknown[]) => void; vaq?: unknown[]; si?: (...a: unknown[]) => void; siq?: unknown[] };
  w.va ??= (...a: unknown[]) => void (w.vaq ??= []).push(a);
  w.si ??= (...a: unknown[]) => void (w.siq ??= []).push(a);
  const scripts = ['/_vercel/speed-insights/script.js'];
  if (FEATURES.webAnalytics) scripts.push('/_vercel/insights/script.js');
  for (const src of scripts) {
    const s = document.createElement('script');
    s.defer = true;
    s.src = src;
    document.head.appendChild(s);
  }
}

export interface DebugStats {
  throws: number;
  simMs: number;
  steps: number;
}

export const debugStats: DebugStats = { throws: 0, simMs: 0, steps: 0 };

/** Панель отладки ?debug=1: броски, время симуляции на шаг, средний FPS за сессию. В меню не видна. */
export function initDebugPanel(fps: () => number): void {
  if (!new URLSearchParams(location.search).has('debug')) return;
  const el = document.createElement('pre');
  el.id = 'debug';
  el.style.cssText =
    'position:fixed;left:4px;bottom:4px;z-index:200;margin:0;padding:4px 6px;font:11px/1.3 monospace;color:#0f0;background:rgba(0,0,0,.7);pointer-events:none;border-radius:4px';
  document.body.appendChild(el);
  let frames = 0;
  let sum = 0;
  window.setInterval(() => {
    const f = fps();
    if (f > 0) {
      frames++;
      sum += f;
    }
    const perStep = debugStats.steps ? debugStats.simMs / debugStats.steps : 0;
    el.textContent = `fps ${f.toFixed(0)} (avg ${(sum / Math.max(1, frames)).toFixed(0)})\nthrows ${debugStats.throws}\nsim ${perStep.toFixed(2)} ms/step\ncloud ${cloud.status}/${cloud.sync}`;
  }, 500);
}
