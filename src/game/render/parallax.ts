import type Phaser from 'phaser';
import { PARALLAX_K, PARALLAX_MAX } from '../config';
import { LAYER_MARGIN } from './textures';

interface Layer {
  img: Phaser.GameObjects.Image;
  k: number;
  period: number;
  phase: number;
}

/**
 * Параллакс фона: 3 слоя (дальний, средний, ближний). Двигаются ТОЛЬКО фон и декор;
 * кольцо силы, линия направления и граница кона рисуются плоско и не смещаются.
 * Смещение слоя = −offset·k (не более ±PARALLAX_MAX px) + медленный «дыхательный» дрейф.
 */
export class Parallax {
  private readonly layers: Layer[];
  private cur = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  enabled = true;
  /** дрейф выключается отдельно (prefers-reduced-motion) */
  drift = true;

  constructor(far: Phaser.GameObjects.Image, mid: Phaser.GameObjects.Image, near: Phaser.GameObjects.Image) {
    this.layers = [
      { img: far, k: PARALLAX_K[0], period: 8000, phase: 0 },
      { img: mid, k: PARALLAX_K[1], period: 7000, phase: 1.7 },
      { img: near, k: PARALLAX_K[2], period: 6000, phase: 3.1 },
    ];
    this.apply();
  }

  /** offset — вектор от центра экрана до указателя ИЛИ вектор оттягивания при прицеливании. */
  update(timeMs: number, dtMs: number, offsetX: number, offsetY: number): void {
    const clamp = (v: number) => Math.max(-PARALLAX_MAX, Math.min(PARALLAX_MAX, v));
    const s = 1 - Math.exp(-dtMs / 90); // сглаживание
    this.layers.forEach((l, i) => {
      let tx = 0;
      let ty = 0;
      if (this.enabled) {
        tx = clamp(-offsetX * l.k);
        ty = clamp(-offsetY * l.k);
        if (this.drift) {
          const a = 2 + i * 0.5; // амплитуда 2–3 px
          const w = (timeMs / l.period) * Math.PI * 2 + l.phase;
          tx += Math.sin(w) * a;
          ty += Math.cos(w * 0.8) * a * 0.7;
        }
      }
      this.cur[i].x += (tx - this.cur[i].x) * s;
      this.cur[i].y += (ty - this.cur[i].y) * s;
    });
    this.apply();
  }

  private apply(): void {
    this.layers.forEach((l, i) => l.img.setPosition(-LAYER_MARGIN + this.cur[i].x, -LAYER_MARGIN + this.cur[i].y));
  }
}
