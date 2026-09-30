/**
 * Картинки скинов сақа из 3D-модели асыка: вид сверху, свет сверху-слева (как в 2D-поле),
 * 168×102 (@3x от хитбокса сақа 56×34), прозрачный фон → public/assets/saka/<id>.png и .webp.
 * Стили — src/game/render/skins.ts. Модель — public/assets/models/asyk.glb.
 *
 *   node scripts/render-saka-skins.ts
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { SAKA_STYLE } from '../src/game/render/skins.ts';

const W = 168;
const H = 102;
const TYPES: Record<string, string> = { '.js': 'text/javascript' };

async function main(): Promise<void> {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.route('http://skins.local/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: `<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>`,
      });
    if (path === '/asyk.glb') return route.fulfill({ body: readFileSync('public/assets/models/asyk.glb') });
    const file = join('node_modules', path);
    return route.fulfill({ contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  await p.goto('http://skins.local/');
  const out = await p.evaluate(
    async ([styles, w, h]) => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync('/asyk.glb');
      let mesh: any = null;
      gltf.scene.traverse((o: any) => {
        if (!mesh && o.isMesh) mesh = o;
      });
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1);
      r.setSize(w * 2, h * 2); // рендер ×2 и уменьшение — мягкие края
      r.setClearColor(0x000000, 0);
      r.outputColorSpace = THREE.SRGBColorSpace;
      // модель вписана в хитбокс асыка 44×26 → масштаб до сақа 56×34
      const k = [56 / 44, 34 / 26, 34 / 26];
      // вид сверху: +X вправо, +Z (ось Y поля) вниз
      const cam = new THREE.OrthographicCamera(-28, 28, 17, -17, 1, 400);
      cam.up.set(0, 0, -1);
      cam.position.set(0, 200, 0);
      cam.lookAt(0, 0, 0);
      const res: Record<string, [string, string]> = {};
      for (const [id, st] of Object.entries(styles) as [string, any][]) {
        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a4030, 1.3));
        const d = new THREE.DirectionalLight(0xffffff, 2.4);
        d.position.set(-60, 120, -50); // сверху-слева, как тени в 2D
        scene.add(d);
        const m = mesh.material.clone();
        m.color = new THREE.Color(st.color);
        m.metalness = st.metalness;
        m.roughness = st.roughness;
        m.emissive = new THREE.Color(st.emissive);
        m.emissiveMap = m.map;
        m.emissiveIntensity = st.emissiveIntensity;
        const obj = new THREE.Mesh(mesh.geometry, m);
        obj.scale.set(k[0], k[1], k[2]);
        scene.add(obj);
        r.render(scene, cam);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d')!;
        g.imageSmoothingQuality = 'high';
        g.drawImage(r.domElement, 0, 0, w, h);
        res[id] = [c.toDataURL('image/png').split(',')[1], c.toDataURL('image/webp', 0.9).split(',')[1]];
      }
      return res;
    },
    [SAKA_STYLE, W, H] as const,
  );
  mkdirSync('public/assets/saka', { recursive: true });
  for (const [id, [png, webp]] of Object.entries(out)) {
    writeFileSync(`public/assets/saka/${id}.png`, Buffer.from(png, 'base64'));
    writeFileSync(`public/assets/saka/${id}.webp`, Buffer.from(webp, 'base64'));
  }
  await b.close();
  console.log(`ok: ${Object.keys(out).length} skins → public/assets/saka`);
}

void main();
