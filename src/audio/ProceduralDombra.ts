/**
 * Запасная процедурная «домбра» (если файл трека не загрузился или не декодируется):
 * пентатоника ре (D E F# A B), щипковый тембр (triangle + быстрый lowpass, затухание 0,4–0,8 с),
 * рисунок 6/8, тихий дрон на ре, лёгкий реверб (ConvolverNode с синтезированным импульсом).
 * Планировщик по currentTime с окном опережения — без setInterval на каждую ноту, нагрузка не копится.
 */
const D4 = 293.66;
/** пентатоника ре: ступени в полутонах от D */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
/** рисунок кюя в 6/8 (индексы ступеней; -1 — пауза), два такта */
const PATTERN = [0, 3, 2, 3, 4, 3, 0, 3, 2, 5, 4, 3, 7, 5, 4, 5, 3, 2, 0, 2, 3, -1, 2, 0];

export class ProceduralDombra {
  private readonly out: GainNode;
  private drone: OscillatorNode[] = [];
  private timer = 0;
  private next = 0;
  private step = 0;
  private running = false;
  private readonly spb: number;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    bpm = 84,
  ) {
    // 6/8: восьмая = треть доли
    this.spb = 60 / bpm / 3;
    this.out = ctx.createGain();
    this.out.gain.value = 0.55; // тише файловых треков
    const dry = ctx.createGain();
    dry.gain.value = 0.8;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    const rev = ctx.createConvolver();
    rev.buffer = this.impulse(1.6);
    this.out.connect(dry).connect(dest);
    this.out.connect(rev).connect(wet).connect(dest);
  }

  private impulse(sec: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    let seed = 7;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        d[i] = (seed / 2147483648 - 1) * Math.pow(1 - i / len, 3);
      }
    }
    return b;
  }

  private pluck(t: number, freq: number, vol: number, decay: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 8, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  private tick = (): void => {
    if (!this.running) return;
    const ahead = this.ctx.currentTime + 0.25;
    while (this.next < ahead) {
      const idx = PATTERN[this.step % PATTERN.length];
      const accent = this.step % 3 === 0;
      if (idx >= 0) {
        const f = D4 * Math.pow(2, SCALE[idx] / 12);
        this.pluck(this.next, f, accent ? 0.22 : 0.14, accent ? 0.8 : 0.45);
        // вторая струна домбры — квинта ниже на сильной доле
        if (accent) this.pluck(this.next + 0.012, f / 1.5, 0.08, 0.7);
      }
      this.next += this.spb;
      this.step++;
    }
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    // тихий дрон на ре (октава ниже)
    for (const [f, v] of [
      [D4 / 2, 0.035],
      [(D4 / 2) * 1.5, 0.018],
    ]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = v;
      o.connect(g).connect(this.out);
      o.start();
      this.drone.push(o);
    }
    this.next = this.ctx.currentTime + 0.05;
    this.step = 0;
    this.timer = window.setInterval(this.tick, 100);
    this.tick();
  }

  stop(): void {
    this.running = false;
    window.clearInterval(this.timer);
    this.drone.forEach((o) => {
      try {
        o.stop();
      } catch {
        /* уже остановлен */
      }
    });
    this.drone = [];
  }
}
