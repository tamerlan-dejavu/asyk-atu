/**
 * Фавиконки и картинка для соцсетей из эмблемы (public/assets/ui/emblem_asyk.png):
 * public/favicon-32.png, public/apple-touch-icon.png (180), public/og-image.jpg (1200×630).
 *
 *   node scripts/brand-images.ts
 *
 * Рисуется в браузере (Playwright) — без графических зависимостей.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const emblem = `data:image/png;base64,${readFileSync('public/assets/ui/emblem_asyk.png').toString('base64')}`;
const fontCss = [
  'node_modules/@fontsource/montserrat-alternates/files/montserrat-alternates-cyrillic-ext-800-normal.woff2',
  'node_modules/@fontsource/montserrat-alternates/files/montserrat-alternates-cyrillic-800-normal.woff2',
  'node_modules/@fontsource/nunito/files/nunito-cyrillic-700-normal.woff2',
  'node_modules/@fontsource/nunito/files/nunito-cyrillic-ext-700-normal.woff2',
]
  .map((f, i) => {
    const fam = i < 2 ? 'Display' : 'Body';
    return `@font-face{font-family:${fam};src:url(data:font/woff2;base64,${readFileSync(f).toString('base64')}) format('woff2');font-weight:${i < 2 ? 800 : 700}}`;
  })
  .join('');

async function main(): Promise<void> {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent(`<style>${fontCss}</style><div style="font-family:Display">.</div><div style="font-family:Body">.</div>`);
  await p.evaluate(() => document.fonts.ready);
  const out = await p.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const square = (size: number, pad: number, bg: boolean) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d')!;
      if (bg) {
        g.fillStyle = '#11163a';
        g.beginPath();
        g.roundRect(0, 0, size, size, size * 0.22);
        g.fill();
      }
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
      return c.toDataURL('image/png').split(',')[1];
    };
    const og = document.createElement('canvas');
    og.width = 1200;
    og.height = 630;
    const g = og.getContext('2d')!;
    const bg = g.createRadialGradient(600, 250, 40, 600, 315, 700);
    bg.addColorStop(0, '#313d84');
    bg.addColorStop(1, '#0b0e26');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1200, 630);
    // орнаментальная рамка
    g.strokeStyle = 'rgba(255,207,74,0.65)';
    g.lineWidth = 4;
    g.strokeRect(28, 28, 1144, 574);
    g.strokeStyle = 'rgba(255,207,74,0.25)';
    g.lineWidth = 2;
    g.strokeRect(42, 42, 1116, 546);
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = 30;
    g.shadowOffsetY = 10;
    g.drawImage(img, 90, 140, 350, 350);
    g.shadowBlur = 0;
    g.shadowOffsetY = 6;
    g.shadowColor = '#0b0e26';
    g.fillStyle = '#ffe08a';
    g.font = '800 112px Display';
    g.fillText('Асық ату', 480, 300);
    g.shadowOffsetY = 0;
    g.fillStyle = '#f7edd3';
    g.font = '700 40px Body';
    g.fillText('Традиционная казахская игра', 486, 380);
    g.fillText('на меткость — прямо в браузере', 486, 432);
    return {
      fav: square(32, 1, false),
      apple: square(180, 14, true),
      og: og.toDataURL('image/jpeg', 0.88).split(',')[1],
    };
  }, emblem);
  writeFileSync('public/favicon-32.png', Buffer.from(out.fav, 'base64'));
  writeFileSync('public/apple-touch-icon.png', Buffer.from(out.apple, 'base64'));
  writeFileSync('public/og-image.jpg', Buffer.from(out.og, 'base64'));
  await b.close();
  console.log('ok');
}

void main();
