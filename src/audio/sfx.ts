import { store } from '../storage/save';

/**
 * Звук: только синтез Web Audio (без файлов и лицензий).
 * AudioContext создаётся после первого жеста пользователя (политика браузеров).
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly unlockFns: (() => void)[] = [];
  private duckFn: ((ms: number) => void) | null = null;

  /** Общий AudioContext (после первого жеста; до него — null). Им же пользуется музыка. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Вызывается, когда контекст создан/возобновлён жестом пользователя. */
  onUnlock(fn: () => void): void {
    this.unlockFns.push(fn);
  }

  /** Приглушение фоновой музыки на время звука игры. */
  onDuck(fn: (ms: number) => void): void {
    this.duckFn = fn;
  }

  private duck(ms = 160): void {
    if (this.enabled) this.duckFn?.(ms);
  }

  get enabled(): boolean {
    return store.data.sound;
  }

  /** Вызывать из обработчика жеста (pointerdown/keydown). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.unlockFns.forEach((f) => f()));
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7 * store.data.volume;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.4);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let seed = 12345; // детерминированный шум — Math.random не нужен
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        d[i] = seed / 2147483648 - 1;
      }
      this.unlockFns.forEach((f) => f());
    } catch {
      this.ctx = null;
    }
  }

  /** Громкость 0…1 из настроек (mute — отдельный переключатель «Звук»). */
  setVolume(v: number): void {
    if (this.master) this.master.gain.value = 0.7 * Math.min(1, Math.max(0, v));
  }

  private ready(): boolean {
    return this.enabled && !!this.ctx && !!this.master && this.ctx.state === 'running';
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master!);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private burst(dur: number, vol: number, filterFreq: number, delay = 0, q = 1): void {
    if (!this.ready() || !this.noise) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** Бросок: короткий «свист». */
  throwSound(power: number): void {
    this.burst(0.28, 0.25 + power * 0.2, 500 + power * 900, 0, 0.8);
    this.tone(180 + power * 120, 0.18, 'triangle', 0.12, 0, 90);
  }

  /** Удар: щелчок дерева/кости. `strength` 0…1. */
  hit(strength: number): void {
    this.duck(140);
    const s = Math.min(1, Math.max(0.15, strength));
    const pitch = 700 + s * 500;
    this.tone(pitch, 0.06, 'square', 0.1 * s, 0, pitch * 0.55);
    this.burst(0.05, 0.3 * s, 2400, 0, 2);
  }

  /** Глухой удар о землю при приземлении (навес). */
  thud(strength: number): void {
    const s = Math.min(1, Math.max(0.2, strength));
    this.tone(90 + s * 60, 0.16, 'sine', 0.25 * s, 0, 45);
    this.burst(0.12, 0.25 * s, 380, 0, 0.7);
  }

  out(): void {
    this.duck(200);
    this.tone(520, 0.14, 'sine', 0.2, 0, 900);
  }

  combo(n: number): void {
    const base = 523;
    for (let i = 0; i < Math.min(4, n + 1); i++) this.tone(base * Math.pow(1.26, i), 0.14, 'triangle', 0.2, i * 0.07);
  }

  win(): void {
    // стингер победы поверх музыки: фон приглушён на время звучания
    this.duck(1600);
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.22, i * 0.11));
  }

  lose(): void {
    this.duck(1200);
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.1, i * 0.16));
  }

  click(): void {
    this.tone(660, 0.05, 'sine', 0.12);
  }

  /** Тяжёлый асык: низкий глухой удар. */
  heavy(strength: number): void {
    this.duck(200);
    const s = Math.min(1, Math.max(0.3, strength));
    this.tone(70, 0.28, 'sine', 0.35 * s, 0, 38);
    this.burst(0.18, 0.3 * s, 220, 0, 0.6);
  }

  /** Натяжение рогатки: короткий «скрип», выше с силой (вызывать не чаще раза в ~120 мс). */
  stretch(power: number): void {
    this.tone(220 + power * 260, 0.06, 'triangle', 0.05 + power * 0.04);
  }

  /** Блеск золотого асыка. */
  shimmer(): void {
    [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.09, i * 0.05));
  }

  /** Монета (при подсчёте тиын). */
  coin(): void {
    this.tone(1318, 0.07, 'square', 0.05);
    this.tone(1976, 0.09, 'sine', 0.06, 0.035);
  }

  /** Звезда на экране итога (i = 0…2 — выше с каждой). */
  star(i: number): void {
    const f = [784, 988, 1175][Math.min(2, i)];
    this.tone(f, 0.22, 'triangle', 0.2);
    this.tone(f * 2, 0.16, 'sine', 0.07, 0.03);
  }
}

export const sfx = new Sfx();
