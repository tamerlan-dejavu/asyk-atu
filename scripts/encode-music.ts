/**
 * Перекодирование фоновой музыки под бюджет (меню + игра ≤ 2 МБ): исходный MP3 → моно, 44,1 кГц,
 * пик нормализован до −1 дБ, MP3 64 кбит/с. Декодирует браузер (Playwright, WebAudio), кодирует lamejs.
 *
 *   node scripts/encode-music.ts --menu ../asyk_atu_assets_raw/roman_sol-poetica-449399.mp3 \
 *                                --game ../asyk_atu_assets_raw/vadim_makes_sound-atlas-kazakhstan-562527.mp3
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TRACKS: Record<string, string | undefined> = { music_menu: arg('--menu'), music_game: arg('--game') };
const KBPS = Number(arg('--kbps') ?? 64);

async function main(): Promise<void> {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.route('http://enc.local/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>enc</title>' });
    return route.fulfill({ contentType: 'text/javascript', body: readFileSync('node_modules/@breezystack/lamejs/dist/lamejs.iife.js') });
  });
  await p.goto('http://enc.local/');
  await p.addScriptTag({ url: 'http://enc.local/lamejs.js' });
  mkdirSync('public/assets/audio', { recursive: true });
  for (const [name, src] of Object.entries(TRACKS)) {
    if (!src) continue;
    const res = await p.evaluate(
      async ([b64, kbps]) => {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const rate = 44100;
        const probe = new OfflineAudioContext(1, 1, rate);
        const decoded = await probe.decodeAudioData(buf.buffer);
        // моно: среднее каналов; пик → −1 дБ
        const n = decoded.length;
        const mono = new Float32Array(n);
        for (let c = 0; c < decoded.numberOfChannels; c++) {
          const d = decoded.getChannelData(c);
          for (let i = 0; i < n; i++) mono[i] += d[i] / decoded.numberOfChannels;
        }
        let peak = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
        const gain = peak > 0 ? 0.89 / peak : 1;
        const pcm = new Int16Array(n);
        for (let i = 0; i < n; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(mono[i] * gain * 32767)));
        const lame = (window as any).lamejs;
        const enc = new lame.Mp3Encoder(1, rate, kbps);
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < n; i += 1152) {
          const out = enc.encodeBuffer(pcm.subarray(i, i + 1152));
          if (out.length) chunks.push(new Uint8Array(out));
        }
        const end = enc.flush();
        if (end.length) chunks.push(new Uint8Array(end));
        let total = 0;
        chunks.forEach((c) => (total += c.length));
        const all = new Uint8Array(total);
        let o = 0;
        chunks.forEach((c) => {
          all.set(c, o);
          o += c.length;
        });
        let s = '';
        for (let i = 0; i < all.length; i += 0x8000) s += String.fromCharCode(...all.subarray(i, i + 0x8000));
        return { mp3: btoa(s), seconds: n / rate };
      },
      [readFileSync(src).toString('base64'), KBPS] as const,
    );
    const out = Buffer.from(res.mp3, 'base64');
    writeFileSync(`public/assets/audio/${name}.mp3`, out);
    console.log(`${name}.mp3: ${res.seconds.toFixed(1)} s, ${Math.round(out.length / 1024)} KB`);
  }
  await b.close();
}

void main();
