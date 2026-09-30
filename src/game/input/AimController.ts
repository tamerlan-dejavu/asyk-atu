import { AIM_ZONE_Y, FIELD_H, FIELD_W, MAX_AIM_ANGLE, MAX_PULL, MIN_PULL } from '../config';

export interface AimResult {
  /** длина оттягивания, px */
  pull: number;
  /** 0…1 (между MIN_PULL и MAX_PULL) */
  power: number;
  /** единичный вектор направления броска (противоположен оттягиванию, всегда «вверх») */
  dirX: number;
  dirY: number;
  /** оттягивание достаточно для броска (≥ MIN_PULL) */
  valid: boolean;
}

/** Чистая математика прицеливания: якорь − текущая точка. Тестируется без DOM. */
export function computeAim(ax: number, ay: number, cx: number, cy: number): AimResult {
  const rx = ax - cx;
  const ry = ay - cy;
  const len = Math.hypot(rx, ry);
  const clamped = Math.min(MAX_PULL, len);
  const power = clamped <= MIN_PULL ? 0 : (clamped - MIN_PULL) / (MAX_PULL - MIN_PULL);
  // угол от «строго вверх», ограничен, чтобы нельзя было бросить назад
  let a = len > 0 ? Math.atan2(rx, -ry) : 0;
  if (a > MAX_AIM_ANGLE) a = MAX_AIM_ANGLE;
  if (a < -MAX_AIM_ANGLE) a = -MAX_AIM_ANGLE;
  return { pull: len, power, dirX: Math.sin(a), dirY: -Math.cos(a), valid: len >= MIN_PULL };
}

export interface AimState extends AimResult {
  active: boolean;
  mode: 'pointer' | 'keys';
  ax: number;
  ay: number;
  cx: number;
  cy: number;
  /** экранные (логические) координаты якоря и пальца — для «резинки» жеста в 3D */
  sax: number;
  say: number;
  scx: number;
  scy: number;
}

/** Преобразование ввода для 3D-вида: экран → точка на земле; gain — усиление оттягивания. */
export interface AimMapping {
  toWorld: (sx: number, sy: number) => { x: number; y: number } | null;
  gain: number;
}

export interface AimOptions {
  canvas: HTMLCanvasElement;
  /** ввод разрешён только в состоянии AIMING */
  canAim: () => boolean;
  onStart?: () => void;
  onMove?: (s: AimState) => void;
  onRelease: (power: number, dirX: number, dirY: number) => void;
  onCancel?: () => void;
  /** 3D-вид: где на земле находится точка экрана (null — 2D, экран = мир) */
  mapping?: () => AimMapping | null;
}

const IDLE: AimState = {
  active: false,
  mode: 'pointer',
  ax: 0,
  ay: 0,
  cx: 0,
  cy: 0,
  sax: 0,
  say: 0,
  scx: 0,
  scy: 0,
  pull: 0,
  power: 0,
  dirX: 0,
  dirY: -1,
  valid: false,
};

/**
 * Прицеливание на Pointer Events (мышь и палец одним кодом).
 * Игнорируем всё, кроме первого указателя; отмена по pointercancel, потере фокуса и коротком оттягивании.
 * P2: клавиатура — стрелки поворачивают, пробел удерживать для силы, отпустить для броска.
 */
export class AimController {
  state: AimState = { ...IDLE };
  private pointerId: number | null = null;
  private keyAngle = 0;
  private keyPreview = false;
  private charging = false;
  private chargeT = 0;
  private keys = { left: false, right: false };
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly o: AimOptions) {
    this.attach();
  }

  private toLogical(e: PointerEvent): { x: number; y: number } {
    const r = this.o.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * FIELD_W) / r.width, y: ((e.clientY - r.top) * FIELD_H) / r.height };
  }

  private attach(): void {
    const c = this.o.canvas;
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement | Window | Document,
      ev: string,
      fn: (e: never) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(ev, fn as EventListener, opts);
      this.cleanup.push(() => el.removeEventListener(ev, fn as EventListener, opts));
      return undefined as unknown as K;
    };

    on(c, 'pointerdown', (e: PointerEvent) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (this.pointerId !== null || this.charging || !this.o.canAim()) return;
      const p = this.toLogical(e);
      if (p.y < AIM_ZONE_Y) return;
      const map = this.o.mapping?.() ?? null;
      const w = map ? map.toWorld(p.x, p.y) : p;
      if (!w) return;
      e.preventDefault();
      this.pointerId = e.pointerId;
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* не критично */
      }
      this.keyPreview = false;
      this.state = { ...IDLE, active: true, mode: 'pointer', ax: w.x, ay: w.y, cx: w.x, cy: w.y, sax: p.x, say: p.y, scx: p.x, scy: p.y };
      this.o.onStart?.();
    });
    on(c, 'pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      const p = this.toLogical(e);
      const map = this.o.mapping?.() ?? null;
      // 3D: точка на земле; если луч ушёл выше горизонта — остаётся последняя валидная (оттягивание зажато)
      const w = map ? (map.toWorld(p.x, p.y) ?? { x: this.state.cx, y: this.state.cy }) : p;
      const g = map ? map.gain : 1;
      const s0 = this.state;
      const a = computeAim(s0.ax, s0.ay, s0.ax + (w.x - s0.ax) * g, s0.ay + (w.y - s0.ay) * g);
      this.state = { ...s0, ...a, cx: w.x, cy: w.y, scx: p.x, scy: p.y };
      this.o.onMove?.(this.state);
    });
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      const s = this.state;
      this.reset();
      if (s.valid && this.o.canAim()) this.o.onRelease(s.power, s.dirX, s.dirY);
      else this.o.onCancel?.();
    };
    on(c, 'pointerup', finish);
    on(c, 'pointercancel', (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) this.cancel();
    });
    on(c, 'lostpointercapture', (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) this.cancel();
    });
    on(window, 'blur', () => this.cancel());
    on(document, 'visibilitychange', () => {
      if (document.hidden) this.cancel();
    });

    // клавиатура (P2)
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (!this.o.canAim()) return;
      if (e.code === 'ArrowLeft') this.keys.left = true;
      else if (e.code === 'ArrowRight') this.keys.right = true;
      else if (e.code === 'Space' && !e.repeat && this.pointerId === null) {
        this.charging = true;
        this.chargeT = 0;
        this.o.onStart?.();
      } else return;
      this.keyPreview = true;
      e.preventDefault();
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft') this.keys.left = false;
      else if (e.code === 'ArrowRight') this.keys.right = false;
      else if (e.code === 'Space' && this.charging) {
        const s = this.state;
        this.charging = false;
        this.keyPreview = false;
        this.state = { ...IDLE };
        if (this.o.canAim() && s.power > 0.02) {
          this.o.onRelease(s.power, s.dirX, s.dirY);
        } else this.o.onCancel?.();
      }
    });
  }

  /** Покадровое обновление клавиатурного режима. */
  update(dtMs: number): void {
    if (this.pointerId !== null) return;
    if (!this.o.canAim()) {
      if (this.charging || this.keyPreview) this.cancel();
      return;
    }
    const dt = dtMs / 1000;
    if (this.keys.left) this.keyAngle -= 1.3 * dt;
    if (this.keys.right) this.keyAngle += 1.3 * dt;
    this.keyAngle = Math.max(-MAX_AIM_ANGLE, Math.min(MAX_AIM_ANGLE, this.keyAngle));
    if (!this.keyPreview) return;
    let power = 0;
    if (this.charging) {
      this.chargeT += dt;
      const ph = (this.chargeT * 0.8) % 2;
      power = ph < 1 ? ph : 2 - ph; // туда-обратно
    }
    this.state = {
      ...IDLE,
      active: true,
      mode: 'keys',
      power,
      pull: MIN_PULL + power * (MAX_PULL - MIN_PULL),
      valid: this.charging,
      dirX: Math.sin(this.keyAngle),
      dirY: -Math.cos(this.keyAngle),
    };
  }

  private reset(): void {
    this.pointerId = null;
    this.state = { ...IDLE };
  }

  /** Отмена без траты попытки. */
  cancel(): void {
    const was = this.state.active || this.charging;
    if (this.pointerId !== null) {
      try {
        this.o.canvas.releasePointerCapture(this.pointerId);
      } catch {
        /* уже отпущен */
      }
    }
    this.charging = false;
    this.keyPreview = false;
    this.keys = { left: false, right: false };
    this.reset();
    if (was) this.o.onCancel?.();
  }

  destroy(): void {
    this.cleanup.forEach((fn) => fn());
    this.cleanup.length = 0;
  }
}
