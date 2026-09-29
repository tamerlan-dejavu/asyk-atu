import { BOUNCE_IMPULSE_MIN, BOUNCE_MS } from '../config';

/**
 * Визуальная «z-высота» тел (подпрыгивание при ударе). ТОЛЬКО ВИЗУАЛ:
 * физика, «выбит», очки и прицеливание этого значения не видят.
 * Чистый класс без Phaser — тестируется в Node.
 */
export class DepthTracker {
  private readonly jumps = new Map<string, { t0: number; peak: number }>();

  /** Удар с относительной скоростью `impulse` (px/шаг) в момент nowMs. */
  onHit(id: string, impulse: number, nowMs: number): void {
    if (impulse < BOUNCE_IMPULSE_MIN) return;
    const peak = Math.min(10, 6 + (impulse - BOUNCE_IMPULSE_MIN) * 0.5);
    this.jumps.set(id, { t0: nowMs, peak });
  }

  /** Высота над землёй в px (0 — на земле): взлёт и возврат за BOUNCE_MS, парабола (ease-out к концу). */
  z(id: string, nowMs: number): number {
    const j = this.jumps.get(id);
    if (!j) return 0;
    const u = (nowMs - j.t0) / BOUNCE_MS;
    if (u >= 1) {
      this.jumps.delete(id);
      return 0;
    }
    return j.peak * 4 * u * (1 - u);
  }

  /** Сақа «летит»: z по силе броска и затухает вместе со скоростью. */
  static flightZ(speed: number, maxSpeed: number): number {
    return Math.min(1, speed / maxSpeed) * 8;
  }
}
