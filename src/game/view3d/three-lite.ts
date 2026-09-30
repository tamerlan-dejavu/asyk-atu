// Только нужные части Three.js: сборщик вырезает остальное, ленивый чанк 3D остаётся маленьким.
export {
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
} from 'three';
export type { BufferGeometry, Material, Texture } from 'three';
