import { ASYK, BLOCK, FIELD_H, FIELD_W, SAKA, ZONE } from '../config';
import { bonePolygon } from '../physics/bodies';
import { FAR_H, LAYER_MARGIN, TEX } from '../render/textures';
import type { AsykType } from '../../types';
import { ASPECT, fitCamera, project as projectPure, type CamParams, type Projected } from './camera3d';
import { meshTransform, type BodySnapshot } from './sync';
import { assetUrl } from '../render/art';
import { sakaStyle } from '../render/skins';
import {
  CanvasTexture,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Shape,
  SRGBColorSpace,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Texture,
  GLTFLoader,
} from './three-lite';

export type CameraMode = 'idle' | 'aim' | 'follow' | 'settle';

export interface ThreeViewOptions {
  /** id надетого скина сақа (стиль модели) */
  saka: () => string;
  /** Phaser-canvas, поверх которого рисуются прицел и эффекты */
  overlay: HTMLCanvasElement;
  /** холсты текстур, запечённых 2D-кодом (render/textures.ts) */
  canvas: (key: string) => HTMLCanvasElement | null;
  quality: 'high' | 'low';
  reducedMotion: boolean;
  palette: { sky: string; horizon: string; ground: string; hemiSky: string; hemiGround: string };
}

interface BodyMesh {
  group: Group;
  body: Mesh;
  blob: Mesh | null;
  blobMat: MeshBasicMaterial | null;
  kind: string;
}

const THICK: Record<string, number> = { asyk: 16, saka: 20, block: 34 };
const MAX_DRAW_PIXEL_RATIO = { high: 2, low: 1.5 };

/**
 * 3D-вид: перспективная камера сзади-сверху, объёмные тела и свет. ТОЛЬКО отображение:
 * каждый кадр читает снимок физики и ничего не пишет обратно.
 */
export class ThreeView {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  /** базовая камера (для ввода: стабильна, не «дышит» и не следует за сақа) */
  readonly base: CamParams;
  /** текущая (анимированная) камера — для отрисовки и проекции оверлея */
  current: CamParams;
  private mode: CameraMode = 'idle';
  private modeT = 0;
  private aimPower = 0;
  private followTarget: { x: number; z: number } | null = null;
  private kickT = -1;
  private settleFrom: CamParams | null = null;
  private time = 0;
  private meshes = new Map<string, BodyMesh>();
  private geos = new Map<string, BufferGeometry>();
  private mats = new Map<string, Material[]>();
  private textures: Texture[] = [];
  private disposables: { dispose(): void }[] = [];
  private blobGeo: PlaneGeometry | null = null;
  private blobTex: Texture | null = null;
  private resizeObs: ResizeObserver | null = null;
  /** 3D-модель асыка (GLB): геометрия в единицах поля (длина = ASYK.w, ширина = ASYK.h) и исходный материал */
  private asykModel: { geo: BufferGeometry; mat: MeshStandardMaterial } | null = null;
  private destroyed = false;
  lost = false;

  constructor(
    container: HTMLElement,
    private readonly opt: ThreeViewOptions,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'three-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    container.insertBefore(this.canvas, container.firstChild);
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: opt.quality === 'high',
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DRAW_PIXEL_RATIO[opt.quality]));
    this.renderer.shadowMap.enabled = opt.quality === 'high';
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
    });

    const fit = fitCamera();
    this.base = fit.cam;
    this.current = { ...fit.cam, pos: { ...fit.cam.pos }, target: { ...fit.cam.target } };
    this.camera = new PerspectiveCamera(fit.cam.fovDeg, ASPECT, 10, 6000);
    this.buildScene();
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(opt.overlay);
    void this.loadAsykModel();
  }

  /**
   * Модель асыка «Asyq (асық, асык) 3d model» — cozaim, CC BY-NC 4.0 (подготовлена scripts/optimize-asyk-model.ts).
   * Пока грузится или если не загрузилась — асыки остаются выдавленными «косточками» с текстурой.
   */
  private async loadAsykModel(): Promise<void> {
    try {
      const gltf = await new GLTFLoader().loadAsync(assetUrl('models/asyk.glb'));
      if (this.destroyed) return;
      let found: Mesh | null = null;
      gltf.scene.traverse((o) => {
        if (!found && (o as Mesh).isMesh) found = o as Mesh;
      });
      const mesh = found as Mesh | null;
      if (!mesh) return;
      const mat = mesh.material as MeshStandardMaterial;
      this.asykModel = { geo: mesh.geometry, mat };
      this.disposables.push(mesh.geometry, mat);
      [mat.map, mat.metalnessMap].forEach((t) => t && this.disposables.push(t));
      // уже созданные асыки перестраиваются моделью при следующей синхронизации
      for (const [id, m] of this.meshes)
        if ((m.kind.startsWith('asyk:') && m.kind !== 'asyk:block') || m.kind.startsWith('saka:')) this.removeMesh(id);
    } catch {
      /* без модели — прежняя геометрия */
    }
  }

  /** Средний цвет текстуры набора асыков (кость / красный / дерево), нормированный: им тонируется модель. */
  private setTint(): Color {
    const c = this.opt.canvas('asyk');
    if (!c) return new Color(1, 1, 1);
    try {
      const g = c.getContext('2d')!;
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let r = 0;
      let gg = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 16) {
        if (d[i + 3] < 200) continue;
        r += d[i];
        gg += d[i + 1];
        b += d[i + 2];
        n++;
      }
      if (!n) return new Color(1, 1, 1);
      const mx = Math.max(r, gg, b);
      // светлая кость — почти без тонировки; цветные наборы — в свой цвет
      return new Color(r / mx, gg / mx, b / mx).lerp(new Color(1, 1, 1), 0.25);
    } catch {
      return new Color(1, 1, 1);
    }
  }

  /** Материал сақа: модель асыка в стиле надетого скина (skins.ts). Один на сцену, обновляется при смене скина. */
  private sakaMat: MeshStandardMaterial | null = null;
  private sakaMaterial(): MeshStandardMaterial {
    if (!this.sakaMat) {
      this.sakaMat = this.asykModel!.mat.clone();
      this.disposables.push(this.sakaMat);
    }
    const st = sakaStyle(this.opt.saka());
    const m = this.sakaMat;
    m.color = new Color(st.color);
    m.metalness = st.metalness;
    m.roughness = st.roughness;
    m.emissive = new Color(st.emissive);
    m.emissiveMap = m.map;
    m.emissiveIntensity = st.emissiveIntensity;
    return m;
  }

  /** Материал модели по типу асыка: обычный — тонировка набора, золотой — металл с блеском, тяжёлый — тёмный. */
  private modelMaterial(type: AsykType): MeshStandardMaterial {
    const key = `model:${type}`;
    const cached = this.mats.get(key);
    if (cached) return cached[0] as MeshStandardMaterial;
    const m = this.asykModel!.mat.clone();
    if (type === 'golden') {
      m.color = new Color(0xffc53a);
      m.metalness = 0.75;
      m.roughness = 0.32;
      m.emissive = new Color(0x6a4a00);
      m.emissiveIntensity = 0.45;
    } else if (type === 'heavy') {
      m.color = new Color(0x9a96a2);
      m.metalness = 0.35;
      m.roughness = 0.5;
    } else {
      m.color = this.setTint();
    }
    // лёгкая подсветка собственной текстурой: асык не тонет в тени и на тёмной (ночной) карте
    if (type !== 'golden' && m.map) {
      m.emissiveMap = m.map;
      m.emissive = type === 'heavy' ? new Color(0x55555f) : m.color.clone().multiplyScalar(0.28);
      m.emissiveIntensity = 1;
    }
    this.mats.set(key, [m]);
    this.disposables.push(m);
    return m;
  }

  // ---------------------------------------------------------------- сцена
  private tex(key: string): CanvasTexture | null {
    const c = this.opt.canvas(key);
    if (!c) return null;
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    this.textures.push(t);
    return t;
  }

  private buildScene(): void {
    const p = this.opt.palette;
    this.scene.background = new Color(p.sky);
    this.scene.fog = new Fog(new Color(p.horizon), 1500, 3600);

    const hemi = new HemisphereLight(new Color(p.hemiSky), new Color(p.hemiGround), 1.25);
    this.scene.add(hemi);
    // свет сверху-слева — то же направление, что у теней в 2D (тень вправо-вниз)
    const sun = new DirectionalLight(0xfff4e0, 2.1);
    sun.position.set(ZONE.x - 420, 900, ZONE.y - 380);
    sun.target.position.set(ZONE.x, 0, 600);
    this.scene.add(sun, sun.target);
    if (this.opt.quality === 'high') {
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const c = sun.shadow.camera;
      c.left = -460;
      c.right = 460;
      c.top = 560;
      c.bottom = -560;
      c.near = 200;
      c.far = 2200;
      sun.shadow.bias = -0.0008;
      sun.shadow.normalBias = 0.6;
    }

    // земля за пределами поля: однотонная + туман (без резкого края)
    const outer = new Mesh(new PlaneGeometry(9000, 9000), new MeshStandardMaterial({ color: new Color(p.ground), roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(FIELD_W / 2, -0.6, FIELD_H / 2);
    outer.receiveShadow = this.opt.quality === 'high';
    this.track(outer);
    this.scene.add(outer);

    // игровое поле с текстурой текущей площадки
    const gw = FIELD_W + LAYER_MARGIN * 2;
    const gh = FIELD_H + LAYER_MARGIN * 2;
    const groundTex = this.tex('ground');
    const ground = new Mesh(new PlaneGeometry(gw, gh), new MeshStandardMaterial({ map: groundTex, roughness: 0.95, color: 0xffffff }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(FIELD_W / 2, 0, FIELD_H / 2);
    ground.receiveShadow = this.opt.quality === 'high';
    this.track(ground);
    this.scene.add(ground);

    // дальний план (забор, деревья, юрта) — вертикальный «задник» за коном
    const farTex = this.tex('far');
    if (farTex) {
      const w = 1300;
      const h = (w * FAR_H) / gw;
      const far = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: farTex, fog: true }));
      far.position.set(FIELD_W / 2, h / 2 - 6, -60);
      this.track(far);
      this.scene.add(far);
    }

    // кон: вдавленное кольцо — декаль чуть выше земли (граница плоская, без искажений)
    const zoneTex = this.tex('zone');
    const zs = (ZONE.r + 24) * 2;
    const zone = new Mesh(
      new PlaneGeometry(zs, zs),
      new MeshStandardMaterial({
        map: zoneTex,
        transparent: true,
        depthWrite: false,
        roughness: 0.95,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(ZONE.x, 0.5, ZONE.y);
    zone.receiveShadow = this.opt.quality === 'high';
    this.track(zone);
    this.scene.add(zone);

    if (this.opt.quality === 'low') {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      rg.addColorStop(0, 'rgba(30,15,5,0.55)');
      rg.addColorStop(1, 'rgba(30,15,5,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 64, 64);
      this.blobTex = new CanvasTexture(c);
      this.textures.push(this.blobTex);
      this.blobGeo = new PlaneGeometry(1, 1);
      this.blobGeo.rotateX(-Math.PI / 2);
      this.disposables.push(this.blobGeo);
    }
  }

  private track(m: Mesh): void {
    this.disposables.push(m.geometry);
    const mat = m.material as Material | Material[];
    (Array.isArray(mat) ? mat : [mat]).forEach((x) => this.disposables.push(x));
  }

  /** Геометрия «косточки» / камня: выдавленный контур физического тела, низ на земле (Y = 0). */
  private geometry(kind: 'asyk' | 'saka' | 'block'): BufferGeometry {
    const cached = this.geos.get(kind);
    if (cached) return cached;
    const shape = new Shape();
    if (kind === 'block') {
      const s = BLOCK.size / 2;
      const r = BLOCK.radius;
      shape.moveTo(-s + r, -s);
      shape.lineTo(s - r, -s);
      shape.quadraticCurveTo(s, -s, s, -s + r);
      shape.lineTo(s, s - r);
      shape.quadraticCurveTo(s, s, s - r, s);
      shape.lineTo(-s + r, s);
      shape.quadraticCurveTo(-s, s, -s, s - r);
      shape.lineTo(-s, -s + r);
      shape.quadraticCurveTo(-s, -s, -s + r, -s);
    } else {
      const pts = kind === 'saka' ? bonePolygon(SAKA.w, SAKA.h) : bonePolygon(ASYK.w, ASYK.h);
      shape.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
      shape.closePath();
    }
    const bevel = kind === 'block' ? 3 : 2;
    const depth = THICK[kind] - bevel * 2;
    const g = new ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel * 0.8,
      bevelSegments: 2,
      curveSegments: 4,
    });
    // контур лежит в XY → кладём на землю: y формы → +Z мира, выдавливание → вниз; поднимаем на толщину
    g.rotateX(Math.PI / 2);
    g.translate(0, depth + bevel, 0);
    this.geos.set(kind, g);
    this.disposables.push(g);
    return g;
  }

  /** Средний цвет по кромке текстуры тела, темнее на 25 % — для боковин. */
  private edgeColor(c: HTMLCanvasElement, kind: string): Color {
    try {
      const g = c.getContext('2d')!;
      const w = c.width;
      const h = c.height;
      const cx = w / 2;
      const cy = h / 2;
      const rx =
        (kind === 'block' ? BLOCK.size / 2 : kind === 'saka' ? SAKA.w / 2 : ASYK.w / 2) *
        (w / (kind === 'block' ? TEX.block.w : kind === 'saka' ? TEX.saka.w : TEX.asyk.w)) *
        0.7;
      const ry = rx * (kind === 'block' ? 1 : kind === 'saka' ? SAKA.h / SAKA.w : ASYK.h / ASYK.w);
      let r = 0;
      let gg = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const d = g.getImageData(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1).data;
        if (d[3] < 128) continue;
        r += d[0];
        gg += d[1];
        b += d[2];
        n++;
      }
      if (!n) return new Color(0x6b5a44);
      return new Color((r / n / 255) * 0.75, (gg / n / 255) * 0.75, (b / n / 255) * 0.75).convertSRGBToLinear();
    } catch {
      return new Color(0x6b5a44);
    }
  }

  private materials(kind: 'asyk' | 'saka' | 'block', type: AsykType): Material[] {
    const key = `${kind}:${type}`;
    const cached = this.mats.get(key);
    if (cached) return cached;
    const texKey =
      kind === 'saka' ? 'saka' : type === 'golden' ? 'asykGolden' : type === 'heavy' ? 'asykHeavy' : type === 'block' ? 'block' : 'asyk';
    const size = kind === 'saka' ? TEX.saka : kind === 'block' ? TEX.block : TEX.asyk;
    const canvas = this.opt.canvas(texKey);
    const map = this.tex(texKey);
    if (map) {
      // UV верхней грани = координаты контура; переводим их в долю текстуры (тело в центре холста)
      map.repeat.set(1 / size.w, -1 / size.h);
      map.offset.set(0.5, 0.5);
    }
    const look =
      kind === 'saka'
        ? { metalness: 0.55, roughness: 0.32 }
        : type === 'golden'
          ? { metalness: 0.7, roughness: 0.35 }
          : type === 'heavy'
            ? { metalness: 0.15, roughness: 0.85 }
            : type === 'block'
              ? { metalness: 0, roughness: 0.9 }
              : { metalness: 0, roughness: 0.6 };
    // золото без карты окружения выглядит тёмным — лёгкое собственное свечение возвращает «блеск»
    const glow = type === 'golden' ? { emissive: new Color(0x6a4a00), emissiveIntensity: 0.45 } : {};
    const cap = new MeshStandardMaterial({ map, ...look, ...glow });
    const side = new MeshStandardMaterial({ color: canvas ? this.edgeColor(canvas, kind) : 0x6b5a44, ...look });
    const out = [cap, side];
    this.mats.set(key, out);
    out.forEach((m) => this.disposables.push(m));
    return out;
  }

  private meshFor(b: BodySnapshot): BodyMesh {
    const found = this.meshes.get(b.id);
    const kind = b.kind === 'saka' ? 'saka' : b.type === 'block' ? 'block' : 'asyk';
    const key = `${kind}:${b.type}`;
    if (found && found.kind === key) return found;
    if (found) this.removeMesh(b.id);
    const asSaka = kind === 'saka';
    const model = (kind === 'asyk' || asSaka) && this.asykModel;
    const body = model
      ? new Mesh(this.asykModel!.geo, asSaka ? this.sakaMaterial() : this.modelMaterial(b.type))
      : new Mesh(this.geometry(kind), this.materials(kind, b.type));
    // сақа — та же модель асыка в размере сақа (56×34) и в стиле надетого скина
    if (model && asSaka) body.scale.set(SAKA.w / ASYK.w, SAKA.h / ASYK.h, SAKA.h / ASYK.h);
    body.castShadow = this.opt.quality === 'high';
    body.receiveShadow = false;
    const group = new Group();
    group.add(body);
    let blob: Mesh | null = null;
    let blobMat: MeshBasicMaterial | null = null;
    if (this.blobGeo && this.blobTex) {
      blobMat = new MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false });
      blob = new Mesh(this.blobGeo, blobMat);
      const w = kind === 'saka' ? SAKA.w : kind === 'block' ? BLOCK.size : ASYK.w;
      const h = kind === 'saka' ? SAKA.h : kind === 'block' ? BLOCK.size : ASYK.h;
      blob.scale.set(w * 1.7, 1, h * 2.1);
      this.scene.add(blob);
    }
    this.scene.add(group);
    const m: BodyMesh = { group, body, blob, blobMat, kind: key };
    this.meshes.set(b.id, m);
    return m;
  }

  private removeMesh(id: string): void {
    const m = this.meshes.get(id);
    if (!m) return;
    this.scene.remove(m.group);
    if (m.blob) this.scene.remove(m.blob);
    m.blobMat?.dispose();
    this.meshes.delete(id);
  }

  // ---------------------------------------------------------------- синхронизация
  syncBodies(list: BodySnapshot[]): void {
    const seen = new Set<string>();
    for (const b of list) {
      seen.add(b.id);
      const m = this.meshFor(b);
      const tr = meshTransform(b);
      m.group.position.set(tr.px, tr.py, tr.pz);
      m.group.rotation.y = tr.rotY;
      // навес: «кувырок» вокруг длинной оси в полёте (только визуал; ось X — длинная ось тела)
      m.body.rotation.x = b.tilt ?? 0;
      m.group.scale.setScalar(tr.scale);
      m.group.visible = b.alpha > 0.02;
      if (m.blob && m.blobMat) {
        // тень-пятно: смещена по свету, растягивается и светлеет с высотой
        m.blob.position.set(b.x + 4 + b.z * 0.8, 0.3, b.y + 5 + b.z * 0.8);
        m.blob.rotation.y = -b.angle;
        m.blobMat.opacity = Math.max(0.15, 1 - b.z * 0.06) * Math.min(1, b.alpha);
        m.blob.visible = m.group.visible;
      }
    }
    for (const id of [...this.meshes.keys()]) if (!seen.has(id)) this.removeMesh(id);
  }

  /** Площадка/скин изменились (магазин): перерисованные 2D-холсты заново уходят в текстуры. */
  refreshTextures(): void {
    this.textures.forEach((t) => (t.needsUpdate = true));
    // набор асыков сменился — тонировка модели пересчитывается
    const normal = this.mats.get('model:normal');
    if (normal) (normal[0] as MeshStandardMaterial).color = this.setTint();
    if (this.sakaMat) this.sakaMaterial();
  }

  // ---------------------------------------------------------------- камера
  setCameraMode(mode: CameraMode, params: { power?: number; dirX?: number; dirY?: number; x?: number; y?: number } = {}): void {
    if (this.opt.reducedMotion) return;
    if (mode === 'aim') {
      this.aimPower = params.power ?? 0;
    }
    if (mode === 'follow' && params.x !== undefined && params.y !== undefined) this.followTarget = { x: params.x, z: params.y };
    if (mode === this.mode) return;
    if (mode === 'settle') this.settleFrom = { ...this.current, pos: { ...this.current.pos }, target: { ...this.current.target } };
    this.mode = mode;
    this.modeT = 0;
  }

  /** Толчок камеры на комбо: FOV +2° на 120 мс и лёгкая тряска. */
  kick(): void {
    if (!this.opt.reducedMotion) this.kickT = 0;
  }

  private animateCamera(dt: number): void {
    this.time += dt;
    this.modeT += dt;
    const b = this.base;
    const cur: CamParams = { ...b, pos: { ...b.pos }, target: { ...b.target } };
    if (!this.opt.reducedMotion) {
      // «дыхание» ±4 единицы, период 6 с
      cur.pos.y += Math.sin((this.time / 6000) * Math.PI * 2) * 4;
      if (this.mode === 'aim') {
        // подъезд вперёд и чуть вниз по силе, FOV сужается на 2°
        const k = this.aimPower;
        const fx = b.target.x - b.pos.x;
        const fy = b.target.y - b.pos.y;
        const fz = b.target.z - b.pos.z;
        const l = Math.hypot(fx, fy, fz);
        cur.pos.x += (fx / l) * 40 * k;
        cur.pos.y += (fy / l) * 40 * k - 8 * k;
        cur.pos.z += (fz / l) * 40 * k;
        cur.fovDeg -= 2 * k;
      } else if (this.mode === 'follow' && this.followTarget) {
        // мягко смотрим вслед за сақа (вес 0.35), смещение взгляда ограничено
        const dx = Math.max(-140, Math.min(140, (this.followTarget.x - b.target.x) * 0.35));
        const dz = Math.max(-220, Math.min(120, (this.followTarget.z - b.target.z) * 0.35));
        cur.target.x += dx;
        cur.target.z += dz;
      } else if (this.mode === 'settle' && this.settleFrom) {
        // возврат к покою за 600 мс
        const u = Math.min(1, this.modeT / 600);
        const e = 1 - Math.pow(1 - u, 3);
        const s = this.settleFrom;
        cur.pos.x = s.pos.x + (cur.pos.x - s.pos.x) * e;
        cur.pos.y = s.pos.y + (cur.pos.y - s.pos.y) * e;
        cur.pos.z = s.pos.z + (cur.pos.z - s.pos.z) * e;
        cur.target.x = s.target.x + (cur.target.x - s.target.x) * e;
        cur.target.z = s.target.z + (cur.target.z - s.target.z) * e;
        cur.fovDeg = s.fovDeg + (cur.fovDeg - s.fovDeg) * e;
        if (u >= 1) this.mode = 'idle';
      }
      if (this.kickT >= 0) {
        this.kickT += dt;
        const u = this.kickT / 120;
        if (u >= 1) this.kickT = -1;
        else {
          cur.fovDeg += 2 * Math.sin(Math.PI * u);
          cur.pos.x += Math.sin(this.kickT * 0.9) * 3 * (1 - u);
          cur.pos.y += Math.cos(this.kickT * 1.1) * 3 * (1 - u);
        }
      }
    }
    // сглаживание, чтобы переходы между режимами не дёргались
    const s = 1 - Math.exp(-dt / 110);
    const c = this.current;
    c.pos.x += (cur.pos.x - c.pos.x) * s;
    c.pos.y += (cur.pos.y - c.pos.y) * s;
    c.pos.z += (cur.pos.z - c.pos.z) * s;
    c.target.x += (cur.target.x - c.target.x) * s;
    c.target.y += (cur.target.y - c.target.y) * s;
    c.target.z += (cur.target.z - c.target.z) * s;
    c.fovDeg += (cur.fovDeg - c.fovDeg) * s;
    this.camera.position.set(c.pos.x, c.pos.y, c.pos.z);
    this.camera.fov = c.fovDeg;
    this.camera.aspect = ASPECT;
    this.camera.lookAt(c.target.x, c.target.y, c.target.z);
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    if (this.lost) return;
    this.animateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Мировая точка (физические x, y и высота) → логические экранные координаты оверлея. */
  project(x: number, y: number, h = 0): Projected {
    return projectPure(this.current, { x, y: h, z: y });
  }

  stats(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }

  // ---------------------------------------------------------------- размер
  resize(): void {
    const o = this.opt.overlay;
    const w = o.offsetWidth;
    const h = o.offsetHeight;
    if (!w || !h) return;
    this.canvas.style.left = `${o.offsetLeft}px`;
    this.canvas.style.top = `${o.offsetTop}px`;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.renderer.setSize(w, h, false);
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObs?.disconnect();
    for (const id of [...this.meshes.keys()]) this.removeMesh(id);
    this.disposables.forEach((d) => d.dispose());
    this.textures.forEach((t) => t.dispose());
    this.disposables = [];
    this.textures = [];
    this.geos.clear();
    this.mats.clear();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

/** Есть ли WebGL на устройстве (без создания рендерера Three.js). */
export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') ?? c.getContext('webgl');
    const ok = Boolean(gl);
    (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}
