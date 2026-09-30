/**
 * Рисованные ассеты (public/assets). ТОЛЬКО внешний вид: хитбоксы и физика от картинок не зависят —
 * спрайт вписывается в размер тела из config.ts. Если файл не загрузился, остаётся процедурная отрисовка.
 */
import type { AsykType } from '../../types';

const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
export const assetUrl = (path: string): string => `${BASE}assets/${path}`;
/** Картинка ассета: WebP (в 4 раза легче PNG, с прозрачностью); PNG лежат рядом как исходники. */
export const artUrl = (dir: string, name: string): string => assetUrl(`${dir}/${name}.webp`);

/** Скин сақа → файл. jade и onyx (набор «Той-Pro») нарисованы как «дракон» и «неон». */
export const SAKA_ART: Record<string, string> = {
  saka_bronze: 'saka_bronze',
  saka_silver: 'saka_silver',
  saka_gold: 'saka_gold',
  saka_oyu: 'saka_oyu',
  saka_jade: 'saka_dragon',
  saka_onyx: 'saka_neon',
  saka_eagle: 'saka_eagle',
  saka_snowleopard: 'saka_snowleopard',
  saka_tulpar: 'saka_tulpar',
  saka_lava: 'saka_lava',
};

/** Набор асыков → префикс файлов (по 3 варианта: _1, _2, _3). */
export const ASYK_ART: Record<string, string> = { asyk_bone: 'asyk_bone', asyk_red: 'asyk_red', asyk_wood: 'asyk_wood' };
export const TYPE_ART: Record<Exclude<AsykType, 'normal' | 'block'>, string> = { golden: 'asyk_golden', heavy: 'asyk_heavy' };
export const VARIANTS = 3;

/** Декор площадки по теме: какие пропсы (не физика, не заходят в кон и в зону броска). */
export const THEME_PROPS: Record<string, string[]> = {
  theme_yard: ['props_pebble_1', 'props_pebble_2', 'props_pebble_3', 'props_twig_1', 'props_twig_2', 'props_grass_1', 'props_grass_3'],
  theme_steppe: [
    'props_grass_1',
    'props_grass_2',
    'props_grass_3',
    'props_grass_4',
    'props_flower_yellow',
    'props_flower_white',
    'props_pebble_4',
  ],
  theme_toy: ['props_flower_red', 'props_flower_yellow', 'props_flower_white', 'props_pebble_2', 'props_grass_2', 'props_twig_3'],
  theme_night: ['props_snow_1', 'props_snow_2', 'props_pebble_1', 'props_pebble_5', 'props_twig_2', 'props_grass_4'],
};
export const themeProps = (theme: string): string[] => THEME_PROPS[theme] ?? THEME_PROPS.theme_yard;

export const artKey = (name: string): string => `art:${name}`;

/**
 * ВРЕМЕННО: игрок бросает асык, а не сақа — только внешний вид (физика и хитбокс сақа 56×34 прежние).
 * 2D: картинка асыка надетого набора; 3D: модель асыка, крупнее мишеней. false — вернуть сақа.
 */
export const SAKA_LOOKS_LIKE_ASYK = true;

/** Эффект сақа по скину: цвет следа и вид частиц при полёте/ударе. */
export type SkinFx = 'none' | 'sparks' | 'glow' | 'neon' | 'embers';
export const SKIN_FX: Record<string, { trail: number; fx: SkinFx }> = {
  saka_bronze: { trail: 0xd89a55, fx: 'none' },
  saka_silver: { trail: 0xdfe8ee, fx: 'none' },
  saka_gold: { trail: 0xffd35a, fx: 'glow' },
  saka_oyu: { trail: 0x6f9be0, fx: 'none' },
  saka_jade: { trail: 0x6fd08c, fx: 'sparks' }, // дракон — искры
  saka_onyx: { trail: 0xb66cff, fx: 'neon' }, // неон — неоновый след
  saka_eagle: { trail: 0xe9c07a, fx: 'none' },
  saka_snowleopard: { trail: 0xeef4ff, fx: 'glow' },
  saka_tulpar: { trail: 0x9fd2ff, fx: 'glow' }, // тулпар — свечение
  saka_lava: { trail: 0xff7a2a, fx: 'embers' }, // лава — угольки
};
export const skinFx = (id: string) => SKIN_FX[id] ?? SKIN_FX.saka_bronze;

export interface ArtLook {
  saka: string;
  asyk: string;
  theme: string;
}

/** Файлы, нужные для оформления (грузятся в preload сцены; остальные скины — по требованию). */
export function artFiles(look: ArtLook): { key: string; url: string }[] {
  const out: { key: string; url: string }[] = [];
  const add = (dir: string, name: string) => out.push({ key: artKey(name), url: artUrl(dir, name) });
  add('saka', SAKA_ART[look.saka] ?? SAKA_ART.saka_bronze);
  for (const pre of [ASYK_ART[look.asyk] ?? ASYK_ART.asyk_bone, TYPE_ART.golden, TYPE_ART.heavy])
    for (let v = 1; v <= VARIANTS; v++) add('asyk', `${pre}_${v}`);
  add('asyk', 'block_stone_1');
  add('asyk', 'block_stone_2');
  add('props', 'ring_oyu');
  for (const p of themeProps(look.theme)) add('props', p);
  return out;
}

/** Иконки интерфейса, уже скачанные в память (blob:) — без сети интерфейс остаётся целым. */
const iconBlobs = new Map<string, string>();

/** Картинки интерфейса (DOM): из памяти, если уже скачаны, иначе по сети. */
export const uiIcon = (name: string): string => iconBlobs.get(name) ?? artUrl('ui', name);

/** Скачать иконки один раз и держать в памяти (сервер отдаёт файлы с перепроверкой — без сети кэш не спасает). */
export async function cacheIcons(names: string[]): Promise<void> {
  await Promise.all(
    names.map(async (n) => {
      if (iconBlobs.has(n)) return;
      try {
        const r = await fetch(artUrl('ui', n));
        if (r.ok) iconBlobs.set(n, URL.createObjectURL(await r.blob()));
      } catch {
        /* без сети — останется сетевой адрес */
      }
    }),
  );
}
