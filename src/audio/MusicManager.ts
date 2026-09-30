/**
 * Фоновая музыка: один экземпляр на приложение, общий AudioContext со звуками (sfx), без второго менеджера.
 * Треки: menu (меню, магазин, итоги) и game (раунд). Бесшовный цикл через AudioBufferSourceNode.loop,
 * кроссфейд 1,2 с, первый старт — fade-in 1,5 с. Ничего не звучит до жеста пользователя: контекст
 * создаётся в sfx.unlock() внутри обработчика жеста (требование браузеров, в том числе iOS).
 * Если файл не загрузился или не декодируется — процедурная домбра (ProceduralDombra).
 */
export type TrackId = 'menu' | 'game';

export interface MusicSettings {
  /** звук игры включён целиком (M / кнопка динамика) */
  sound: boolean;
  /** музыка включена */
  on: boolean;
  /** громкость музыки 0…1 */
  volume: number;
}

export interface ProceduralVoice {
  start(): void;
  stop(): void;
}

export interface MusicDeps {
  /** контекст после жеста пользователя (до него — null) */
  getCtx: () => AudioContext | null;
  fetchTrack: (id: TrackId) => Promise<ArrayBuffer>;
  procedural: (ctx: AudioContext, dest: AudioNode, bpm: number) => ProceduralVoice;
  settings: () => MusicSettings;
}

interface Voice {
  id: TrackId;
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  proc: ProceduralVoice | null;
  buffer: AudioBuffer | null;
  /** время контекста, когда позиция трека была 0 (для паузы с продолжением) */
  t0: number;
}

const FADE_IN_FIRST = 1.5;
/** SFX приоритетнее: на время удара фон приглушается до 60 % */
export const DUCK_LEVEL = 0.6;

export class MusicManager {
  private master: GainNode | null = null;
  private ducker: GainNode | null = null;
  private voice: Voice | null = null;
  private desired: TrackId | null = null;
  private paused = false;
  private pausedAt = 0;
  private started = false;
  private token = 0;
  private readonly raw = new Map<TrackId, Promise<ArrayBuffer>>();
  private readonly decoded = new Map<TrackId, AudioBuffer | 'failed'>();

  constructor(private readonly d: MusicDeps) {}

  /** Громкость с учётом «Звук» и «Музыка вкл/выкл». */
  private level(): number {
    const s = this.d.settings();
    return s.sound && s.on ? Math.min(1, Math.max(0, s.volume)) : 0;
  }

  private graph(ctx: AudioContext): { master: GainNode; ducker: GainNode } {
    if (!this.master || !this.ducker) {
      this.ducker = ctx.createGain();
      this.ducker.gain.value = 1;
      this.master = ctx.createGain();
      this.master.gain.value = this.level();
      this.master.connect(this.ducker).connect(ctx.destination);
    }
    return { master: this.master, ducker: this.ducker };
  }

  /** Загрузка файла заранее (после первого экрана), без декодирования и без звука. */
  prefetch(id: TrackId): Promise<void> {
    let p = this.raw.get(id);
    if (!p) {
      p = this.d.fetchTrack(id);
      this.raw.set(id, p);
    }
    return p.then(
      () => undefined,
      () => undefined,
    );
  }

  private async buffer(ctx: AudioContext, id: TrackId): Promise<AudioBuffer | null> {
    const have = this.decoded.get(id);
    if (have) return have === 'failed' ? null : have;
    try {
      this.prefetch(id);
      const data = await this.raw.get(id)!;
      const buf = await ctx.decodeAudioData(data.slice(0));
      this.decoded.set(id, buf);
      return buf;
    } catch {
      this.decoded.set(id, 'failed');
      return null;
    }
  }

  /** Контекст появился (первый жест): начать желаемый трек. */
  onUnlock(): void {
    if (this.desired && !this.voice && !this.paused) void this.crossfadeTo(this.desired, 0);
  }

  play(id: TrackId): void {
    if (this.desired === id && (this.voice?.id === id || !this.d.getCtx())) {
      this.desired = id;
      return;
    }
    void this.crossfadeTo(id);
  }

  /** Плавный переход на трек (по умолчанию 1,2 с; первый запуск — мягкий fade-in 1,5 с). */
  async crossfadeTo(id: TrackId, ms = 1200): Promise<void> {
    this.desired = id;
    const ctx = this.d.getCtx();
    if (!ctx || this.paused) return;
    if (this.voice?.id === id) return;
    const my = ++this.token;
    const { master } = this.graph(ctx);
    const buf = await this.buffer(ctx, id);
    if (my !== this.token || this.paused) return;
    const old = this.voice;
    const fade = this.started ? Math.max(0.05, ms / 1000) : FADE_IN_FIRST;
    this.started = true;
    this.voice = this.startVoice(ctx, master, id, buf, 0, fade);
    if (old) this.fadeOut(ctx, old, Math.max(0.05, ms / 1000));
  }

  private startVoice(ctx: AudioContext, dest: AudioNode, id: TrackId, buf: AudioBuffer | null, offset: number, fade: number): Voice {
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(1, now + fade);
    gain.connect(dest);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      const off = offset % buf.duration;
      src.start(now, off);
      return { id, gain, src, proc: null, buffer: buf, t0: now - off };
    }
    const proc = this.d.procedural(ctx, gain, id === 'game' ? 92 : 76);
    proc.start();
    return { id, gain, src: null, proc, buffer: null, t0: now };
  }

  private fadeOut(ctx: AudioContext, v: Voice, sec: number): void {
    const now = ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), now);
    v.gain.gain.exponentialRampToValueAtTime(0.0001, now + sec);
    const stopAt = now + sec + 0.05;
    if (v.src) {
      try {
        v.src.stop(stopAt);
      } catch {
        /* уже остановлен */
      }
    }
    if (v.proc) {
      const p = v.proc;
      window.setTimeout(() => p.stop(), (sec + 0.05) * 1000);
    }
  }

  stop(): void {
    this.desired = null;
    this.token++;
    const ctx = this.d.getCtx();
    if (ctx && this.voice) this.fadeOut(ctx, this.voice, 0.4);
    this.voice = null;
  }

  /** Громкость/вкл-выкл поменялись — плавно применить. */
  apply(): void {
    const ctx = this.d.getCtx();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.level(), now, 0.08);
  }

  setVolume(_v: number): void {
    this.apply();
  }

  mute(_m: boolean): void {
    this.apply();
  }

  /** Приглушить фон на время звука игры (удар, выбивание): до 60 % и обратно. */
  duck(ms = 160): void {
    const ctx = this.d.getCtx();
    if (!ctx || !this.ducker) return;
    const g = this.ducker.gain;
    const now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(DUCK_LEVEL, now + 0.03);
    g.setValueAtTime(DUCK_LEVEL, now + ms / 1000);
    g.linearRampToValueAtTime(1, now + ms / 1000 + 0.25);
  }

  /** Пауза игры / вкладка скрыта: запомнить позицию, остановить. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    const ctx = this.d.getCtx();
    const v = this.voice;
    if (!ctx || !v) return;
    this.pausedAt = v.buffer ? (ctx.currentTime - v.t0) % v.buffer.duration : 0;
    this.fadeOut(ctx, v, 0.15);
    this.voice = null;
    this.token++;
  }

  /** Продолжить с того же места. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const ctx = this.d.getCtx();
    if (!ctx || !this.desired) return;
    const { master } = this.graph(ctx);
    const id = this.desired;
    const my = ++this.token;
    void this.buffer(ctx, id).then((buf) => {
      if (my !== this.token || this.paused) return;
      this.voice = this.startVoice(ctx, master, id, buf, this.pausedAt, 0.3);
    });
  }

  /** Для тестов и отладки. */
  get state(): { track: TrackId | null; playing: boolean; paused: boolean; procedural: boolean; level: number; duck: number } {
    return {
      track: this.desired,
      playing: !!this.voice,
      paused: this.paused,
      procedural: !!this.voice?.proc,
      level: this.master ? this.master.gain.value : this.level(),
      duck: this.ducker ? this.ducker.gain.value : 1,
    };
  }
}
