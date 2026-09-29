import Phaser from 'phaser';

export interface FxFlags {
  /** пыль, шейк, толчок камеры */
  motion: boolean;
}

/**
 * «Сочность»: пыль при ударе, screen-shake на комбо, камерный толчок.
 * Только визуал — физика этих эффектов не видит. Math.random используется ТОЛЬКО здесь.
 */
export class Effects {
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private bumping = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly baseZoom: number,
    private readonly S: number,
    private readonly depth: number,
  ) {}

  dust(x: number, y: number, strength: number, flags: FxFlags): void {
    if (!flags.motion) return;
    const n = Math.min(5, 2 + Math.round(strength * 3));
    for (let i = 0; i < n; i++) {
      const img = this.pool.find((p) => !p.active) ?? this.make();
      if (!img) return;
      const ang = Math.random() * Math.PI * 2;
      const dist = 8 + Math.random() * 16 * (0.6 + strength);
      const size = 12 + Math.random() * 10;
      img.setActive(true).setVisible(true).setPosition(x, y).setAlpha(0.7).setDisplaySize(size, size);
      this.scene.tweens.add({
        targets: img,
        x: x + Math.cos(ang) * dist,
        y: y + Math.sin(ang) * dist,
        alpha: 0,
        displayWidth: size * 2.2,
        displayHeight: size * 2.2,
        duration: 380 + Math.random() * 160,
        ease: 'Cubic.easeOut',
        onComplete: () => img.setActive(false).setVisible(false),
      });
    }
  }

  private make(): Phaser.GameObjects.Image | null {
    if (this.pool.length >= 28) return null;
    const img = this.scene.add.image(0, 0, 'dust').setDepth(this.depth).setActive(false).setVisible(false);
    this.pool.push(img);
    return img;
  }

  shake(flags: FxFlags): void {
    if (flags.motion) this.scene.cameras.main.shake(140, 0.004);
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
