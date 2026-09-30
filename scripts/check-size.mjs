// Бюджет размера: gzip-размер dist/assets/*.js. Лимит = размер на момент ТЗ v3 + 15 %.
// Облачная библиотека грузится динамическим импортом отдельным чанком и в стартовый бюджет не входит.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BASELINE_KB = 372; // index-*.js (Phaser + игра), gzip, на момент ТЗ v3
const LIMIT_KB = Math.round(BASELINE_KB * 1.15);
const CLOUD_LIMIT_KB = 70; // отдельный чанк supabase-js (грузится только при включённом облаке)
const THREE_LIMIT_KB = 220; // ленивый чанк 3D-вида (Three.js), грузится только при выборе 3D

const dir = 'dist/assets';
let main = 0;
let lazy = 0;
let three = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
  const kb = gzipSync(readFileSync(join(dir, f))).length / 1024;
  const isMain = f.startsWith('index-');
  const isThree = !isMain && f.startsWith('ThreeView-');
  if (isMain) main += kb;
  else if (isThree) three = Math.max(three, kb);
  else lazy = Math.max(lazy, kb);
  console.log(`${isMain ? 'initial' : isThree ? 'lazy 3D' : 'lazy   '}  ${f.padEnd(40)} ${kb.toFixed(1)} KB gzip`);
}
console.log(
  `initial total: ${main.toFixed(1)} KB (limit ${LIMIT_KB} KB); cloud chunk: ${lazy.toFixed(1)} KB (limit ${CLOUD_LIMIT_KB} KB); 3D chunk: ${three.toFixed(1)} KB (limit ${THREE_LIMIT_KB} KB)`,
);
if (main > LIMIT_KB || lazy > CLOUD_LIMIT_KB || three > THREE_LIMIT_KB) {
  console.error('Size budget exceeded');
  process.exit(1);
}
