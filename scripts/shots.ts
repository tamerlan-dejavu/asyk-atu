/**
 * Скриншоты раскладки на разных экранах: меню, середина раунда (рогатка натянута) и итог.
 *
 *   npm run build && npm run preview          # в другом терминале
 *   node scripts/shots.ts                     # → docs/desktop-shots/
 *   node scripts/shots.ts --out docs/desktop-shots/before
 *   node scripts/shots.ts --compare docs/desktop-shots/before   # телефон: пиксельная разница с эталоном
 *
 * BASE_URL — другой адрес (по умолчанию http://localhost:4173). Анимации выключены (reduced motion),
 * чтобы кадры были сравнимы. Кадры — JPEG (качество 82). Кроме картинок пишет report.json: скролл, обрезка поля, доля высоты поля.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Vp {
  name: string;
  w: number;
  h: number;
  phone?: boolean;
}

const VIEWPORTS: Vp[] = [
  { name: 'desktop-1920x1080', w: 1920, h: 1080 },
  { name: 'desktop-1440x900', w: 1440, h: 900 },
  { name: 'desktop-1366x768', w: 1366, h: 768 },
  { name: 'desktop-2560x1440', w: 2560, h: 1440 },
  { name: 'tablet-1024x768', w: 1024, h: 768 },
  { name: 'tablet-768x1024', w: 768, h: 1024 },
  { name: 'phone-390x844', w: 390, h: 844, phone: true },
  { name: 'phone-360x740', w: 360, h: 740, phone: true },
];

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const OUT = arg('--out') ?? 'docs/desktop-shots';
const COMPARE = arg('--compare');
const ONLY = arg('--only');
const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
/** JPEG вместо PNG: полный набор весит ~2 МБ вместо ~26 МБ; для сравнения телефона кодек детерминирован. */
const JPEG = { type: 'jpeg' as const, quality: 82 };

const SEED = {
  v: 2,
  lang: 'ru',
  sound: false,
  quality: 'high',
  tutorialDone: true,
  unlocked: 3,
  seenHints: ['golden', 'heavy', 'block', 'loft'],
};

const state = (p: Page) => p.evaluate(() => (window as any).__asyk?.state as string | undefined);

async function canvasBox(p: Page) {
  const b = await p.locator('#game canvas:not(.three-canvas)').boundingBox();
  if (!b) throw new Error('нет canvas');
  return b;
}

/** Бросок мышью от линии броска: зажать в нижней части поля, потянуть вниз, отпустить (или держать). */
async function pull(p: Page, release: boolean): Promise<void> {
  const b = await canvasBox(p);
  const x = b.x + b.width / 2;
  const y = b.y + b.height * 0.8;
  await p.mouse.move(x, y);
  await p.mouse.down();
  await p.mouse.move(x + b.width * 0.03, y + b.height * 0.13, { steps: 8 });
  if (release) await p.mouse.up();
}

async function layoutReport(p: Page) {
  return p.evaluate(() => {
    const c = document.querySelector('#game canvas:not(.three-canvas)') as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const de = document.documentElement;
    return {
      layout: de.dataset.layout ?? 'phone',
      scrollX: de.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
      scrollY: de.scrollHeight > innerHeight || document.body.scrollHeight > innerHeight,
      fieldClipped: r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5,
      fieldHeightPct: Math.round((r.height / innerHeight) * 1000) / 10,
      field: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });
}

async function shoot(browser: Browser, vp: Vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript((seed) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('asyk-atu:v1', JSON.stringify(seed));
      sessionStorage.setItem('seeded', '1');
    }
  }, SEED);
  await p.goto(`${BASE}/?fpsguard=0`);
  await p.waitForFunction(() => (window as any).__asyk?.state === 'MENU');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: join(OUT, `${vp.name}-menu.jpg`), ...JPEG });

  await p.locator('[data-act="play"]').click();
  await p.locator('[data-act="level"][data-arg="1"]').click();
  await p.waitForFunction(() => (window as any).__asyk?.state === 'AIMING', undefined, { timeout: 30_000 });
  await p.waitForTimeout(1500);
  const report = await layoutReport(p);
  await pull(p, false);
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(OUT, `${vp.name}-game.jpg`), ...JPEG });
  await p.mouse.up();

  // доигрываем до итога
  for (let i = 0; i < 12; i++) {
    await p.waitForFunction(() => (window as any).__asyk?.state !== 'AIMING', undefined, { timeout: 10_000 }).catch(() => {});
    await p.waitForFunction(() => ['AIMING', 'LEVEL_COMPLETE', 'LEVEL_FAILED'].includes((window as any).__asyk?.state), undefined, {
      timeout: 60_000,
    });
    const st = await state(p);
    if (st !== 'AIMING') break;
    await pull(p, true);
  }
  await p.waitForSelector('.result', { timeout: 10_000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: join(OUT, `${vp.name}-result.jpg`), ...JPEG });
  await ctx.close();
  return { ...report, errors };
}

/** Доля отличающихся пикселей (порог по каналу 24), считается в браузере — без лишних зависимостей. */
async function diff(browser: Browser, a: string, b: string): Promise<number> {
  const p = await browser.newPage();
  const url = (f: string) => `data:image/jpeg;base64,${readFileSync(f).toString('base64')}`;
  const res = await p.evaluate(
    async ([ua, ub]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((ok, bad) => {
          const i = new Image();
          i.onload = () => ok(i);
          i.onerror = bad;
          i.src = src;
        });
      const [ia, ib] = await Promise.all([load(ua), load(ub)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return 1;
      const px = (i: HTMLImageElement) => {
        const c = document.createElement('canvas');
        c.width = i.width;
        c.height = i.height;
        const g = c.getContext('2d')!;
        g.drawImage(i, 0, 0);
        return g.getImageData(0, 0, i.width, i.height).data;
      };
      const da = px(ia);
      const db = px(ib);
      let n = 0;
      for (let k = 0; k < da.length; k += 4) {
        if (Math.abs(da[k] - db[k]) > 24 || Math.abs(da[k + 1] - db[k + 1]) > 24 || Math.abs(da[k + 2] - db[k + 2]) > 24) n++;
      }
      return n / (da.length / 4);
    },
    [url(a), url(b)],
  );
  await p.close();
  return res;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const report: Record<string, unknown> = {};
  for (const vp of VIEWPORTS) {
    if (ONLY && !vp.name.includes(ONLY)) continue;
    const r = await shoot(browser, vp);
    const entry: Record<string, unknown> = { ...r };
    if (COMPARE && vp.phone) {
      for (const shot of ['menu', 'game', 'result']) {
        const ref = join(COMPARE, `${vp.name}-${shot}.jpg`);
        if (existsSync(ref))
          entry[`diff_${shot}`] = Math.round((await diff(browser, ref, join(OUT, `${vp.name}-${shot}.jpg`))) * 10000) / 100;
      }
    }
    report[vp.name] = entry;
    console.log(vp.name, JSON.stringify(entry));
  }
  await browser.close();
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}

void main();
