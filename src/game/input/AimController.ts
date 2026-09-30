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

/** Шаг точной подстройки с клавиатуры: угол 1°, сила 2 %. */
export const KEY_ANGLE_STEP = Math.PI / 180;
export const KEY_POWER_STEP = 0.02;
/** Сила по умолчанию для прицела с клавиатуры (без мыши). */
export const KEY_POWER_DEFAULT = 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Прицел с поправкой стрелками: угол ± dAngle (в пределах MAX_AIM_ANGLE), сила ± dPower (0…1). Чистая функция. */
export function adjustAim(a: AimResult, dAngle: number, dPower: number): AimResult {
  if (dAngle === 0 && dPower === 0) return a;
  const ang = clamp(Math.atan2(a.dirX, -a.dirY) + dAngle, -MAX_AIM_ANGLE, MAX_AIM_ANGLE);
  const power = clamp(a.power + dPower, 0, 1);
  const valid = a.valid || power > 0;
  const pull = valid ? MIN_PULL + power * (MAX_PULL - MIN_PULL) : a.pull;
  return { pull, power, dirX: Math.sin(ang), dirY: -Math.cos(ang), valid };
}

/** Прицел только с клавиатуры: угол и сила заданы явно. */
export function keyAim(angle: number, power: number): AimResult {
  const a = clamp(angle, -MAX_AIM_ANGLE, MAX_AIM_ANGLE);
  const p = clamp(power, 0, 1);
  return { pull: MIN_PULL + p * (MAX_PULL - MIN_PULL), power: p, dirX: Math.sin(a), dirY: -Math.cos(a), valid: true };
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
 * Игнорируем всё, кроме первого указателя; отмена по pointercancel, потере фокуса, коротком оттягивании,
 * правой кнопке мыши и Esc. Указатель захватывается (setPointerCapture): бросок не теряется за краем поля.
 * Клавиатура: при натяжении мышью стрелки подстраивают угол (1°) и силу (2 %), Space — бросок;
 * без мыши стрелки или Space включают прицел, Space ещё раз — бросок.
 */
export class AimController {
  state: AimState = { ...IDLE };
  /** мышь над зоной броска (подсветка сақа, курсор «рука») */
  hover = false;
  private pointerId: number | null = null;
  /** прицел по указателю без поправок и сами поправки со стрелок */
  private base: AimResult = { ...IDLE };
  private adj = { angle: 0, power: 0 };
  private keyAngle = 0;
  private keyPower = KEY_POWER_DEFAULT;
  private keyPreview = false;
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
      if (this.pointerId !== null || !this.o.canAim()) return;
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
      this.adj = { angle: 0, power: 0 };
      this.base = { ...IDLE };
      this.state = { ...IDLE, active: true, mode: 'pointer', ax: w.x, ay: w.y, cx: w.x, cy: w.y, sax: p.x, say: p.y, scx: p.x, scy: p.y };
      c.style.cursor = 'grabbing';
      this.o.onStart?.();
    });
    on(c, 'pointermove', (e: PointerEvent) => {
      if (this.pointerId === null) {
        // наведение мышью: «рука» над зоной броска
        if (e.pointerType !== 'mouse') return;
        this.hover = this.o.canAim() && this.toLogical(e).y >= AIM_ZONE_Y;
        c.style.cursor = this.hover ? 'grab' : '';
        return;
      }
      if (e.pointerId !== this.pointerId) return;
      // правая кнопка во время натяжения — отмена
      if (e.pointerType === 'mouse' && e.button === 2) {
        this.cancel();
        return;
      }
      const p = this.toLogical(e);
      const map = this.o.mapping?.() ?? null;
      // 3D: точка на земле; если луч ушёл выше горизонта — остаётся последняя валидная (оттягивание зажато)
      const w = map ? (map.toWorld(p.x, p.y) ?? { x: this.state.cx, y: this.state.cy }) : p;
      const g = map ? map.gain : 1;
      const s0 = this.state;
      this.base = computeAim(s0.ax, s0.ay, s0.ax + (w.x - s0.ax) * g, s0.ay + (w.y - s0.ay) * g);
      this.state = { ...s0, ...adjustAim(this.base, this.adj.angle, this.adj.power), cx: w.x, cy: w.y, scx: p.x, scy: p.y };
      this.o.onMove?.(this.state);
    });
    on(c, 'pointerleave', (e: PointerEvent) => {
      if (this.pointerId !== null || e.pointerType !== 'mouse') return;
      this.hover = false;
      c.style.cursor = '';
    });
    on(c, 'contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      if (this.pointerId !== null) this.cancel();
    });
    on(c, 'pointerup', (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) this.releasePointer();
    });
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

    // Esc во время натяжения — отмена (а не пауза): слушаем раньше интерфейса и гасим событие
    on(
      window,
      'keydown',
      (e: KeyboardEvent) => {
        if (e.code !== 'Escape' || (this.pointerId === null && !this.keyPreview)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.cancel();
      },
      { capture: true },
    );
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.o.canAim() || e.ctrlKey || e.metaKey || e.altKey) return;
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
    const dA = e.code === 'ArrowLeft' ? -KEY_ANGLE_STEP : e.code === 'ArrowRight' ? KEY_ANGLE_STEP : 0;
    const dP = e.code === 'ArrowUp' ? KEY_POWER_STEP : e.code === 'ArrowDown' ? -KEY_POWER_STEP : 0;
    if (dA || dP) {
      e.preventDefault();
      if (this.pointerId !== null) {
        // натяжение мышью: точная подстройка поверх жеста
        this.adj.angle += dA;
        this.adj.power += dP;
        this.state = { ...this.state, ...adjustAim(this.base, this.adj.angle, this.adj.power) };
        this.o.onMove?.(this.state);
        return;
      }
      if (!this.keyPreview) this.startKeys();
      this.keyAngle = clamp(this.keyAngle + dA, -MAX_AIM_ANGLE, MAX_AIM_ANGLE);
      this.keyPower = clamp(this.keyPower + dP, 0, 1);
      this.syncKeys();
      return;
    }
    if (e.code !== 'Space' || e.repeat) return;
    e.preventDefault();
    if (this.pointerId !== null) {
      // Space при натянутой рогатке — бросок
      this.releasePointer();
      return;
    }
    if (!this.keyPreview) {
      this.startKeys();
      return;
    }
    const s = this.state;
    this.keyPreview = false;
    this.state = { ...IDLE };
    this.o.onRelease(s.power, s.dirX, s.dirY);
  }

  private startKeys(): void {
    this.keyPreview = true;
    this.syncKeys();
    this.o.onStart?.();
  }

  private syncKeys(): void {
    this.state = { ...IDLE, ...keyAim(this.keyAngle, this.keyPower), active: true, mode: 'keys' };
    this.o.onMove?.(this.state);
  }

  /** Отпускание натяжения указателем (кнопка мыши отпущена или Space): бросок, если оттянуто достаточно. */
  private releasePointer(): void {
    const s = this.state;
    const id = this.pointerId;
    this.reset();
    if (id !== null) {
      try {
        this.o.canvas.releasePointerCapture(id);
      } catch {
        /* уже отпущен */
      }
    }
    if (s.valid && this.o.canAim()) this.o.onRelease(s.power, s.dirX, s.dirY);
    else this.o.onCancel?.();
  }

  /** Покадровое обновление: прицел с клавиатуры и подсветка гаснут, когда бросать нельзя. */
  update(_dtMs: number): void {
    if (this.o.canAim()) return;
    if (this.keyPreview) this.cancel();
    if (this.hover) {
      this.hover = false;
      this.o.canvas.style.cursor = '';
    }
  }

  private reset(): void {
    this.pointerId = null;
    this.state = { ...IDLE };
    this.o.canvas.style.cursor = this.hover ? 'grab' : '';
  }

  /** Отмена без траты попытки. */
  cancel(): void {
    const was = this.state.active || this.keyPreview;
    const id = this.pointerId;
    this.pointerId = null;
    if (id !== null) {
      try {
        this.o.canvas.releasePointerCapture(id);
      } catch {
        /* уже отпущен */
      }
    }
    this.keyPreview = false;
    this.reset();
    if (was) this.o.onCancel?.();
  }

  destroy(): void {
    this.cleanup.forEach((fn) => fn());
    this.cleanup.length = 0;
  }
}
