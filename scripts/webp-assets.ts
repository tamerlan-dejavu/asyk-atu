/**
 * WebP-копии ассетов (public/assets/**.png → .webp рядом, с прозрачностью): игра грузит WebP,
 * PNG остаются исходниками. Кодирует браузер (Playwright), без графических зависимостей.
 *
 *   node scripts/webp-assets.ts
 */
import { chromium } from '@playwright/test';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'public/assets';
const QUALITY = 0.9;

async function main(): Promise<void> {
  const files = readdirSync(ROOT).flatMap((d) =>
    statSync(join(ROOT, d)).isDirectory()
      ? readdirSync(join(ROOT, d))
          .filter((f) => f.endsWith('.png'))
          .map((f) => join(ROOT, d, f))
      : [],
  );
  const b = await chromium.launch();
  const p = await b.newPage();
  let before = 0;
  let after = 0;
  for (const f of files) {
    const src = `data:image/png;base64,${readFileSync(f).toString('base64')}`;
    const out = await p.evaluate(
      async ([s, q]) => {
        const i = new Image();
        i.src = s;
        await i.decode();
        const c = document.createElement('canvas');
        c.width = i.width;
        c.height = i.height;
        c.getContext('2d')!.drawImage(i, 0, 0);
        return c.toDataURL('image/webp', q).split(',')[1];
      },
      [src, QUALITY] as const,
    );
    const buf = Buffer.from(out, 'base64');
    writeFileSync(f.replace(/\.png$/, '.webp'), buf);
    before += statSync(f).size;
    after += buf.length;
  }
  await b.close();
  console.log(`${files.length} files: ${Math.round(before / 1024)} KB PNG → ${Math.round(after / 1024)} KB WebP`);
}

void main();
