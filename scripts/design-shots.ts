/**
 * Скриншоты экранов для проверки дизайна: меню, игра (рогатка натянута), итог, магазин, настройки —
 * на 390×844, 768×1024, 1366×768, 1920×1080.
 *
 *   npm run build && npm run preview                       # в другом терминале
 *   node scripts/design-shots.ts --out docs/design/after
 *   node scripts/design-shots.ts --out docs/design/before
 *
 * BASE_URL — другой адрес (по умолчанию http://localhost:4173). Анимации выключены (reduced motion).
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SIZES = [
  { name: '390x844', w: 390, h: 844 },
  { name: '768x1024', w: 768, h: 1024 },
  { name: '1366x768', w: 1366, h: 768 },
  { name: '1920x1080', w: 1920, h: 1080 },
];

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const OUT = arg('--out') ?? 'docs/design/after';
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const JPEG = { type: 'jpeg' as const, quality: 82 };

const SEED = {
  v: 2,
  lang: 'ru',
  sound: false,
  quality: 'high',
  tutorialDone: true,
  unlocked: 7,
  coins: 480,
  seenHints: ['golden', 'heavy', 'block', 'loft'],
};

async function home(p: Page): Promise<void> {
  await p.goto(`${BASE}/?fpsguard=0`);
  await p.waitForFunction(() => (window as any).__asyk?.state === 'MENU');
  await p.waitForTimeout(1200);
}

async function pull(p: Page, release: boolean): Promise<void> {
  const b = (await p.locator('#game canvas:not(.three-canvas)').boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height * 0.8;
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x + b.width * 0.02, y + b.height * 0.13, { steps: 8 });
  if (release) await p.mouse.up();
}

async function shoot(browser: Browser, s: (typeof SIZES)[number]): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.addInitScript((seed) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('asyk-atu:v1', JSON.stringify(seed));
      sessionStorage.setItem('seeded', '1');
    }
  }, SEED);
  const shot = (name: string) => p.screenshot({ path: join(OUT, `${s.name}-${name}.jpg`), ...JPEG });

  await home(p);
  await shot('menu');

  await p.locator('[data-act="goto"][data-arg="settings"]').click();
  await p.waitForTimeout(400);
  await shot('settings');

  await home(p);
  await p.locator('[data-act="goto"][data-arg="modes"]').click();
  await p.locator('[data-act="goto"][data-arg="shop"]').click();
  await p.waitForTimeout(500);
  await shot('shop');

  await home(p);
  await p.locator('[data-act="play"]').click();
  await p.waitForTimeout(400);
  await shot('levels');
  await p.locator('[data-act="level"][data-arg="6"]').click();
  await p.waitForFunction(() => (window as any).__asyk?.state === 'AIMING', undefined, { timeout: 30_000 });
  await p.waitForTimeout(1500);
  await pull(p, false);
  await p.waitForTimeout(300);
  await shot('game');
  await p.mouse.up();

  for (let i = 0; i < 12; i++) {
    await p.waitForFunction(() => (window as any).__asyk?.state !== 'AIMING', undefined, { timeout: 10_000 }).catch(() => {});
    await p.waitForFunction(() => ['AIMING', 'LEVEL_COMPLETE', 'LEVEL_FAILED'].includes((window as any).__asyk?.state), undefined, {
      timeout: 60_000,
    });
    if ((await p.evaluate(() => (window as any).__asyk?.state)) !== 'AIMING') break;
    await pull(p, true);
  }
  await p.waitForSelector('.result', { timeout: 10_000 });
  await p.waitForTimeout(1500);
  await shot('result');
  await ctx.close();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const s of SIZES) {
    await shoot(browser, s);
    console.log('ok', s.name);
  }
  await browser.close();
}

void main();
