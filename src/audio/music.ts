import { assetUrl } from '../game/render/art';
import { store } from '../storage/save';
import { MusicManager, type TrackId } from './MusicManager';
import { ProceduralDombra } from './ProceduralDombra';
import { sfx } from './sfx';

/** Файлы треков (моно MP3 64 кбит/с, public/assets/audio). */
export const trackUrl = (id: TrackId): string => assetUrl(`audio/music_${id}.mp3`);

/** Музыка приложения: общий AudioContext со звуками, настройки — из сохранения. */
export const music = new MusicManager({
  getCtx: () => sfx.context,
  fetchTrack: async (id) => {
    const r = await fetch(trackUrl(id));
    if (!r.ok) throw new Error(`music ${id}: ${r.status}`);
    return r.arrayBuffer();
  },
  procedural: (ctx, dest, bpm) => new ProceduralDombra(ctx, dest, bpm),
  settings: () => ({ sound: store.data.sound, on: store.data.musicOn, volume: store.data.musicVolume }),
});

sfx.onUnlock(() => music.onUnlock());
sfx.onDuck((ms) => music.duck(ms));

/**
 * Треки грузятся после первого экрана, когда браузер свободен: сначала «меню», сразу за ним «игра».
 * Старт игры и LCP не ждут музыку.
 */
export function prefetchMusic(): void {
  const go = () => void music.prefetch('menu').then(() => music.prefetch('game'));
  const idle = (window as unknown as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  const later = () => (idle ? idle(go, { timeout: 2500 }) : window.setTimeout(go, 1200));
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}

// e2e и отладка: состояние музыки (только чтение)
if (typeof window !== 'undefined')
  Object.defineProperty(window, '__music', {
    get: () => ({ ...music.state, ctx: sfx.context?.state ?? null }),
    enumerable: false,
  });
