/**
 * Контактный лист «до / после» из docs/design/before и docs/design/after (см. design-shots.ts):
 * по одному JPEG на размер экрана — строки: экран, столбцы: до | после → docs/design/contact-<size>.jpg.
 *
 *   node scripts/contact-sheet.ts
 */
import { chromium } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const SIZES = ['390x844', '768x1024', '1366x768', '1920x1080'];
const SCREENS = ['menu', 'levels', 'game', 'result', 'shop', 'settings'];

async function main(): Promise<void> {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const size of SIZES) {
    const rows = SCREENS.map((sc) =>
      ['before', 'after'].map((side) => {
        const f = `docs/design/${side}/${size}-${sc}.jpg`;
        return existsSync(f) ? `data:image/jpeg;base64,${readFileSync(f).toString('base64')}` : '';
      }),
    );
    const jpg = await p.evaluate(
      async ([list, names, title]) => {
        const load = async (s: string) => {
          if (!s) return null;
          const i = new Image();
          i.src = s;
          await i.decode();
          return i;
        };
        const imgs = await Promise.all(list.map(async (r) => Promise.all(r.map(load))));
        const first = imgs.flat().find((i) => i) as HTMLImageElement;
        const portrait = first.height > first.width;
        const cw = portrait ? 300 : 560;
        const ch = Math.round((cw * first.height) / first.width);
        const pad = 12;
        const head = 34;
        const lab = 20;
        const c = document.createElement('canvas');
        c.width = pad + 2 * (cw + pad);
        c.height = head + imgs.length * (ch + lab + pad) + pad;
        const g = c.getContext('2d')!;
        g.fillStyle = '#11163a';
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#ffe08a';
        g.font = '700 18px sans-serif';
        g.fillText(`${title}: до → после`, pad, 24);
        g.font = '600 13px sans-serif';
        imgs.forEach((r, i) => {
          const y = head + i * (ch + lab + pad);
          r.forEach((im, j) => {
            const x = pad + j * (cw + pad);
            g.fillStyle = '#f7edd3';
            g.fillText(`${names[i]} · ${j ? 'после' : 'до'}`, x, y + 14);
            if (im) g.drawImage(im, x, y + lab, cw, ch);
          });
        });
        return c.toDataURL('image/jpeg', 0.8).split(',')[1];
      },
      [rows, SCREENS, size] as const,
    );
    writeFileSync(`docs/design/contact-${size}.jpg`, Buffer.from(jpg, 'base64'));
    console.log('ok', size);
  }
  await b.close();
}

void main();
