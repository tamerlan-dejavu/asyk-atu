/**
 * Матрица читаемости: карта × набор асыков × сақа (уровень с обычными, золотыми, тяжёлыми асыками и блоками)
 * → docs/design/readability.png. Вид 2D, качество «Высокое», анимации выключены.
 *
 *   npm run build && npm run preview     # в другом терминале
 *   node scripts/readability.ts
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const THEMES = ['theme_yard', 'theme_steppe', 'theme_toy', 'theme_night'];
const SETS = ['asyk_bone', 'asyk_red', 'asyk_wood'];
const SAKAS = [
  'saka_bronze',
  'saka_silver',
  'saka_gold',
  'saka_oyu',
  'saka_eagle',
  'saka_snowleopard',
  'saka_tulpar',
  'saka_lava',
  'saka_jade',
  'saka_onyx',
  'saka_bronze',
  'saka_gold',
];
const LEVEL = 10;
const W = 360;
const H = 540;

async function main(): Promise<void> {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const cells: string[] = [];
  let k = 0;
  for (const set of SETS) {
    for (const theme of THEMES) {
      const saka = SAKAS[k++ % SAKAS.length];
      const ctx = await b.newContext({ viewport: { width: W, height: H }, reducedMotion: 'reduce' });
      const p = await ctx.newPage();
      await p.addInitScript(
        ([th, st, sk]) =>
          localStorage.setItem(
            'asyk-atu:v1',
            JSON.stringify({
              v: 2,
              lang: 'ru',
              sound: false,
              quality: 'high',
              tutorialDone: true,
              unlocked: 10,
              pro: true,
              seenHints: ['golden', 'heavy', 'block', 'loft'],
              owned: [th, st, sk],
              equipped: { saka: sk, theme: th, asyk: st },
            }),
          ),
        [theme, set, saka],
      );
      await p.goto(`${BASE}/?view=2d&fpsguard=0`);
      await p.locator('[data-act="play"]').click();
      await p.locator(`[data-act="level"][data-arg="${LEVEL}"]`).click();
      await p.waitForFunction(() => (window as any).__asyk?.state === 'AIMING');
      await p.evaluate(() => document.getElementById('hint')?.remove());
      await p.waitForTimeout(1200);
      const box = (await p.locator('#game canvas:not(.three-canvas)').boundingBox())!;
      const shot = await p.screenshot({ clip: box, type: 'jpeg', quality: 88 });
      cells.push(`${theme} · ${set} · ${saka}|data:image/jpeg;base64,${shot.toString('base64')}`);
      await ctx.close();
    }
  }
  // сборка сетки: строки — наборы асыков, столбцы — карты
  const p = await b.newPage();
  const png = await p.evaluate(
    async ([list, cols]) => {
      const imgs = await Promise.all(
        list.map(async (c) => {
          const [label, src] = c.split('|');
          const i = new Image();
          i.src = src;
          await i.decode();
          return { label, i };
        }),
      );
      const cw = 300;
      const ch = 450;
      const pad = 8;
      const lh = 22;
      const rows = Math.ceil(imgs.length / cols);
      const cv = document.createElement('canvas');
      cv.width = cols * (cw + pad) + pad;
      cv.height = rows * (ch + lh + pad) + pad;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#11163a';
      g.fillRect(0, 0, cv.width, cv.height);
      g.font = '600 13px sans-serif';
      imgs.forEach(({ label, i }, n) => {
        const x = pad + (n % cols) * (cw + pad);
        const y = pad + Math.floor(n / cols) * (ch + lh + pad);
        g.fillStyle = '#f7edd3';
        g.fillText(label, x, y + 15);
        g.drawImage(i, x, y + lh, cw, ch);
      });
      return cv.toDataURL('image/png').split(',')[1];
    },
    [cells, THEMES.length] as const,
  );
  mkdirSync('docs/design', { recursive: true });
  writeFileSync('docs/design/readability.png', Buffer.from(png, 'base64'));
  await b.close();
  console.log('ok docs/design/readability.png');
}

void main();
