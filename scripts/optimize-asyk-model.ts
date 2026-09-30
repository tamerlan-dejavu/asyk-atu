/**
 * Подготовка 3D-модели асыка для игры: исходный GLB (Sketchfab, 14k вершин, текстуры 1024) →
 * public/assets/models/asyk.glb — асык лежит на боку, длинная ось по X, ширина по Z, низ на Y = 0,
 * размер в единицах поля (длина = ASYK.w, ширина = ASYK.h, как хитбокс); сетка упрощена,
 * текстуры 512 px JPEG. Работает в браузере (Playwright) с Three.js из node_modules.
 *
 *   node scripts/optimize-asyk-model.ts --in ../asyk_atu_assets_raw/asyk_source_cozaim.glb
 *
 * Модель: «Asyq (асық, асык) 3d model», автор cozaim (https://sketchfab.com/cozaim), CC BY-NC 4.0.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const IN = arg('--in') ?? '../asyk_atu_assets_raw/asyk_source_cozaim.glb';
const OUT = 'public/assets/models/asyk.glb';
const TARGET_VERTS = Number(arg('--verts') ?? 3500);
const TEX = Number(arg('--tex') ?? 512);
// размеры тела асыка (src/game/config.ts): длина и ширина хитбокса
const ASYK_W = 44;
const ASYK_H = 26;

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };

async function main(): Promise<void> {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.route('http://model.local/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') {
      await route.fulfill({
        contentType: 'text/html',
        body: `<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>`,
      });
      return;
    }
    if (path === '/src.glb') {
      await route.fulfill({ contentType: 'model/gltf-binary', body: readFileSync(IN) });
      return;
    }
    const file = join('node_modules', path);
    await route.fulfill({ contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  await p.goto('http://model.local/');
  const res = await p.evaluate(
    async ([target, texSize, W, H]) => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
      const { SimplifyModifier } = await import('three/addons/modifiers/SimplifyModifier.js');
      const { mergeVertices } = await import('three/addons/utils/BufferGeometryUtils.js');
      const gltf = await new GLTFLoader().loadAsync('/src.glb');
      gltf.scene.updateMatrixWorld(true);
      let src: any = null;
      gltf.scene.traverse((o: any) => {
        if (o.isMesh && !src) src = o;
      });
      let geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
      // оси по размеру: самая длинная → X, средняя → Z (ширина на земле), самая короткая → Y (высота)
      geo.computeBoundingBox();
      const s = new THREE.Vector3();
      geo.boundingBox.getSize(s);
      const axes = [
        { i: 0, v: s.x },
        { i: 1, v: s.y },
        { i: 2, v: s.z },
      ].sort((a, c) => c.v - a.v);
      const basis = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
      const m = new THREE.Matrix4().makeBasis(basis[axes[0].i], basis[axes[2].i], basis[axes[1].i]).transpose();
      geo.applyMatrix4(m);
      geo.computeBoundingBox();
      geo.boundingBox.getSize(s);
      const c = new THREE.Vector3();
      geo.boundingBox.getCenter(c);
      geo.translate(-c.x, -geo.boundingBox.min.y, -c.z);
      // вписываем в хитбокс: длина = W, ширина = H; высота — в пропорции ширины (сечение не искажается)
      const kx = W / s.x;
      const kz = H / s.z;
      geo.scale(kx, kz, kz);
      const before = geo.attributes.position.count;
      geo = mergeVertices(geo, 1e-4);
      const removeN = Math.max(0, geo.attributes.position.count - target);
      if (removeN > 0) geo = await new SimplifyModifier().modify(geo, removeN);
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      const size = new THREE.Vector3();
      geo.boundingBox.getSize(size);
      // текстуры: 512 px, JPEG
      const shrink = (t: any) => {
        if (!t?.image) return null;
        const cv = document.createElement('canvas');
        cv.width = cv.height = texSize;
        cv.getContext('2d')!.drawImage(t.image, 0, 0, texSize, texSize);
        const nt = new THREE.CanvasTexture(cv);
        nt.flipY = t.flipY;
        nt.colorSpace = t.colorSpace;
        nt.userData.mimeType = 'image/jpeg';
        return nt;
      };
      const sm = src.material;
      const mat = new THREE.MeshStandardMaterial({
        name: 'asyk',
        map: shrink(sm.map),
        metalnessMap: shrink(sm.metalnessMap),
        roughnessMap: null,
        metalness: sm.metalness,
        roughness: Math.max(0.45, sm.roughness),
      });
      mat.roughnessMap = mat.metalnessMap;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'asyk';
      const scene = new THREE.Scene();
      scene.add(mesh);
      const out: ArrayBuffer = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
      let bin = '';
      const u8 = new Uint8Array(out);
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return {
        glb: btoa(bin),
        before,
        after: geo.attributes.position.count,
        tris: (geo.index ? geo.index.count : geo.attributes.position.count) / 3,
        size: [size.x, size.y, size.z],
      };
    },
    [TARGET_VERTS, TEX, ASYK_W, ASYK_H] as const,
  );
  mkdirSync('public/assets/models', { recursive: true });
  const buf = Buffer.from(res.glb, 'base64');
  writeFileSync(OUT, buf);
  await b.close();
  console.log(
    `${OUT}: ${Math.round(buf.length / 1024)} KB, vertices ${res.before} → ${res.after}, triangles ${Math.round(res.tris)}, size ${res.size.map((v: number) => v.toFixed(1)).join('×')}`,
  );
}

void main();
