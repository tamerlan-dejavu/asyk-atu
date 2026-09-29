import type Phaser from 'phaser';
import { ASYK, FIELD_H, FIELD_W, SAKA } from '../config';
import { bonePolygon } from '../physics/bodies';
import { mulberry32 } from '../levels/rng';

/** Поля вокруг слоёв параллакса, чтобы при сдвиге не открывались края. */
export const LAYER_MARGIN = 24;
export const FAR_H = 190;
const PAD = 8; // запас вокруг тел в текстуре

type Ctx = CanvasRenderingContext2D;

/** Палитра игры: тёплая земля (охра, терракота), акцент — бирюза (көк). */
export const PAL = {
  ochre: '#c8975a',
  ochreDark: '#a9763a',
  terracotta: '#9a4526',
  brown: '#3a2412',
  cream: '#f6ecd0',
  turquoise: '#16a5a3',
  turquoiseDark: '#0e7f7d',
};

function bake(scene: Phaser.Scene, key: string, w: number, h: number, S: number, draw: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, Math.ceil(w * S), Math.ceil(h * S));
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.scale(S, S);
  draw(ctx);
  tex.refresh();
}

function polyPath(ctx: Ctx, pts: { x: number; y: number }[], cx: number, cy: number, grow = 0): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const len = Math.hypot(p.x, p.y) || 1;
    const x = cx + p.x + (p.x / len) * grow;
    const y = cy + p.y + (p.y / len) * grow;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

// ---------------------------------------------------------------- земля
function drawGround(ctx: Ctx, w: number, h: number): void {
  const rnd = mulberry32(7);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#cf9f62');
  g.addColorStop(1, '#bb8544');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // крупные пятна
  for (let i = 0; i < 46; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 40 + rnd() * 110;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() > 0.5;
    rg.addColorStop(0, dark ? 'rgba(120,70,30,0.10)' : 'rgba(255,225,170,0.10)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // крапинки и камешки
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const s = 0.8 + rnd() * 2.2;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(110,65,28,${0.10 + rnd() * 0.25})` : `rgba(255,232,188,${0.10 + rnd() * 0.25})`;
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * 0.7, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // редкие пучки травы
  ctx.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.strokeStyle = `rgba(105,110,45,${0.35 + rnd() * 0.3})`;
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(x + k * 2, y);
      ctx.quadraticCurveTo(x + k * 2 + (rnd() - 0.5) * 6, y - 5, x + k * 2 + (rnd() - 0.5) * 8, y - 9 - rnd() * 4);
      ctx.stroke();
    }
  }
  // следы на земле
  ctx.strokeStyle = 'rgba(120,75,35,0.10)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    const y = 120 + rnd() * (h - 240);
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + (rnd() - 0.5) * 120, w * 0.6, y + (rnd() - 0.5) * 120, w, y + (rnd() - 0.5) * 80);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- дальний план
function drawFar(ctx: Ctx, w: number, h: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#f2d9a4');
  sky.addColorStop(0.7, '#e9c68c');
  sky.addColorStop(1, '#d9ad72');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // холмы
  ctx.fillStyle = '#c9a26a';
  ctx.beginPath();
  ctx.ellipse(120, h - 8, 260, 46, 0, Math.PI, 0);
  ctx.ellipse(560, h - 8, 300, 38, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#b48a50';
  ctx.beginPath();
  ctx.ellipse(380, h - 4, 340, 26, 0, Math.PI, 0);
  ctx.fill();
  // деревья
  const rnd = mulberry32(21);
  for (const tx of [60, 110, 250, 320, 690, 740]) {
    const th = 34 + rnd() * 22;
    ctx.fillStyle = '#5a4526';
    ctx.fillRect(tx - 2, h - 26 - th * 0.5, 4, th * 0.6);
    ctx.fillStyle = '#6f6a34';
    ctx.beginPath();
    ctx.arc(tx, h - 28 - th * 0.55, th * 0.42, 0, Math.PI * 2);
    ctx.arc(tx - 9, h - 22 - th * 0.4, th * 0.3, 0, Math.PI * 2);
    ctx.arc(tx + 9, h - 22 - th * 0.4, th * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  // юрта
  const yx = 520;
  const yb = h - 18;
  ctx.fillStyle = '#efe1bd';
  ctx.strokeStyle = '#6b4a2a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(yx - 44, yb - 26, 88, 26);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(yx - 50, yb - 26);
  ctx.quadraticCurveTo(yx, yb - 84, yx + 50, yb - 26);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PAL.turquoise;
  ctx.fillRect(yx - 44, yb - 30, 88, 5);
  ctx.strokeStyle = 'rgba(107,74,42,0.5)';
  ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(yx + i * 12, yb - 26);
    ctx.lineTo(yx + i * 12, yb);
    ctx.stroke();
  }
  ctx.fillStyle = '#5a3520';
  ctx.fillRect(yx - 8, yb - 22, 16, 22);
  ctx.fillStyle = '#6b4a2a';
  ctx.beginPath();
  ctx.arc(yx, yb - 60, 5, 0, Math.PI * 2);
  ctx.fill();
  // забор
  ctx.strokeStyle = '#6a4526';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, h - 22);
  ctx.lineTo(w, h - 22);
  ctx.moveTo(0, h - 12);
  ctx.lineTo(w, h - 12);
  ctx.stroke();
  ctx.lineWidth = 4;
  for (let x = 6; x < w; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x, h - 30);
    ctx.lineTo(x, h - 4);
    ctx.stroke();
  }
  // плавный переход в землю
  const fade = ctx.createLinearGradient(0, h - 14, 0, h);
  fade.addColorStop(0, 'rgba(200,151,90,0)');
  fade.addColorStop(1, 'rgba(200,151,90,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, h - 14, w, 14);
}

// ---------------------------------------------------------------- «қошқар мүйіз» (рога барана), упрощённо
export function ramHorn(ctx: Ctx, x: number, y: number, s: number, flip: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip * s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(10, -2, 14, -12, 8, -15);
  ctx.bezierCurveTo(3, -17, 0, -11, 4, -9);
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(6, 6, 14, 8, 15, 15);
  ctx.bezierCurveTo(15, 20, 8, 20, 8, 15);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- ближний план и рамка
function drawNear(ctx: Ctx, w: number, h: number): void {
  const m = LAYER_MARGIN;
  // мягкая виньетка
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.32, w / 2, h / 2, h * 0.72);
  vg.addColorStop(0, 'rgba(60,30,10,0)');
  vg.addColorStop(1, 'rgba(60,30,10,0.28)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  // камешки и травинки у нижнего края
  const rnd = mulberry32(99);
  for (let i = 0; i < 46; i++) {
    const x = m + 16 + rnd() * (FIELD_W - 32);
    const y = h - m - 18 - rnd() * 42;
    const r = 2 + rnd() * 4;
    ctx.fillStyle = `rgba(${90 + rnd() * 40},${60 + rnd() * 30},${35 + rnd() * 20},0.85)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.3, r, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,235,190,0.35)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.3, r * 0.5, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < 24; i++) {
    const x = m + 20 + rnd() * (FIELD_W - 40);
    const y = h - m - 14 - rnd() * 26;
    ctx.strokeStyle = 'rgba(96,104,44,0.85)';
    ctx.lineWidth = 1.6;
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.moveTo(x + k * 2.2, y);
      ctx.quadraticCurveTo(x + k * 2.2 + (rnd() - 0.5) * 7, y - 9, x + k * 2.2 + (rnd() - 0.5) * 13, y - 15 - rnd() * 8);
      ctx.stroke();
    }
  }
  // орнаментальная рамка
  const x0 = m - 6;
  const y0 = m - 6;
  const fw = FIELD_W + 12;
  const fh = FIELD_H + 12;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = PAL.terracotta;
  ctx.lineWidth = 18;
  ctx.strokeRect(x0 + 2, y0 + 2, fw - 4, fh - 4);
  ctx.strokeStyle = PAL.cream;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 12, y0 + 12, fw - 24, fh - 24);
  ctx.strokeStyle = PAL.brown;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 - 6.5, y0 - 6.5, fw + 13, fh + 13);
  // ромбы вдоль рамки
  ctx.fillStyle = PAL.turquoise;
  const diamond = (cx: number, cy: number) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx + 5, cy);
    ctx.lineTo(cx, cy + 5);
    ctx.lineTo(cx - 5, cy);
    ctx.closePath();
    ctx.fill();
  };
  for (let x = x0 + 40; x < x0 + fw - 30; x += 40) {
    diamond(x, y0 + 2);
    diamond(x, y0 + fh - 2);
  }
  for (let y = y0 + 40; y < y0 + fh - 30; y += 40) {
    diamond(x0 + 2, y);
    diamond(x0 + fw - 2, y);
  }
  // рога в углах
  const corner = (cx: number, cy: number, fx: number, fy: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(fx, fy);
    ramHorn(ctx, 4, 4, 1.4, 1, PAL.cream);
    ctx.restore();
  };
  corner(x0 + 12, y0 + 12, 1, 1);
  corner(x0 + fw - 12, y0 + 12, -1, 1);
  corner(x0 + 12, y0 + fh - 12, 1, -1);
  corner(x0 + fw - 12, y0 + fh - 12, -1, -1);
}

// ---------------------------------------------------------------- кон
function drawZone(ctx: Ctx, size: number, r: number): void {
  const c = size / 2;
  ctx.fillStyle = 'rgba(122,70,28,0.20)';
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  // внутренняя тень (вдавленное кольцо): свет сверху-слева
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.shadowColor = 'rgba(40,20,5,0.6)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 7;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 60;
  ctx.beginPath();
  ctx.arc(c, c, r + 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // светлая кромка с противоположной стороны (снизу-справа)
  ctx.strokeStyle = 'rgba(255,240,205,0.7)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(c, c, r + 3, -0.15, Math.PI * 0.62);
  ctx.stroke();
  // чёткая плоская граница: по ней считается «выбит»
  ctx.strokeStyle = PAL.turquoiseDark;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = PAL.cream;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([2, 7]);
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // декор снаружи
  ctx.fillStyle = 'rgba(58,36,18,0.55)';
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * (r + 11), c + Math.sin(a) * (r + 11), 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- тела
function drawAsyk(ctx: Ctx, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const pts = bonePolygon(ASYK.w, ASYK.h);
  const g = ctx.createLinearGradient(cx - ASYK.w / 2, cy - ASYK.h / 2, cx + ASYK.w / 2, cy + ASYK.h / 2);
  g.addColorStop(0, '#fffaf0');
  g.addColorStop(0.5, '#efe0b8');
  g.addColorStop(1, '#c4a56c');
  polyPath(ctx, pts, cx, cy);
  ctx.fillStyle = g;
  ctx.fill();
  // прожилки кости
  ctx.save();
  polyPath(ctx, pts, cx, cy);
  ctx.clip();
  ctx.strokeStyle = 'rgba(139,105,58,0.35)';
  ctx.lineWidth = 0.9;
  const rnd = mulberry32(5);
  for (let i = 0; i < 7; i++) {
    const y = cy + (rnd() - 0.5) * ASYK.h * 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - ASYK.w / 2, y + (rnd() - 0.5) * 4);
    ctx.bezierCurveTo(cx - 8, y + (rnd() - 0.5) * 6, cx + 8, y + (rnd() - 0.5) * 6, cx + ASYK.w / 2, y + (rnd() - 0.5) * 4);
    ctx.stroke();
  }
  ctx.restore();
  // фаска: светлая кромка сверху-слева, тёмная снизу-справа
  ctx.save();
  polyPath(ctx, pts, cx, cy, -2.4);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.stroke();
  ctx.restore();
  polyPath(ctx, pts, cx, cy);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#4b3018';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawSaka(ctx: Ctx, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const pts = bonePolygon(SAKA.w, SAKA.h);
  const g = ctx.createLinearGradient(cx - SAKA.w / 2, cy - SAKA.h / 2, cx + SAKA.w / 2, cy + SAKA.h / 2);
  g.addColorStop(0, '#e7edf2');
  g.addColorStop(0.35, '#98a5b3');
  g.addColorStop(0.7, '#4c5866');
  g.addColorStop(1, '#232b33');
  polyPath(ctx, pts, cx, cy);
  ctx.fillStyle = g;
  ctx.fill();
  // бирюзовая инкрустация вдоль оси
  ctx.save();
  polyPath(ctx, pts, cx, cy);
  ctx.clip();
  ctx.strokeStyle = PAL.turquoise;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - SAKA.w / 2 + 10, cy);
  ctx.lineTo(cx + SAKA.w / 2 - 10, cy);
  ctx.stroke();
  ctx.fillStyle = PAL.turquoise;
  for (const dx of [-14, 0, 14]) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  polyPath(ctx, pts, cx, cy, -3);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();
  polyPath(ctx, pts, cx, cy);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = '#11171c';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawShadow(ctx: Ctx, w: number, h: number, bw: number, bh: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const pts = bonePolygon(bw, bh);
  ctx.lineJoin = 'round';
  for (let r = 14; r >= 1; r--) {
    polyPath(ctx, pts, cx, cy);
    ctx.lineWidth = r * 2;
    ctx.strokeStyle = 'rgba(40,20,5,0.035)';
    ctx.stroke();
  }
  polyPath(ctx, pts, cx, cy);
  ctx.fillStyle = 'rgba(40,20,5,0.42)';
  ctx.fill();
}

function drawHighlight(ctx: Ctx, w: number, h: number, sharp: boolean): void {
  const cx = w / 2;
  const cy = h / 2;
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) / 2);
  rg.addColorStop(0, sharp ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)');
  rg.addColorStop(sharp ? 0.35 : 0.5, sharp ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.2)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);
  if (sharp) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy + 1);
    ctx.lineTo(cx + 12, cy - 1);
    ctx.stroke();
  }
}

function drawDust(ctx: Ctx, size: number): void {
  const c = size / 2;
  const rg = ctx.createRadialGradient(c, c, 0, c, c, c);
  rg.addColorStop(0, 'rgba(238,214,170,0.9)');
  rg.addColorStop(1, 'rgba(238,214,170,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, size, size);
}

function drawSimpleShadow(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = 'rgba(40,20,5,0.3)';
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, Math.PI * 2);
  ctx.fill();
}

export interface TexSizes {
  asyk: { w: number; h: number };
  saka: { w: number; h: number };
  shadowAsyk: { w: number; h: number };
  shadowSaka: { w: number; h: number };
}

export const TEX: TexSizes = {
  asyk: { w: ASYK.w + PAD * 2, h: ASYK.h + PAD * 2 },
  saka: { w: SAKA.w + PAD * 2, h: SAKA.h + PAD * 2 },
  shadowAsyk: { w: ASYK.w + 44, h: ASYK.h + 44 },
  shadowSaka: { w: SAKA.w + 44, h: SAKA.h + 44 },
};

/** Запекает ВСЕ текстуры один раз при загрузке: никаких пост-эффектов и размытия в рантайме. */
export function bakeAll(scene: Phaser.Scene, S: number, zoneR: number): void {
  const gw = FIELD_W + LAYER_MARGIN * 2;
  const gh = FIELD_H + LAYER_MARGIN * 2;
  bake(scene, 'ground', gw, gh, S, (c) => drawGround(c, gw, gh));
  bake(scene, 'far', gw, FAR_H, S, (c) => drawFar(c, gw, FAR_H));
  bake(scene, 'near', gw, gh, S, (c) => drawNear(c, gw, gh));
  const zs = (zoneR + 24) * 2;
  bake(scene, 'zone', zs, zs, S, (c) => drawZone(c, zs, zoneR));
  bake(scene, 'asyk', TEX.asyk.w, TEX.asyk.h, S, (c) => drawAsyk(c, TEX.asyk.w, TEX.asyk.h));
  bake(scene, 'saka', TEX.saka.w, TEX.saka.h, S, (c) => drawSaka(c, TEX.saka.w, TEX.saka.h));
  bake(scene, 'shadowAsyk', TEX.shadowAsyk.w, TEX.shadowAsyk.h, S, (c) => drawShadow(c, TEX.shadowAsyk.w, TEX.shadowAsyk.h, ASYK.w, ASYK.h));
  bake(scene, 'shadowSaka', TEX.shadowSaka.w, TEX.shadowSaka.h, S, (c) => drawShadow(c, TEX.shadowSaka.w, TEX.shadowSaka.h, SAKA.w, SAKA.h));
  bake(scene, 'simpleShadowAsyk', ASYK.w, ASYK.h, S, (c) => drawSimpleShadow(c, ASYK.w, ASYK.h));
  bake(scene, 'simpleShadowSaka', SAKA.w, SAKA.h, S, (c) => drawSimpleShadow(c, SAKA.w, SAKA.h));
  bake(scene, 'hlAsyk', 22, 16, S, (c) => drawHighlight(c, 22, 16, false));
  bake(scene, 'hlSaka', 30, 20, S, (c) => drawHighlight(c, 30, 20, true));
  bake(scene, 'dust', 32, 32, S, (c) => drawDust(c, 32));
}
