import Phaser from 'phaser';
import { bus, type HudData, type StartRequest } from '../bus';
import { sfx } from '../audio/sfx';
import { decodeChallenge, challengeToLevel } from '../challenge/codec';
import { applyLevelResult, store } from '../storage/save';
import { HAPTIC, vibrate } from '../util/haptics';
import { debugStats } from '../util/observability';
import type { AsykType, BotLevel, GameMode, LevelDef, ResultEntry, ResumeState } from '../types';
import {
  AIM_ZONE_Y,
  ASYK,
  BLOCK,
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
} from './config';
import { chooseShot, type Shot } from './bot';
import { AimController, type AimState } from './input/AimController';
import { dailyLevel, dateKey } from './levels/daily';
import { endlessWave, nextReserve } from './levels/endless';
import { getLevel, nextLevelId, VERSUS_LEVEL } from './levels/levels';
import { hashString, mulberry32 } from './levels/rng';
import { Sim, type SimBody, type StepResult } from './physics/sim';
import { COIN, levelCoins, processEvent, type AchEvent } from './rules/achievements';
import { DepthTracker } from './render/depth';
import { Effects, type FxFlags } from './render/effects';
import { Parallax } from './render/parallax';
import { bakeAll, bakeLook, TEX } from './render/textures';
import { themePal } from './render/looks';
import { fitCamera, screenToGround } from './view3d/camera3d';
import type { BodySnapshot } from './view3d/sync';
import type { ThreeView } from './view3d/ThreeView';
import { Round, specId } from './rules/round';
import type { GameState } from './rules/turnState';

interface BodySprites {
  shadow: Phaser.GameObjects.Image;
  contact: Phaser.GameObjects.Image;
  body: Phaser.GameObjects.Image;
  hl: Phaser.GameObjects.Image;
  kind: 'asyk' | 'saka';
  type: AsykType;
}

interface RunCtx {
  wave: number;
  runSeed: number;
  totalScore: number;
  reserve: number;
  botLevel: BotLevel;
  dailyKey: string;
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
const BODY_TEX: Record<AsykType, string> = { normal: 'asyk', golden: 'asykGolden', heavy: 'asykHeavy', block: 'block' };

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

const finite = (n: number) => (Number.isFinite(n) ? n : 0);

export class GameScene extends Phaser.Scene {
  private S = 1;
  private sim: Sim | null = null;
  private round: Round | null = null;
  private level: LevelDef | null = null;
  private req: StartRequest = { mode: 'campaign', levelId: 1 };
  private ctx: RunCtx = { wave: 1, runSeed: 1, totalScore: 0, reserve: 0, botLevel: 'normal', dailyKey: '' };
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
  private nowMs = 0;
  private coinsEarned = 0;
  private botToken = 0;
  private botThinking = false;
  private botAim: { t: number; dur: number; shot: Shot } | null = null;
  private botRnd: () => number = mulberry32(1);
  // ---- 3D-вид (эксперимент): только отображение, физика та же
  private view3d: ThreeView | null = null;
  private view3dLoading = false;
  private worldLayers: Phaser.GameObjects.Image[] = [];
  private fps3d = { t: 0, n: 0 };
  private lost3dAt = -1;
  private idle3d: { x: number; y: number; angle: number } | null = null;
  private readonly gain3d = fitCamera().report.sakaScale;

  constructor() {
    super('game');
  }

  // ------------------------------------------------------------------ создание
  create(): void {
    this.S = Math.min(2, window.devicePixelRatio || 1);
    const S = this.S;
    bakeAll(this, S, ZONE.r, store.data.equipped);

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
    const zoneImg = this.add
      .image(ZONE.x, ZONE.y, 'zone')
      .setDisplaySize((ZONE.r + 24) * 2, (ZONE.r + 24) * 2)
      .setDepth(D_ZONE);
    this.worldLayers = [ground, far, near, zoneImg];

    this.aimGfx = this.add.graphics().setDepth(D_AIM);
    this.powerText = this.add
      .text(0, 0, '', {
        fontFamily: 'system-ui, Segoe UI, Roboto, sans-serif',
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#2b1a0e',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(D_TEXT)
      .setResolution(S)
      .setVisible(false);
    this.fx = new Effects(this, S, S, D_FX);
    this.idle = this.makeSprites('saka', 'normal');
    this.hideSprites(this.idle);

    this.aim = new AimController({
      canvas: this.game.canvas,
      canAim: () => this.canAim(),
      onStart: () => this.onAimStart(),
      onMove: (s) => this.onAimMove(s),
      onRelease: (p, dx, dy) => this.onRelease(p, dx, dy),
      onCancel: () => this.onAimCancel(),
      // 3D: точка экрана → точка на земле (по базовой, неподвижной камере — жест не «плывёт» за камерой)
      mapping: () =>
        this.view3d
          ? {
              toWorld: (sx: number, sy: number) => {
                const g = screenToGround(this.view3d!.base, sx, sy);
                return g ? { x: g.x, y: g.z } : null;
              },
              gain: this.gain3d,
            }
          : null,
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

    // Вкладка в фоне → пауза.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pauseGame();
    });

    bus.on('start', (req) => this.startRound(req));
    bus.on('continue', () => this.continueRound());
    bus.on('restart', () => this.restartRound());
    bus.on('next', () => {
      const id = nextLevelId(this.level?.id ?? 0, store.data.pro);
      if (id !== undefined) this.startRound({ mode: 'campaign', levelId: id });
      else this.toMenu();
    });
    bus.on('pause', () => this.pauseGame());
    bus.on('resume', () => this.resumeGame());
    bus.on('toMenu', () => this.toMenu());
    bus.on('look', () => {
      bakeLook(this, S, store.data.equipped);
      this.view3d?.refreshTextures();
    });
    bus.on('settings', () => this.applyViewSetting(true));
    bus.on('skipTutorial', () => {
      store.update((s) => {
        s.tutorialDone = true;
        s.unlocked = Math.max(s.unlocked, 1);
      });
      this.toMenu();
    });

    this.publish();
    this.applyViewSetting(false);
  }

  // ------------------------------------------------------------------ 3D-вид (эксперимент)
  private wants3D(): boolean {
    const q = new URLSearchParams(location.search).get('view');
    if (q === '3d') return true;
    if (q === '2d') return false;
    return store.data.view === '3d' && !store.data.view3dBlocked;
  }

  private view3dQuality: 'high' | 'low' | null = null;

  /** Включить/выключить 3D по настройке. Пересоздаёт вид при смене качества или темы. */
  private applyViewSetting(fromSettings: boolean): void {
    const want = this.wants3D();
    const q = this.quality3d();
    if (want && this.view3d && fromSettings && q !== this.view3dQuality) {
      this.disable3D();
      void this.enable3D();
      return;
    }
    if (want && !this.view3d) void this.enable3D();
    else if (!want && this.view3d) this.disable3D();
  }

  private quality3d(): 'high' | 'low' {
    const q = store.data.quality;
    return q === 'low' || (q === 'auto' && this.autoLow) ? 'low' : 'high';
  }

  private async enable3D(): Promise<void> {
    if (this.view3d || this.view3dLoading) return;
    if (!hasWebGLQuick()) {
      this.fallback2D('view3dNoWebgl');
      return;
    }
    this.view3dLoading = true;
    bus.emit('toast', { key: 'view3dLoading' });
    const quality = this.quality3d();
    const th = themePal(store.data.equipped.theme);
    try {
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000));
      const mod = await Promise.race([import('./view3d/ThreeView'), timeout]);
      const v = new mod.ThreeView(this.game.canvas.parentElement!, {
        overlay: this.game.canvas,
        canvas: (key) => (this.textures.exists(key) ? (this.textures.get(key).getSourceImage() as HTMLCanvasElement) : null),
        quality,
        reducedMotion: this.reducedMq.matches,
        palette: { sky: th.sky[0], horizon: th.sky[2], ground: th.ground[1], hemiSky: th.sky[0], hemiGround: th.ground[1] },
      });
      if (!this.wants3D()) {
        v.destroy();
        return;
      }
      this.view3d = v;
      this.view3dQuality = quality;
      this.fps3d = { t: 0, n: 0 };
      this.apply3DLayers(true);
      (window as unknown as { __asyk3d?: unknown }).__asyk3d = { stats: () => v.stats() };
    } catch {
      this.fallback2D('view3dFallback');
    } finally {
      this.view3dLoading = false;
    }
  }

  private disable3D(): void {
    const v = this.view3d;
    if (!v) return;
    this.view3d = null;
    this.idle3d = null;
    v.destroy();
    this.apply3DLayers(false);
    (window as unknown as { __asyk3d?: unknown }).__asyk3d = undefined;
  }

  /** Откат в 2D (нет WebGL, контекст потерян, FPS < 40): 3D на этом устройстве выключается до ручного включения. */
  private fallback2D(key: 'view3dFallback' | 'view3dNoWebgl'): void {
    this.disable3D();
    if (new URLSearchParams(location.search).get('view') !== '3d') store.update((s) => (s.view3dBlocked = true));
    bus.emit('toast', { key });
  }

  private apply3DLayers(on: boolean): void {
    this.worldLayers.forEach((l) => l.setVisible(!on));
    this.cameras.main.setBackgroundColor(on ? 'rgba(0,0,0,0)' : '#b8823f');
    if (on) {
      this.sprites.forEach((s) => this.hideSprites(s));
      this.hideSprites(this.idle);
    } else if (this.round?.machine.state === 'AIMING') this.showIdleSaka();
  }

  /** Координаты для оверлея (прицел, очки, пыль): в 2D — как есть, в 3D — проекция точки на земле. */
  private toScreen(x: number, y: number, h = 0): { x: number; y: number } {
    return this.view3d ? this.view3d.project(x, y, h) : { x, y };
  }

  private snapshot3D(): BodySnapshot[] {
    const sim = this.sim;
    const out: BodySnapshot[] = [];
    if (!sim) return out;
    const f = this.flags;
    for (const sb of sim.bodies.values()) {
      if (sb.removed) continue;
      let z = f.bounce ? this.depth.z(sb.id, this.nowMs) : 0;
      let alpha = 1;
      if (sb.kind === 'asyk' && sb.scored) {
        const u = Math.min(1, ((sim.tick - sb.scoredTick) * STEP_MS) / OUT_FADE_MS);
        alpha = 1 - u;
      }
      if (sb.kind === 'saka') {
        if (f.bounce) z = Math.max(z, DepthTracker.flightZ(sb.body.speed, MAX_BODY_SPEED) * 2);
        if (this.sakaFade >= 0) alpha = 0.6;
      }
      const p = sb.body.position;
      out.push({ id: sb.id, kind: sb.kind, type: sb.type, x: p.x, y: p.y, angle: sb.body.angle, z, alpha });
    }
    if (this.idle3d)
      out.push({ id: 'idle', kind: 'saka', type: 'normal', x: this.idle3d.x, y: this.idle3d.y, angle: this.idle3d.angle, z: 0, alpha: 1 });
    return out;
  }

  private update3D(dt: number): void {
    const v = this.view3d!;
    const r = this.round;
    const st = r?.machine.state;
    const a = this.aimState();
    // поза сақа на линии (натяжение при прицеливании) — та же, что в 2D
    if (r && st === 'AIMING') {
      const p0 = this.idlePos;
      if (a.active) {
        const back = Math.min(a.pull, MAX_PULL) * 0.25;
        this.idle3d = { x: p0.x - a.dirX * back, y: p0.y - a.dirY * back, angle: Math.atan2(a.dirY, a.dirX) };
        v.setCameraMode('aim', { power: a.power });
      } else {
        this.idle3d = { x: p0.x, y: p0.y, angle: -Math.PI / 2 };
        v.setCameraMode('idle');
      }
    } else {
      this.idle3d = null;
      const sk = this.sim?.saka;
      if (st === 'FLYING' && sk && sk.body.speed > 2) v.setCameraMode('follow', { x: sk.body.position.x, y: sk.body.position.y });
      else if (st === 'SETTLING' || st === 'RESOLVING' || st === 'FLYING') v.setCameraMode('settle');
      else v.setCameraMode('idle');
    }
    this.sprites.forEach((s) => this.hideSprites(s));
    this.hideSprites(this.idle);
    v.syncBodies(this.snapshot3D());
    v.render(dt);

    // потеря контекста WebGL, не восстановленная за 2 с → 2D
    if (v.lost) {
      if (this.lost3dAt < 0) this.lost3dAt = this.nowMs;
      else if (this.nowMs - this.lost3dAt > 2000) this.fallback2D('view3dFallback');
    } else this.lost3dAt = -1;

    // средний FPS < 40 за 3 с подряд во время раунда → 2D (?fpsguard=0 отключает — для программного WebGL в тестах)
    if (st && st !== 'PAUSED' && st !== 'LEVEL_INTRO' && new URLSearchParams(location.search).get('fpsguard') !== '0') {
      this.fps3d.t += dt;
      this.fps3d.n++;
      if (this.fps3d.t >= 3000) {
        const fps = (this.fps3d.n * 1000) / this.fps3d.t;
        this.fps3d = { t: 0, n: 0 };
        if (fps < 40) this.fallback2D('view3dFallback');
      }
    } else this.fps3d = { t: 0, n: 0 };
  }

  // ------------------------------------------------------------------ спрайты
  private makeSprites(kind: 'asyk' | 'saka', type: AsykType): BodySprites {
    const isSaka = kind === 'saka';
    const isBlock = type === 'block';
    const tex = isSaka ? TEX.saka : isBlock ? TEX.block : TEX.asyk;
    const shKey = isSaka ? 'shadowSaka' : isBlock ? 'shadowBlock' : 'shadowAsyk';
    const shadow = this.add.image(0, 0, shKey).setDepth(D_SHADOW);
    const contact = this.add.image(0, 0, shKey).setDepth(D_SHADOW);
    const body = this.add
      .image(0, 0, isSaka ? 'saka' : BODY_TEX[type])
      .setDepth(D_BODY)
      .setDisplaySize(tex.w, tex.h);
    const hl = this.add.image(0, 0, isSaka ? 'hlSaka' : 'hlAsyk').setDepth(D_HL);
    hl.setDisplaySize(isSaka ? 30 : 20, isSaka ? 20 : 13);
    return { shadow, contact, body, hl, kind, type };
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
    hlMul = 1,
  ): void {
    const isSaka = s.kind === 'saka';
    const isBlock = s.type === 'block';
    const tex = isSaka ? TEX.saka : isBlock ? TEX.block : TEX.asyk;
    const sh = isSaka ? TEX.shadowSaka : isBlock ? TEX.shadowBlock : TEX.shadowAsyk;
    const shKey = isSaka ? 'shadowSaka' : isBlock ? 'shadowBlock' : 'shadowAsyk';
    const simpleKey = isSaka ? 'simpleShadowSaka' : isBlock ? 'simpleShadowBlock' : 'simpleShadowAsyk';
    const base = isSaka ? SAKA : isBlock ? { w: BLOCK.size, h: BLOCK.size } : ASYK;
    const zz = flags.bounce && !isBlock ? z : 0;
    const scale = (1 + zz * 0.004) * scaleMul;
    s.body
      .setVisible(true)
      .setPosition(x, y - zz)
      .setRotation(angle)
      .setDisplaySize(tex.w * scale, tex.h * scale)
      .setAlpha(alpha);
    if (isBlock) s.hl.setVisible(false);
    else
      s.hl
        .setVisible(true)
        .setPosition(x + HL_OFFSET.x * scale, y - zz + HL_OFFSET.y * scale)
        .setAlpha(alpha * 0.9 * hlMul);
    // Тень: смещение задаётся направлением света, а не углом тела; растёт и светлеет с z.
    const off = SHADOW_OFFSET + zz * 0.9;
    if (flags.soft) {
      s.shadow
        .setTexture(shKey)
        .setVisible(true)
        .setPosition(x + off, y + off * 1.1)
        .setRotation(angle)
        .setDisplaySize(sh.w * scaleMul, sh.h * scaleMul)
        .setAlpha(Math.max(0.1, (0.85 - zz * 0.05) * alpha));
      s.contact
        .setTexture(shKey)
        .setVisible(zz < 1)
        .setPosition(x + 1, y + 1.5)
        .setRotation(angle)
        .setDisplaySize(sh.w * 0.82 * scaleMul, sh.h * 0.82 * scaleMul)
        .setAlpha(0.5 * alpha);
    } else {
      s.contact.setVisible(false);
      s.shadow
        .setTexture(simpleKey)
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
  private canAim(): boolean {
    const r = this.round;
    if (!r || r.machine.state !== 'AIMING') return false;
    if (r.mode === 'duel' && r.player === 1) return false;
    return true;
  }

  private buildLevel(req: StartRequest): LevelDef | null {
    switch (req.mode) {
      case 'versus':
      case 'duel':
        return VERSUS_LEVEL;
      case 'daily':
        return dailyLevel(req.dailyKey ?? dateKey());
      case 'endless':
        return endlessWave(this.ctx.runSeed, this.ctx.wave, this.ctx.reserve);
      case 'custom': {
        if (!req.code) return null;
        const d = decodeChallenge(req.code);
        return d.ok ? challengeToLevel(d.challenge) : null;
      }
      default:
        try {
          return getLevel(req.levelId);
        } catch {
          return null;
        }
    }
  }

  private clearWorld(): void {
    this.sprites.forEach((s) => this.destroySprites(s));
    this.sprites.clear();
    this.sim = null;
    this.timers = [];
    this.pendingOut = [];
    this.sakaFade = -1;
    this.botToken++;
    this.botThinking = false;
    this.botAim = null;
    this.hideSprites(this.idle);
    this.aim.cancel();
  }

  private restartRound(): void {
    const req = { ...this.req };
    if (req.mode === 'endless') req.runSeed = undefined; // «Ещё раз» — новый забег
    this.startRound(req);
  }

  private startRound(req: StartRequest, resume?: ResumeState): void {
    this.clearWorld();
    this.req = { ...req };
    this.coinsEarned = 0;
    const ex = resume?.extra;
    this.ctx = {
      wave: ex?.wave ?? 1,
      runSeed: ex?.runSeed ?? req.runSeed ?? (hashString(String(Date.now())) >>> 0) % 1000000,
      totalScore: ex?.totalScore ?? 0,
      reserve: ex?.reserve ?? 0,
      botLevel: ex?.botLevel ?? req.botLevel ?? 'normal',
      dailyKey: ex?.dailyKey ?? req.dailyKey ?? dateKey(),
    };
    let level: LevelDef | null;
    if (resume) {
      level = {
        id: resume.level.id,
        nameKey: resume.level.nameKey,
        name: resume.level.name,
        throws: resume.level.throws ?? Infinity,
        par: resume.level.par,
        zone: resume.level.zone,
        asyks: resume.level.asyks,
      };
    } else {
      level = this.buildLevel(req);
    }
    if (!level) {
      bus.emit('toast', { key: 'badLink' });
      this.toMenu();
      return;
    }
    this.setupRound(level, req.mode, resume);
  }

  private continueRound(): void {
    const rs = store.data.resume;
    if (!rs) return;
    this.startRound(
      {
        mode: rs.mode,
        levelId: rs.levelId,
        botLevel: rs.extra.botLevel,
        dailyKey: rs.extra.dailyKey,
        challengeScore: rs.extra.challengeScore,
        challengeName: rs.extra.challengeName,
        runSeed: rs.extra.runSeed,
      },
      rs,
    );
  }

  private setupRound(level: LevelDef, mode: GameMode, resume?: ResumeState): void {
    this.level = level;

    const M = (Phaser.Physics.Matter as any).Matter;
    const sim = new Sim(M, level.zone);
    this.sim = sim;
    level.asyks.forEach((a, i) => {
      const id = specId(a, i);
      sim.addAsyk(id, a);
      this.sprites.set(id, this.makeSprites('asyk', a.type ?? 'normal'));
    });
    const easy = store.data.difficulty === 'easy' && (mode === 'campaign' || mode === 'training');
    this.round = new Round(mode, level, { bonusThrows: easy ? 1 : 0, snapshot: resume?.round });
    this.firstThrow = Boolean(resume) && resume!.round.throwsUsed > 0;
    this.tutorial = mode === 'campaign' && level.id === 0;
    this.acc = 0;
    if (mode === 'duel') this.botRnd = mulberry32(hashString(`bot:${Date.now()}`));
    this.round.machine.go('LEVEL_INTRO');
    this.syncAll();
    this.publish();
    bus.emit('state', 'LEVEL_INTRO');
    this.after(700, () => this.enterAiming(true));
  }

  private enterAiming(first = false): void {
    const r = this.round;
    if (!r) return;
    r.machine.go('AIMING');
    this.showIdleSaka();
    this.publish();
    bus.emit('state', 'AIMING');
    if (this.tutorial) bus.emit('tutorial', { step: r.throwsUsed === 0 ? 0 : 3 });
    if (r.isVersus) bus.emit('turn', { player: r.player });
    this.writeResume();
    if (first && r.throwsUsed === 0) this.announceNewTypes();
    if (r.mode === 'duel' && r.player === 1) void this.botTurn();
  }

  /** Короткая подсказка о новом типе тела — один раз (seenHints). */
  private announceNewTypes(): void {
    const level = this.level;
    if (!level) return;
    for (const t of ['golden', 'heavy', 'block'] as const) {
      if (level.asyks.some((a) => a.type === t) && !store.data.seenHints.includes(t)) {
        bus.emit('hint', { type: t });
        return;
      }
    }
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

  // ------------------------------------------------------------------ «Продолжить»
  /** После каждого разрешённого броска пишем состояние: тела неподвижны, восстановление точное. */
  private writeResume(): void {
    const r = this.round;
    const sim = this.sim;
    const lv = this.level;
    if (!r || !sim || !lv) return;
    if (r.mode === 'training') return;
    if (r.mode === 'campaign' && lv.id === 0) return;
    if (r.mode === 'custom' && this.req.editorTest) return;
    const asyks = sim
      .asyks()
      .filter((b) => !b.scored)
      .map((b) => ({ id: b.id, x: b.body.position.x, y: b.body.position.y, angle: b.body.angle, type: b.type }));
    if (asyks.length === 0) return;
    const rs: ResumeState = {
      v: 1,
      ts: Date.now(),
      mode: r.mode,
      levelId: lv.id,
      level: {
        id: lv.id,
        nameKey: lv.nameKey,
        name: lv.name,
        throws: Number.isFinite(lv.throws) ? lv.throws : null,
        par: lv.par,
        zone: lv.zone,
        asyks,
      },
      round: r.snapshot(),
      extra: {
        wave: r.mode === 'endless' ? this.ctx.wave : undefined,
        runSeed: r.mode === 'endless' ? this.ctx.runSeed : undefined,
        totalScore: r.mode === 'endless' ? this.ctx.totalScore : undefined,
        reserve: r.mode === 'endless' ? this.ctx.reserve : undefined,
        botLevel: r.mode === 'duel' ? this.ctx.botLevel : undefined,
        dailyKey: r.mode === 'daily' ? this.ctx.dailyKey : undefined,
        challengeScore: this.req.challengeScore,
        challengeName: this.req.challengeName,
      },
    };
    store.update((s) => {
      s.resume = rs;
    });
  }

  // ------------------------------------------------------------------ бот
  private async botTurn(): Promise<void> {
    const sim = this.sim;
    const level = this.level;
    const r = this.round;
    if (!sim || !level || !r) return;
    const token = ++this.botToken;
    this.botThinking = true;
    this.publish();
    const specs = sim
      .asyks()
      .filter((b) => !b.scored)
      .map((b) => ({ x: b.body.position.x, y: b.body.position.y, angle: b.body.angle, type: b.type }));

    const M = (Phaser.Physics.Matter as any).Matter;
    const { shot } = await chooseShot(M, level.zone, specs, this.ctx.botLevel, this.botRnd, { deadlineMs: 800 });
    if (token !== this.botToken || !this.round) return;
    this.botThinking = false;
    // анимация «бот целится»: видимое оттягивание сақа 600–900 мс
    this.botAim = { t: 0, dur: 600 + Math.round(this.botRnd() * 300), shot };
    this.publish();
  }

  private aimState(): AimState {
    const b = this.botAim;
    if (b) {
      const u = Math.min(1, b.t / b.dur);
      const eased = 1 - Math.pow(1 - u, 2);
      const power = b.shot.power * eased;
      return {
        active: true,
        mode: 'keys',
        ax: 0,
        ay: 0,
        cx: 0,
        cy: 0,
        sax: 0,
        say: 0,
        scx: 0,
        scy: 0,
        pull: 24 + power * 146,
        power,
        dirX: b.shot.dirX,
        dirY: b.shot.dirY,
        valid: true,
      };
    }
    return this.aim.state;
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
    this.sprites.set('saka', this.makeSprites('saka', 'normal'));
    this.hideSprites(this.idle);
    r.beginThrow();
    debugStats.throws++;
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
      if (this.botAim && r.machine.state === 'AIMING') {
        this.botAim.t += dt;
        if (this.botAim.t >= this.botAim.dur) {
          const s = this.botAim.shot;
          this.botAim = null;
          this.onRelease(s.power, s.dirX, s.dirY);
        }
      }
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
    if (this.view3d) {
      this.update3D(dt);
      this.drawAim3D(time);
      return;
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
      const t0 = performance.now();
      const res = sim.step();
      debugStats.simMs += performance.now() - t0;
      debugStats.steps++;
      this.processStep(res);
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

  private isBody(id: string): boolean {
    return id !== 'wall';
  }

  private processStep(res: StepResult): void {
    const f = this.flags;
    const fxFlags: FxFlags = { motion: f.motion };
    const r = this.round!;
    for (const h of res.hits) {
      if (this.isBody(h.a)) this.depth.onHit(h.a, h.impulse, this.nowMs);
      if (this.isBody(h.b)) this.depth.onHit(h.b, h.impulse, this.nowMs);
      if ((h.a === 'saka' && this.isBody(h.b) && h.b !== 'saka') || (h.b === 'saka' && this.isBody(h.a) && h.a !== 'saka')) {
        this.sakaHitAsyk = true;
        if (h.impulse > 4) {
          if (this.view3d) this.view3d.kick();
          else this.fx.bump(fxFlags);
        }
      }
      if (h.impulse > 1.5) {
        const sp = this.toScreen(h.x, h.y);
        this.fx.dust(sp.x, sp.y, Math.min(1, h.impulse / 14), fxFlags);
      }
      if (h.impulse > 0.8 && this.nowMs - this.lastHitSound > 45) {
        this.lastHitSound = this.nowMs;
        sfx.hit(h.impulse / 14);
        vibrate(HAPTIC.hit);
      }
    }
    for (const id of res.newlyScored) {
      if (r.typeOf(id) === 'block') continue;
      this.pendingOut.push(id);
      sfx.out();
      vibrate(HAPTIC.out);
      const sb = this.sim!.bodies.get(id);
      if (sb) {
        const sp = this.view3d
          ? this.toScreen(sb.body.position.x, sb.body.position.y, 40)
          : { x: sb.body.position.x, y: sb.body.position.y - 24 };
        bus.emit('float', { x: sp.x, y: sp.y, text: `+${r.valueOf(id)}`, kind: 'pts' });
      }
    }
    for (const id of res.removed) {
      const s = this.sprites.get(id);
      if (s) {
        this.destroySprites(s);
        this.sprites.delete(id);
      }
    }
  }

  private ach(ev: AchEvent): void {
    const out = processEvent(store.data, ev);
    store.persist();
    this.coinsEarned += out.coins;
    out.unlocked.forEach((id) => bus.emit('achievement', { id }));
  }

  private addCoins(n: number): void {
    if (n <= 0) return;
    store.update((s) => {
      s.coins += n;
    });
    this.coinsEarned += n;
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
      if (this.view3d) this.view3d.kick();
      else this.fx.shake({ motion: this.flags.motion });
      const cp = this.toScreen(ZONE.x, ZONE.y, 60);
      bus.emit('float', { x: cp.x, y: cp.y, text: `+${points}`, kind: 'combo' });
      sfx.combo(k);
      vibrate(HAPTIC.combo);
    }
    if (r.mode !== 'training') {
      store.update((s) => {
        s.stats.throws++;
        s.stats.asyksOut += k;
        if (k > 0) s.stats.hits++;
      });
      this.ach({ type: 'throw', mode: r.mode, k, golden: res.goldenOut });
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
      if (res.next === 'AIMING') this.enterAiming();
      else this.finish(res.next);
    });
  }

  private pushHistory(entry: ResultEntry): void {
    store.update((s) => {
      s.history.push(entry);
      if (s.history.length > 50) s.history.splice(0, s.history.length - 50);
    });
  }

  private finish(next: 'LEVEL_COMPLETE' | 'LEVEL_FAILED'): void {
    const r = this.round!;
    const level = this.level!;
    r.machine.go(next);
    const summary = r.summary();
    const win = next === 'LEVEL_COMPLETE';
    const mode = r.mode;
    let newRecord = false;
    let bestStars: 0 | 1 | 2 | 3 = summary.stars;
    let dailyBest: number | undefined;

    store.update((s) => {
      s.resume = null;
    });

    // ---- бесконечный режим: очищенная волна ведёт к следующей без экрана итога
    if (mode === 'endless' && win) {
      this.ctx.totalScore += summary.score;
      this.ctx.reserve = nextReserve(this.ctx.reserve);
      this.ctx.wave++;
      this.addCoins(COIN.wave);
      store.update((s) => {
        s.endlessBest.wave = Math.max(s.endlessBest.wave, this.ctx.wave);
        s.endlessBest.score = Math.max(s.endlessBest.score, this.ctx.totalScore);
      });
      this.ach({ type: 'wave', wave: this.ctx.wave });
      sfx.win();
      this.publish();
      bus.emit('state', next);
      bus.emit('banner', { key: 'waveN', params: { n: this.ctx.wave } });
      this.after(1000, () => {
        const lv = endlessWave(this.ctx.runSeed, this.ctx.wave, this.ctx.reserve);
        this.clearWorld();
        this.setupRound(lv, 'endless');
      });
      return;
    }

    this.ach({
      type: 'levelEnd',
      mode,
      cleared: summary.cleared,
      throwsLeft: finite(r.throwsLeft),
      botHardWon: mode === 'duel' && this.ctx.botLevel === 'hard' && summary.winner === 0,
    });

    let endless: ResultDataEndless | undefined;
    if (mode === 'campaign') {
      const first = store.data.levels[String(level.id)] === undefined;
      store.update((s) => {
        const info = applyLevelResult(s, level.id, summary.score, summary.stars);
        newRecord = info.newRecord && summary.score > 0;
        bestStars = info.bestStars;
        if (level.id === 0 && summary.cleared) s.tutorialDone = true;
      });
      if (win && !(level.id === 0 && !first)) this.addCoins(levelCoins(summary.stars));
    } else if (mode === 'daily') {
      const key = this.ctx.dailyKey;
      const firstToday = store.data.daily[key] === undefined;
      store.update((s) => {
        const prev = s.daily[key]?.best ?? 0;
        newRecord = summary.score > prev;
        s.daily[key] = { best: Math.max(prev, summary.score) };
        dailyBest = s.daily[key].best;
      });
      if (firstToday) this.addCoins(COIN.daily);
      this.ach({ type: 'daily', date: key });
    } else if (mode === 'endless') {
      const total = this.ctx.totalScore + summary.score;
      const reached = this.ctx.wave;
      let newBest = false;
      store.update((s) => {
        newBest = total > s.endlessBest.score;
        s.endlessBest.score = Math.max(s.endlessBest.score, total);
        s.endlessBest.wave = Math.max(s.endlessBest.wave, reached);
      });
      endless = { wave: reached, total, best: store.data.endlessBest.score, newBest, runSeed: this.ctx.runSeed };
      newRecord = newBest;
    }

    if (mode !== 'training' && !(mode === 'custom' && this.req.editorTest)) {
      this.pushHistory({
        ts: Date.now(),
        mode,
        ref: mode === 'daily' ? this.ctx.dailyKey : mode === 'endless' ? `w${this.ctx.wave}` : `L${level.id}`,
        score: endless ? endless.total : summary.score,
        stars: summary.stars,
        throws: summary.throwsUsed,
        combo: summary.bestCombo,
      });
    }

    this.publish();
    bus.emit('state', next);
    const nextId = mode === 'campaign' && win ? nextLevelId(level.id, store.data.pro) : undefined;
    this.after(450, () => {
      if (win) sfx.win();
      else sfx.lose();
      bus.emit('tutorial', { step: -1 });
      bus.emit('result', {
        summary: endless ? { ...summary, score: endless.total } : summary,
        mode,
        levelId: level.id,
        name: level.name,
        newRecord,
        bestStars,
        hasNext: nextId !== undefined,
        dailyBest,
        dailyKey: mode === 'daily' ? this.ctx.dailyKey : undefined,
        endless,
        editorTest: this.req.editorTest,
        botLevel: mode === 'duel' ? this.ctx.botLevel : undefined,
        challenge:
          mode === 'custom'
            ? { code: this.req.code, shortId: this.req.shortId, friendName: this.req.challengeName, friendScore: this.req.challengeScore }
            : this.req.challengeScore !== undefined
              ? { friendName: this.req.challengeName, friendScore: this.req.challengeScore }
              : undefined,
        coins: this.coinsEarned,
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
          name: this.level?.name,
          score: r.mode === 'endless' ? this.ctx.totalScore + r.score : r.score,
          throwsLeft: r.isVersus ? r.versusThrowsLeft(0) + r.versusThrowsLeft(1) : r.throwsLeft,
          throwsTotal: r.throwsAllowed,
          asyksLeft: r.asyksLeft,
          asykTotal: r.asykTotal,
          player: r.player,
          scores: [r.scores[0], r.scores[1]],
          versusLeft: [r.versusThrowsLeft(0), r.versusThrowsLeft(1)],
          wave: r.mode === 'endless' ? this.ctx.wave : undefined,
          botLevel: r.mode === 'duel' ? this.ctx.botLevel : undefined,
          botThinking: this.botThinking || this.botAim !== null,
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
    let hlMul = 1;
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
    if (sb.type === 'golden') hlMul = 0.7 + 0.3 * Math.sin(this.nowMs / 210 + p.x * 0.05); // мерцание
    this.place(sp, p.x, p.y, sb.body.angle, z, alpha, scale, f, hlMul);
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
    const botTurn = r.mode === 'duel' && r.player === 1;
    // линия броска и зона касания
    if (!botTurn) {
      g.fillStyle(0xf6ecd0, 0.06);
      g.fillRect(0, AIM_ZONE_Y, FIELD_W, FIELD_H - AIM_ZONE_Y);
    }
    g.lineStyle(3, 0x16a5a3, 0.55);
    for (let x = 30; x < FIELD_W - 30; x += 28) g.lineBetween(x, THROW_LINE_Y + 34, x + 16, THROW_LINE_Y + 34);

    const a = this.aimState();
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
    this.powerText
      .setVisible(a.valid || a.mode === 'keys')
      .setPosition(p0.x, p0.y + 84)
      .setText(`${Math.round(power * 100)}%`)
      .setColor('#ffffff');

    if (a.valid || a.mode === 'keys') {
      // «Лёгкий» режим: длинная направляющая с грубой дальностью (v / frictionAir)
      if (store.data.difficulty === 'easy' && !botTurn) {
        const v = POWER_MIN + (POWER_MAX - POWER_MIN) * power;
        const reach = Math.min(v / SAKA.frictionAir, 1000);
        g.fillStyle(0xf6ecd0, 0.55);
        for (let d = 90; d < reach; d += 24) g.fillCircle(p0.x + a.dirX * d, p0.y + a.dirY * d, 3);
        g.lineStyle(3, 0xf6ecd0, 0.7);
        g.strokeCircle(p0.x + a.dirX * reach, p0.y + a.dirY * reach, 16);
      }
      // пунктир направления: длина зависит от силы (полную траекторию не рисуем)
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

  // ------------------------------------------------------------------ прицел в 3D: точки на земле → проекция на экран
  private lineW(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number): void {
    const a = this.toScreen(x1, y1);
    const b = this.toScreen(x2, y2);
    g.lineBetween(a.x, a.y, b.x, b.y);
  }

  private circleW(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, from = 0, to = Math.PI * 2): void {
    const n = Math.max(8, Math.ceil(((to - from) / (Math.PI * 2)) * 48));
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      const p = this.toScreen(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.strokePath();
  }

  private drawAim3D(time: number): void {
    const g = this.aimGfx;
    g.clear();
    const r = this.round;
    if (!r || r.machine.state !== 'AIMING') {
      this.powerText.setVisible(false);
      return;
    }
    const botTurn = r.mode === 'duel' && r.player === 1;
    // линия броска на земле
    g.lineStyle(3, 0x16a5a3, 0.75);
    for (let x = 30; x < FIELD_W - 30; x += 28) this.lineW(g, x, THROW_LINE_Y + 34, x + 16, THROW_LINE_Y + 34);

    const a = this.aimState();
    const p0 = this.idlePos;
    if (!a.active) {
      g.lineStyle(2, 0xf6ecd0, 0.45);
      this.circleW(g, p0.x, p0.y, 46);
      return;
    }
    const power = a.power;
    const col = powerColor(power);
    // кольцо силы — лежит на земле вокруг сақа
    const pulse = power > 0.97 ? Math.sin(time / 70) * 3 : 0;
    const R = 50 + pulse;
    g.lineStyle(8, 0x2b1a0e, 0.35);
    this.circleW(g, p0.x, p0.y, R);
    if (a.valid || a.mode === 'keys') {
      g.lineStyle(8, col, 1);
      this.circleW(g, p0.x, p0.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, power));
    }
    const sp = this.toScreen(p0.x, p0.y);
    this.powerText
      .setVisible(a.valid || a.mode === 'keys')
      .setPosition(sp.x, Math.min(FIELD_H - 24, sp.y + 76))
      .setText(`${Math.round(power * 100)}%`)
      .setColor('#ffffff');

    if (a.valid || a.mode === 'keys') {
      // в 3D направляющая длиннее, чем в 2D (глубину оценивать труднее); на «Лёгком» — ещё длиннее
      const easy = store.data.difficulty === 'easy' && !botTurn;
      if (easy) {
        const v = POWER_MIN + (POWER_MAX - POWER_MIN) * power;
        const reach = Math.min(v / SAKA.frictionAir, 1000);
        g.fillStyle(0xf6ecd0, 0.6);
        for (let d = 90; d < reach; d += 24) {
          const q = this.toScreen(p0.x + a.dirX * d, p0.y + a.dirY * d);
          g.fillCircle(q.x, q.y, 3);
        }
        g.lineStyle(3, 0xf6ecd0, 0.75);
        this.circleW(g, p0.x + a.dirX * reach, p0.y + a.dirY * reach, 16);
      }
      const start = 70;
      const len = (60 + power * 360) * (easy ? 1.3 : 1);
      g.lineStyle(6, col, 0.95);
      for (let d = 0; d < len; d += 26) {
        const d2 = Math.min(len, d + 14);
        this.lineW(g, p0.x + a.dirX * (start + d), p0.y + a.dirY * (start + d), p0.x + a.dirX * (start + d2), p0.y + a.dirY * (start + d2));
      }
      const ex = p0.x + a.dirX * (start + len + 6);
      const ey = p0.y + a.dirY * (start + len + 6);
      const nx = -a.dirY;
      const ny = a.dirX;
      const t1 = this.toScreen(ex + a.dirX * 16, ey + a.dirY * 16);
      const t2 = this.toScreen(ex + nx * 11, ey + ny * 11);
      const t3 = this.toScreen(ex - nx * 11, ey - ny * 11);
      g.fillStyle(col, 1);
      g.fillTriangle(t1.x, t1.y, t2.x, t2.y, t3.x, t3.y);
    }
    // «резинка» жеста — в экранных координатах пальца
    if (a.mode === 'pointer') {
      g.lineStyle(3, 0xf6ecd0, 0.55);
      g.lineBetween(a.sax, a.say, a.scx, a.scy);
      g.strokeCircle(a.sax, a.say, 12);
      g.fillStyle(0xf6ecd0, 0.7);
      g.fillCircle(a.scx, a.scy, 8);
    }
  }
}

/** Быстрая проверка WebGL без загрузки Three.js. */
function hasWebGLQuick(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

interface ResultDataEndless {
  wave: number;
  total: number;
  best: number;
  newBest: boolean;
  runSeed: number;
}
