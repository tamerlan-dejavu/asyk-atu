import Phaser from 'phaser';
import { bus, type HudData } from '../bus';
import { sfx } from '../audio/sfx';
import { applyLevelResult, store } from '../storage/save';
import type { GameMode, LevelDef } from '../types';
import {
  ASYK,
  FIELD_H,
  FIELD_W,
  MAX_BODY_SPEED,
  MAX_PULL,
  OUT_FADE_MS,
  POWER_MAX,
  POWER_MIN,
  SAKA,
  SAKA_START,
  SHADOW_OFFSET,
  STEP_MS,
  THROW_LINE_Y,
  ZONE,
  AIM_ZONE_Y,
} from './config';
import { AimController, type AimState } from './input/AimController';
import { dailyLevel, dateKey } from './levels/daily';
import { getLevel, VERSUS_LEVEL } from './levels/levels';
import { Sim, type SimBody, type StepResult } from './physics/sim';
import { DepthTracker } from './render/depth';
import { Effects, type FxFlags } from './render/effects';
import { Parallax } from './render/parallax';
import { bakeAll, TEX } from './render/textures';
import { Round } from './rules/round';
import type { GameState } from './rules/turnState';

interface BodySprites {
  shadow: Phaser.GameObjects.Image;
  contact: Phaser.GameObjects.Image;
  body: Phaser.GameObjects.Image;
  hl: Phaser.GameObjects.Image;
  kind: 'asyk' | 'saka';
}

const D_GROUND = 0;
const D_FAR = 1;
const D_ZONE = 2;
const D_SHADOW = 4;
const D_BODY = 5;
const D_HL = 6;
const D_FX = 7;
const D_AIM = 8;
const D_NEAR = 9;
const D_TEXT = 10;

const HL_OFFSET = { x: -7, y: -6 }; // источник света сверху-слева: блик не вращается вместе с телом

declare global {
  interface Window {
    __asyk?: { state: GameState; throwsLeft: number; score: number; mode: GameMode | null; asyksLeft: number };
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** Цвет шкалы силы: слабо (зелёный) → средне (жёлтый) → сильно (красный). */
export function powerColor(p: number): number {
  return p < 0.5 ? lerpColor(0x3fbf5a, 0xf2c230, p * 2) : lerpColor(0xf2c230, 0xe5482f, (p - 0.5) * 2);
}

export class GameScene extends Phaser.Scene {
  private S = 1;
  private sim: Sim | null = null;
  private round: Round | null = null;
  private level: LevelDef | null = null;
  private sprites = new Map<string, BodySprites>();
  private acc = 0;
  private aim!: AimController;
  private parallax!: Parallax;
  private fx!: Effects;
  private depth = new DepthTracker();
  private aimGfx!: Phaser.GameObjects.Graphics;
  private powerText!: Phaser.GameObjects.Text;
  private idle!: BodySprites;
  private pendingOut: string[] = [];
  private sakaHitAsyk = false;
  private timers: { t: number; fn: () => void }[] = [];
  private firstThrow = false;
  private tutorial = false;
  private sakaFade = -1;
  private pointerOffset = { x: 0, y: 0 };
  private lastHitSound = 0;
  private autoLow = false;
  private fpsAcc = { t: 0, n: 0 };
  private reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  private startedMode: GameMode = 'campaign';
  private startedLevel = 1;
  private nowMs = 0;

  constructor() {
    super('game');
  }

  // ------------------------------------------------------------------ создание
  create(): void {
    this.S = Math.min(2, window.devicePixelRatio || 1);
    const S = this.S;
    bakeAll(this, S, ZONE.r);

    // Камера: мировые координаты остаются логическими 720×1080, изображение — чётким на HiDPI.
    const cam = this.cameras.main;
    cam.setZoom(S);
    cam.setScroll((FIELD_W / 2) * (1 - S), (FIELD_H / 2) * (1 - S));
    cam.setBackgroundColor('#b8823f');

    const gw = FIELD_W + 48;
    const gh = FIELD_H + 48;
    const ground = this.add.image(-24, -24, 'ground').setOrigin(0, 0).setDisplaySize(gw, gh).setDepth(D_GROUND);
    const far = this.add.image(-24, -24, 'far').setOrigin(0, 0).setDisplaySize(gw, 190).setDepth(D_FAR);
    const near = this.add.image(-24, -24, 'near').setOrigin(0, 0).setDisplaySize(gw, gh).setDepth(D_NEAR);
    this.parallax = new Parallax(far, ground, near);
    this.add
      .image(ZONE.x, ZONE.y, 'zone')
      .setDisplaySize((ZONE.r + 24) * 2, (ZONE.r + 24) * 2)
      .setDepth(D_ZONE);

    this.aimGfx = this.add.graphics().setDepth(D_AIM);
    this.powerText = this.add
      .text(0, 0, '', { fontFamily: 'system-ui, Segoe UI, Roboto, sans-serif', fontSize: '30px', fontStyle: 'bold', color: '#ffffff', stroke: '#2b1a0e', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(D_TEXT)
      .setResolution(S)
      .setVisible(false);
    this.fx = new Effects(this, S, S, D_FX);
    this.idle = this.makeSprites('saka');
    this.idle.body.setVisible(false);
    this.hideSprites(this.idle);

    this.aim = new AimController({
      canvas: this.game.canvas,
      canAim: () => this.round?.machine.state === 'AIMING',
      onStart: () => this.onAimStart(),
      onMove: (s) => this.onAimMove(s),
      onRelease: (p, dx, dy) => this.onRelease(p, dx, dy),
      onCancel: () => this.onAimCancel(),
    });

    // Указатель для параллакса (только десктоп: на телефоне остаётся дрейф).
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const r = this.game.canvas.getBoundingClientRect();
      this.pointerOffset.x = ((e.clientX - r.left) / r.width - 0.5) * FIELD_W;
      this.pointerOffset.y = ((e.clientY - r.top) / r.height - 0.5) * FIELD_H;
    };
    window.addEventListener('pointermove', move);

    const unlock = () => sfx.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    // Вкладка в фоне / потеря фокуса → пауза.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pauseGame();
    });

    bus.on('start', ({ mode, levelId }) => this.startRound(mode, levelId));
    bus.on('restart', () => this.startRound(this.startedMode, this.startedLevel));
    bus.on('next', () => this.startRound(this.startedMode, this.startedLevel + 1));
    bus.on('pause', () => this.pauseGame());
    bus.on('resume', () => this.resumeGame());
    bus.on('toMenu', () => this.toMenu());
    bus.on('skipTutorial', () => {
      store.update((s) => {
        s.tutorialDone = true;
        s.unlocked = Math.max(s.unlocked, 1);
      });
      this.toMenu();
    });

    this.publish();
  }

  // ------------------------------------------------------------------ спрайты
  private makeSprites(kind: 'asyk' | 'saka'): BodySprites {
    const isA = kind === 'asyk';
    const tex = isA ? TEX.asyk : TEX.saka;
    const shadow = this.add.image(0, 0, isA ? 'shadowAsyk' : 'shadowSaka').setDepth(D_SHADOW);
    const contact = this.add.image(0, 0, isA ? 'shadowAsyk' : 'shadowSaka').setDepth(D_SHADOW);
    const body = this.add.image(0, 0, isA ? 'asyk' : 'saka').setDepth(D_BODY).setDisplaySize(tex.w, tex.h);
    const hl = this.add.image(0, 0, isA ? 'hlAsyk' : 'hlSaka').setDepth(D_HL);
    hl.setDisplaySize(isA ? 20 : 30, isA ? 13 : 20);
    return { shadow, contact, body, hl, kind };
  }

  private hideSprites(s: BodySprites): void {
    s.shadow.setVisible(false);
    s.contact.setVisible(false);
    s.body.setVisible(false);
    s.hl.setVisible(false);
  }

  private destroySprites(s: BodySprites): void {
    s.shadow.destroy();
    s.contact.destroy();
    s.body.destroy();
    s.hl.destroy();
  }

  /** Расставляет спрайты тела. Только визуал: положение берётся из физики, обратно ничего не пишется. */
  private place(
    s: BodySprites,
    x: number,
    y: number,
    angle: number,
    z: number,
    alpha: number,
    scaleMul: number,
    flags: { soft: boolean; bounce: boolean },
  ): void {
    const isA = s.kind === 'asyk';
    const tex = isA ? TEX.asyk : TEX.saka;
    const sh = isA ? TEX.shadowAsyk : TEX.shadowSaka;
    const base = isA ? ASYK : SAKA;
    const zz = flags.bounce ? z : 0;
    const scale = (1 + zz * 0.004) * scaleMul;
    s.body.setVisible(true).setPosition(x, y - zz).setRotation(angle).setDisplaySize(tex.w * scale, tex.h * scale).setAlpha(alpha);
    s.hl.setVisible(true).setPosition(x + HL_OFFSET.x * scale, y - zz + HL_OFFSET.y * scale).setAlpha(alpha * 0.9);
    // Тень: смещение задаётся направлением света, а не углом тела; растёт и светлеет с z.
    const off = SHADOW_OFFSET + zz * 0.9;
    if (flags.soft) {
      s.shadow
        .setTexture(isA ? 'shadowAsyk' : 'shadowSaka')
        .setVisible(true)
        .setPosition(x + off, y + off * 1.1)
        .setRotation(angle)
        .setDisplaySize(sh.w * scaleMul, sh.h * scaleMul)
        .setAlpha(Math.max(0.1, (0.85 - zz * 0.05) * alpha));
      s.contact
        .setTexture(isA ? 'shadowAsyk' : 'shadowSaka')
        .setVisible(zz < 1)
        .setPosition(x + 1, y + 1.5)
        .setRotation(angle)
        .setDisplaySize(sh.w * 0.82 * scaleMul, sh.h * 0.82 * scaleMul)
        .setAlpha(0.5 * alpha);
    } else {
      s.contact.setVisible(false);
      s.shadow
        .setTexture(isA ? 'simpleShadowAsyk' : 'simpleShadowSaka')
        .setVisible(true)
        .setPosition(x + 4, y + 5)
        .setRotation(angle)
        .setDisplaySize((base.w + 4) * scaleMul, (base.h + 4) * scaleMul)
        .setAlpha(alpha);
    }
  }

  // ------------------------------------------------------------------ качество / доступность
  private get flags(): { soft: boolean; bounce: boolean; parallax: boolean; drift: boolean; motion: boolean } {
    const q = store.data.quality;
    const low = q === 'low' || (q === 'auto' && this.autoLow);
    const reduced = this.reducedMq.matches;
    return { soft: !low, bounce: !low && !reduced, parallax: !low && !reduced, drift: !low && !reduced, motion: !reduced };
  }

  // ------------------------------------------------------------------ раунд
  private buildLevel(mode: GameMode, levelId: number): LevelDef {
    if (mode === 'versus') return VERSUS_LEVEL;
    if (mode === 'daily') return dailyLevel(dateKey());
    return getLevel(levelId);
  }

  private clearWorld(): void {
    this.sprites.forEach((s) => this.destroySprites(s));
    this.sprites.clear();
    this.sim = null;
    this.timers = [];
    this.pendingOut = [];
    this.sakaFade = -1;
    this.hideSprites(this.idle);
    this.aim.cancel();
  }

  private startRound(mode: GameMode, levelId: number): void {
    this.clearWorld();
    if (mode === 'campaign' && levelId > 5) {
      this.toMenu();
      return;
    }
    this.startedMode = mode;
    this.startedLevel = levelId;
    const level = this.buildLevel(mode, levelId);
    this.level = level;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const M = (Phaser.Physics.Matter as any).Matter;
    this.sim = new Sim(M, level.zone);
    level.asyks.forEach((a, i) => {
      const id = `a${i}`;
      this.sim!.addAsyk(id, a);
      this.sprites.set(id, this.makeSprites('asyk'));
    });
    this.round = new Round(mode, level);
    this.firstThrow = false;
    this.tutorial = mode === 'campaign' && levelId === 0;
    this.acc = 0;
    this.round.machine.go('LEVEL_INTRO');
    this.syncAll();
    this.publish();
    bus.emit('state', 'LEVEL_INTRO');
    this.after(700, () => {
      if (!this.round) return;
      this.round.machine.go('AIMING');
      this.showIdleSaka();
      this.publish();
      bus.emit('state', 'AIMING');
      if (this.tutorial) bus.emit('tutorial', { step: 0 });
      if (mode === 'versus') bus.emit('turn', { player: this.round.player });
    });
  }

  private toMenu(): void {
    this.clearWorld();
    this.round = null;
    this.level = null;
    bus.emit('tutorial', { step: -1 });
    bus.emit('state', 'MENU');
    this.publish();
  }

  private pauseGame(): void {
    const r = this.round;
    if (!r || !r.machine.pause()) return;
    this.aim.cancel();
    bus.emit('state', 'PAUSED');
    this.publish();
  }

  private resumeGame(): void {
    const r = this.round;
    if (!r || !r.machine.resume()) return;
    this.acc = 0;
    bus.emit('state', r.machine.state);
    this.publish();
  }

  private after(ms: number, fn: () => void): void {
    this.timers.push({ t: ms, fn });
  }

  // ------------------------------------------------------------------ ввод
  private get idlePos(): { x: number; y: number } {
    return SAKA_START;
  }

  private showIdleSaka(): void {
    const p = this.idlePos;
    this.place(this.idle, p.x, p.y, -Math.PI / 2, 0, 1, 1, this.flags);
  }

  private onAimStart(): void {
    sfx.click();
    if (this.tutorial && this.round?.throwsUsed === 0) bus.emit('tutorial', { step: 0 });
  }

  private onAimMove(s: AimState): void {
    if (this.tutorial && s.valid) bus.emit('tutorial', { step: 1 });
  }

  private onAimCancel(): void {
    this.powerText.setVisible(false);
    if (this.tutorial && this.round?.machine.state === 'AIMING') bus.emit('tutorial', { step: this.round.throwsUsed === 0 ? 0 : 3 });
  }

  private onRelease(power: number, dirX: number, dirY: number): void {
    const r = this.round;
    const sim = this.sim;
    if (!r || !sim || r.machine.state !== 'AIMING') return;
    this.powerText.setVisible(false);
    const v = POWER_MIN + (POWER_MAX - POWER_MIN) * power;
    sim.launchSaka(dirX * v, dirY * v, Math.atan2(dirY, dirX));
    this.sprites.set('saka', this.makeSprites('saka'));
    this.hideSprites(this.idle);
    r.beginThrow();
    this.firstThrow = true;
    this.pendingOut = [];
    this.sakaHitAsyk = false;
    this.sakaFade = -1;
    sfx.throwSound(power);
    if (this.tutorial) bus.emit('tutorial', { step: 2 });
    this.publish();
    bus.emit('state', r.machine.state);
  }

  // ------------------------------------------------------------------ цикл
  update(time: number, delta: number): void {
    const dt = Math.min(delta, 100);
    this.nowMs = time;
    this.aim.update(dt);
    this.monitorFps(dt);
    const f = this.flags;
    this.parallax.enabled = f.parallax;
    this.parallax.drift = f.drift;

    const r = this.round;
    const st = r?.machine.state;
    if (r && st !== 'PAUSED') {
      this.tickTimers(dt);
      if (r.machine.state === 'FLYING' || r.machine.state === 'SETTLING') this.stepPhysics(dt);
    }

    // параллакс: при прицеливании — вектор оттягивания, иначе — положение указателя
    const a = this.aim.state;
    let ox = this.pointerOffset.x;
    let oy = this.pointerOffset.y;
    if (a.active && a.mode === 'pointer') {
      ox = a.cx - a.ax;
      oy = a.cy - a.ay;
    }
    if (st !== 'PAUSED') this.parallax.update(time, dt, ox, oy);

    this.syncAll();
    this.drawAim(time);
  }

  private tickTimers(dt: number): void {
    if (this.timers.length === 0) return;
    const due: (() => void)[] = [];
    this.timers = this.timers.filter((tm) => {
      tm.t -= dt;
      if (tm.t <= 0) {
        due.push(tm.fn);
        return false;
      }
      return true;
    });
    due.forEach((fn) => fn());
  }

  /** Автопереключение качества: FPS < 45 в среднем за 2 с → «Низкое». */
  private monitorFps(dt: number): void {
    if (store.data.quality !== 'auto' || this.autoLow) return;
    const st = this.round?.machine.state;
    if (!st || st === 'PAUSED' || st === 'LEVEL_INTRO') {
      this.fpsAcc = { t: 0, n: 0 };
      return;
    }
    this.fpsAcc.t += dt;
    this.fpsAcc.n++;
    if (this.fpsAcc.t >= 2000) {
      const fps = (this.fpsAcc.n * 1000) / this.fpsAcc.t;
      if (fps < 45) this.autoLow = true;
      this.fpsAcc = { t: 0, n: 0 };
    }
  }

  private stepPhysics(dt: number): void {
    const sim = this.sim!;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP_MS && n < 4) {
      this.processStep(sim.step());
      this.acc -= STEP_MS;
      n++;
      if (sim.settled) break;
    }
    if (n >= 4) this.acc = 0;

    const r = this.round!;
    if (r.machine.state === 'FLYING') {
      const sk = sim.saka;
      if (this.sakaHitAsyk || (sk && sk.body.speed < 3)) r.machine.go('SETTLING');
    }
    if (sim.settled && (r.machine.state === 'FLYING' || r.machine.state === 'SETTLING')) {
      if (r.machine.state === 'FLYING') r.machine.go('SETTLING');
      this.resolve();
    }
  }

  private processStep(res: StepResult): void {
    const f = this.flags;
    const fxFlags: FxFlags = { motion: f.motion };
    for (const h of res.hits) {
      const asykOrSaka = (id: string) => id === 'saka' || id.startsWith('a');
      if (asykOrSaka(h.a)) this.depth.onHit(h.a, h.impulse, this.nowMs);
      if (asykOrSaka(h.b)) this.depth.onHit(h.b, h.impulse, this.nowMs);
      if ((h.a === 'saka' && h.b.startsWith('a')) || (h.b === 'saka' && h.a.startsWith('a'))) {
        this.sakaHitAsyk = true;
        if (h.impulse > 4) this.fx.bump(fxFlags);
      }
      if (h.impulse > 1.5) this.fx.dust(h.x, h.y, Math.min(1, h.impulse / 14), fxFlags);
      if (h.impulse > 0.8 && this.nowMs - this.lastHitSound > 45) {
        this.lastHitSound = this.nowMs;
        sfx.hit(h.impulse / 14);
      }
    }
    for (const id of res.newlyScored) {
      this.pendingOut.push(id);
      sfx.out();
      const sb = this.sim!.bodies.get(id);
      if (sb) bus.emit('float', { x: sb.body.position.x, y: sb.body.position.y - 24, text: '+10', kind: 'pts' });
    }
    for (const id of res.removed) {
      const s = this.sprites.get(id);
      if (s) {
        this.destroySprites(s);
        this.sprites.delete(id);
      }
    }
  }

  /** Ход окончен: подсчёт очков, затем следующий бросок / итог. */
  private resolve(): void {
    const r = this.round!;
    const sim = this.sim!;
    r.machine.go('RESOLVING');
    sim.endThrow();
    const res = r.resolveThrow(this.pendingOut);
    const { k, points } = res.outcome;
    if (k >= 2) {
      this.fx.shake({ motion: this.flags.motion });
      bus.emit('float', { x: ZONE.x, y: ZONE.y, text: `+${points}`, kind: 'combo' });
      sfx.combo(k);
    }
    if (r.mode !== 'training') {
      store.update((s) => {
        s.stats.throws++;
        s.stats.asyksOut += k;
        if (k > 0) s.stats.hits++;
      });
    }
    this.publish();
    bus.emit('state', r.machine.state);

    // Сақа плавно исчезает (~250 мс), затем следующий бросок — без «мёртвых» пауз.
    this.sakaFade = 0;
    this.after(250, () => {
      sim.dropSaka();
      const s = this.sprites.get('saka');
      if (s) {
        this.destroySprites(s);
        this.sprites.delete('saka');
      }
      this.sakaFade = -1;
      if (!this.round) return;
      if (res.next === 'AIMING') {
        r.machine.go('AIMING');
        this.showIdleSaka();
        if (this.tutorial) bus.emit('tutorial', { step: 3 });
        if (r.mode === 'versus') bus.emit('turn', { player: r.player });
        this.publish();
        bus.emit('state', r.machine.state);
      } else {
        this.finish(res.next);
      }
    });
  }

  private finish(next: 'LEVEL_COMPLETE' | 'LEVEL_FAILED'): void {
    const r = this.round!;
    r.machine.go(next);
    const summary = r.summary();
    let newRecord = false;
    let bestStars: 0 | 1 | 2 | 3 = summary.stars;
    let dailyBest: number | undefined;
    const levelId = this.level!.id;
    if (r.mode === 'campaign') {
      store.update((s) => {
        const info = applyLevelResult(s, levelId, summary.score, summary.stars);
        newRecord = info.newRecord && summary.score > 0;
        bestStars = info.bestStars;
        if (levelId === 0 && summary.cleared) s.tutorialDone = true;
      });
    } else if (r.mode === 'daily') {
      const key = dateKey();
      store.update((s) => {
        const prev = s.daily[key]?.best ?? 0;
        newRecord = summary.score > prev;
        s.daily[key] = { best: Math.max(prev, summary.score) };
        dailyBest = s.daily[key].best;
      });
    }
    this.publish();
    bus.emit('state', next);
    const win = next === 'LEVEL_COMPLETE';
    this.after(450, () => {
      if (win) sfx.win();
      else sfx.lose();
      bus.emit('tutorial', { step: -1 });
      bus.emit('result', {
        summary,
        levelId,
        newRecord,
        bestStars,
        hasNext: r.mode === 'campaign' && win && levelId < 5,
        dailyBest,
      });
    });
  }

  // ------------------------------------------------------------------ синхронизация с UI
  private publish(): void {
    const r = this.round;
    const hud: HudData = r
      ? {
          mode: r.mode,
          levelId: this.level?.id ?? 0,
          score: r.score,
          throwsLeft: r.mode === 'versus' ? r.versusThrowsLeft(0) + r.versusThrowsLeft(1) : r.throwsLeft,
          throwsTotal: r.throwsAllowed,
          asyksLeft: r.asyksLeft,
          asykTotal: r.asykTotal,
          player: r.player,
          scores: [r.scores[0], r.scores[1]],
          versusLeft: [r.versusThrowsLeft(0), r.versusThrowsLeft(1)],
          showHint: !this.firstThrow && !this.tutorial,
        }
      : {
          mode: 'campaign',
          levelId: 0,
          score: 0,
          throwsLeft: 0,
          throwsTotal: 0,
          asyksLeft: 0,
          asykTotal: 0,
          player: 0,
          scores: [0, 0],
          versusLeft: [0, 0],
          showHint: false,
        };
    bus.emit('hud', hud);
    window.__asyk = {
      state: r?.machine.state ?? 'MENU',
      throwsLeft: hud.throwsLeft,
      score: hud.score,
      mode: r?.mode ?? null,
      asyksLeft: hud.asyksLeft,
    };
  }

  // ------------------------------------------------------------------ отрисовка тел
  private syncAll(): void {
    const sim = this.sim;
    if (!sim) return;
    const f = this.flags;
    for (const sb of sim.bodies.values()) {
      const sp = this.sprites.get(sb.id);
      if (!sp || sb.removed) continue;
      this.syncBody(sb, sp, f);
    }
  }

  private syncBody(sb: SimBody, sp: BodySprites, f: { soft: boolean; bounce: boolean }): void {
    const p = sb.body.position;
    let z = this.depth.z(sb.id, this.nowMs);
    let alpha = 1;
    let scale = 1;
    if (sb.kind === 'asyk' && sb.scored) {
      // вылет и исчезновение (~OUT_FADE_MS)
      const u = Math.min(1, ((this.sim!.tick - sb.scoredTick) * STEP_MS) / OUT_FADE_MS);
      alpha = 1 - u;
      scale = 1 + 0.25 * u;
      z = Math.max(z, 10 * Math.sin(Math.PI * u));
    }
    if (sb.kind === 'saka') {
      z = Math.max(z, DepthTracker.flightZ(sb.body.speed, MAX_BODY_SPEED));
      if (this.sakaFade >= 0) alpha = 0.55;
    }
    this.place(sp, p.x, p.y, sb.body.angle, z, alpha, scale, f);
  }

  // ------------------------------------------------------------------ прицел (плоский, не искажается параллаксом)
  private drawAim(time: number): void {
    const g = this.aimGfx;
    g.clear();
    const r = this.round;
    if (!r || r.machine.state !== 'AIMING') {
      this.powerText.setVisible(false);
      return;
    }
    // линия броска и зона касания
    g.fillStyle(0xf6ecd0, 0.06);
    g.fillRect(0, AIM_ZONE_Y, FIELD_W, FIELD_H - AIM_ZONE_Y);
    g.lineStyle(3, 0x16a5a3, 0.55);
    for (let x = 30; x < FIELD_W - 30; x += 28) g.lineBetween(x, THROW_LINE_Y + 34, x + 16, THROW_LINE_Y + 34);

    const a = this.aim.state;
    const p0 = this.idlePos;
    if (!a.active) {
      // покой: сақа на линии, лёгкое «дыхание»
      const pulse = 1 + Math.sin(time / 420) * 0.012;
      this.place(this.idle, p0.x, p0.y, -Math.PI / 2, 0, 1, pulse, this.flags);
      g.lineStyle(2, 0xf6ecd0, 0.35);
      g.strokeCircle(p0.x, p0.y, 46);
      return;
    }
    const power = a.power;
    const col = powerColor(power);
    const ang = Math.atan2(a.dirY, a.dirX);
    // сақа «натягивается»: отъезжает назад и вытягивается вдоль броска
    const back = Math.min(a.pull, MAX_PULL) * 0.25;
    const sx = p0.x - a.dirX * back;
    const sy = p0.y - a.dirY * back;
    this.place(this.idle, sx, sy, ang, 0, 1, 1 + power * 0.06, this.flags);

    // кольцо силы с процентом
    const pulse = power > 0.97 ? Math.sin(time / 70) * 3 : 0;
    const R = 50 + pulse;
    g.lineStyle(8, 0x2b1a0e, 0.35);
    g.strokeCircle(p0.x, p0.y, R);
    if (a.valid || a.mode === 'keys') {
      g.lineStyle(8, col, 1);
      g.beginPath();
      g.arc(p0.x, p0.y, R, Phaser.Math.DegToRad(-90), Phaser.Math.DegToRad(-90 + 360 * Math.max(0.02, power)), false);
      g.strokePath();
    }
    this.powerText.setVisible(a.valid || a.mode === 'keys').setPosition(p0.x, p0.y + 84).setText(`${Math.round(power * 100)}%`).setColor('#ffffff');

    // пунктир направления: длина зависит от силы (полную траекторию не рисуем)
    if (a.valid || a.mode === 'keys') {
      const start = 70;
      const len = 60 + power * 240;
      g.lineStyle(6, col, 0.95);
      for (let d = 0; d < len; d += 26) {
        const d2 = Math.min(len, d + 14);
        g.lineBetween(p0.x + a.dirX * (start + d), p0.y + a.dirY * (start + d), p0.x + a.dirX * (start + d2), p0.y + a.dirY * (start + d2));
      }
      const ex = p0.x + a.dirX * (start + len + 6);
      const ey = p0.y + a.dirY * (start + len + 6);
      const nx = -a.dirY;
      const ny = a.dirX;
      g.fillStyle(col, 1);
      g.fillTriangle(ex + a.dirX * 16, ey + a.dirY * 16, ex + nx * 11, ey + ny * 11, ex - nx * 11, ey - ny * 11);
    }
    // «резинка» жеста: якорь → палец
    if (a.mode === 'pointer') {
      g.lineStyle(3, 0xf6ecd0, 0.55);
      g.lineBetween(a.ax, a.ay, a.cx, a.cy);
      g.strokeCircle(a.ax, a.ay, 12);
      g.fillStyle(0xf6ecd0, 0.7);
      g.fillCircle(a.cx, a.cy, 8);
    }
  }
}
