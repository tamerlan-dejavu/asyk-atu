import Phaser from 'phaser';
import { FIELD_W } from '../config';

export interface FxFlags {
  /** пыль, шейк, толчок камеры, частицы */
  motion: boolean;
  /** тяжёлые частицы (искры, угольки, след) — только на высоком/среднем качестве */
  rich?: boolean;
}

/** Вид следа сақа по скину. */
export type TrailKind = 'none' | 'sparks' | 'glow' | 'neon' | 'embers';

/** Частица из пула: состояние хранится в массиве, обновляется покадрово без аллокаций. */
interface P {
  img: Phaser.GameObjects.Image;
  on: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** ускорение вниз (угольки падают, искры — нет) */
  g: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  a0: number;
}

/** Максимум частиц одновременно (ТЗ: не более 150). */
export const MAX_PARTICLES = 150;

/**
 * «Сочность»: пыль, искры, вспышки, волны, след сақа, тряска и толчок камеры.
 * Только визуал — физика этих эффектов не видит. Math.random используется ТОЛЬКО здесь.
 */
export class Effects {
  private readonly pool: P[] = [];
  private bumping = false;
  private trailTick = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly baseZoom: number,
    private readonly S: number,
    private readonly depth: number,
  ) {}

  /** Свободная частица; при переполнении — самая «старая» (меньше всего осталось жить). */
  private take(tex: string): P | null {
    let p = this.pool.find((q) => !q.on);
    if (!p && this.pool.length < MAX_PARTICLES) {
      const img = this.scene.add.image(0, 0, tex).setDepth(this.depth).setVisible(false);
      p = { img, on: false, x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0, max: 1, s0: 1, s1: 1, a0: 1 };
      this.pool.push(p);
    }
    if (!p) {
      p = this.pool.reduce((a, b) => (b.life < a.life ? b : a));
    }
    if (p.img.texture.key !== tex) p.img.setTexture(tex);
    return p;
  }

  private emit(
    tex: string,
    x: number,
    y: number,
    o: { vx?: number; vy?: number; g?: number; life: number; s0: number; s1: number; a0?: number; tint?: number; add?: boolean },
  ): void {
    const p = this.take(tex);
    if (!p) return;
    p.on = true;
    p.x = x;
    p.y = y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.g = o.g ?? 0;
    p.life = p.max = o.life;
    p.s0 = o.s0;
    p.s1 = o.s1;
    p.a0 = o.a0 ?? 1;
    p.img
      .setVisible(true)
      .setPosition(x, y)
      .setDisplaySize(o.s0, o.s0)
      .setAlpha(p.a0)
      .setBlendMode(o.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    if (o.tint !== undefined) p.img.setTint(o.tint);
    else p.img.clearTint();
  }

  /** Покадровое обновление всех частиц (мс). */
  update(dt: number): void {
    const k = dt / 1000;
    for (const p of this.pool) {
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.on = false;
        p.img.setVisible(false);
        continue;
      }
      p.vy += p.g * k;
      p.x += p.vx * k;
      p.y += p.vy * k;
      const u = 1 - p.life / p.max;
      const s = p.s0 + (p.s1 - p.s0) * u;
      p.img
        .setPosition(p.x, p.y)
        .setDisplaySize(s, s)
        .setAlpha(p.a0 * (1 - u) * (1 - u * 0.2));
    }
  }

  get active(): number {
    return this.pool.reduce((n, p) => n + (p.on ? 1 : 0), 0);
  }

  dust(x: number, y: number, strength: number, flags: FxFlags): void {
    if (!flags.motion) return;
    const n = Math.min(6, 2 + Math.round(strength * 4));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (20 + Math.random() * 40) * (0.6 + strength);
      const size = 12 + Math.random() * 10;
      this.emit('dust', x, y, {
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 380 + Math.random() * 160,
        s0: size,
        s1: size * 2.2,
        a0: 0.7,
      });
    }
  }

  /** Искры: яркие точки разлетаются из точки удара. */
  sparks(x: number, y: number, color: number, n: number, speed: number, flags: FxFlags, gravity = 0): void {
    if (!flags.motion || !flags.rich) return;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = speed * (0.5 + Math.random() * 0.8);
      this.emit('spark', x, y, {
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - (gravity ? 60 : 0),
        g: gravity,
        life: 260 + Math.random() * 240,
        s0: 7 + Math.random() * 5,
        s1: 2,
        tint: color,
        add: true,
      });
    }
  }

  /** Вспышка в точке удара. */
  flash(x: number, y: number, size: number, color: number, flags: FxFlags): void {
    if (!flags.motion) return;
    this.emit('spark', x, y, { life: 140, s0: size * 0.6, s1: size * 1.4, tint: color, a0: 0.9, add: true });
  }

  /** Расходящаяся волна-кольцо. */
  wave(x: number, y: number, size: number, color: number, flags: FxFlags): void {
    if (!flags.motion) return;
    this.emit('ringFx', x, y, { life: 360, s0: size * 0.3, s1: size, tint: color, a0: 0.85 });
  }

  /** След сақа в полёте по цвету скина; kind — особые частицы (дракон — искры, лава — угольки…). */
  trail(x: number, y: number, color: number, kind: TrailKind, flags: FxFlags): void {
    if (!flags.motion || !flags.rich) return;
    this.trailTick++;
    if (this.trailTick % 2) return;
    this.emit('spark', x, y, {
      life: 260,
      s0: kind === 'glow' || kind === 'neon' ? 16 : 11,
      s1: 3,
      tint: color,
      a0: kind === 'none' ? 0.45 : 0.75,
      add: true,
    });
    if (kind === 'sparks' && this.trailTick % 4 === 0) this.sparks(x, y, color, 2, 90, flags);
    if (kind === 'embers' && this.trailTick % 4 === 0) this.sparks(x, y, 0xff7a2a, 2, 50, flags, 260);
    if (kind === 'neon') this.emit('spark', x, y, { life: 420, s0: 22, s1: 10, tint: color, a0: 0.35, add: true });
  }

  /** Тряска камеры: амплитуда в логических px (не больше 4), длительность в мс. */
  shake(flags: FxFlags, amplitude = 3, ms = 140): void {
    if (!flags.motion) return;
    const px = Math.min(4, amplitude);
    this.scene.cameras.main.shake(ms, px / FIELD_W);
  }

  /** «Камерный толчок»: масштаб сцены 1.00 → 1.02 → 1.00 за ~150 мс. */
  bump(flags: FxFlags): void {
    if (!flags.motion || this.bumping) return;
    this.bumping = true;
    const cam = this.scene.cameras.main;
    this.scene.tweens.add({
      targets: cam,
      zoom: this.baseZoom * 1.02,
      duration: 75,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => {
        cam.setZoom(this.baseZoom);
        this.bumping = false;
      },
    });
    void this.S;
  }
}
