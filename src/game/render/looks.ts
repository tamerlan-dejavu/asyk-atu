/**
 * Косметика: палитры сақа, асыков и площадок. ТОЛЬКО внешний вид —
 * физика, размеры, очки и ссылки-вызовы от выбранного оформления не зависят.
 */

export interface SakaPal {
  /** градиент от светлого верха-слева к тёмному низу-справа */
  c: [string, string, string, string];
  outline: string;
  inlay: string;
  /** орнамент «оюлы» */
  ornament?: boolean;
}

export const SAKA_SKINS: Record<string, SakaPal> = {
  saka_bronze: { c: ['#ecc99a', '#b8763a', '#6a3a18', '#2a170a'], outline: '#1a0f06', inlay: '#16a5a3' },
  saka_silver: { c: ['#eef2f6', '#a9b6c4', '#5b6874', '#2b333b'], outline: '#11171c', inlay: '#16a5a3' },
  saka_gold: { c: ['#fff0b0', '#e0b23a', '#9a6a10', '#4a3006'], outline: '#2a1c04', inlay: '#9a4526' },
  saka_oyu: { c: ['#7fa0d0', '#3f62a0', '#22396b', '#0d1a33'], outline: '#08101f', inlay: '#f6ecd0', ornament: true },
  saka_jade: { c: ['#c8f0d8', '#5fbf8c', '#2a7a55', '#123d2a'], outline: '#0b241a', inlay: '#e0b23a' },
  saka_onyx: { c: ['#9aa0ac', '#464a55', '#1c1d23', '#060607'], outline: '#000000', inlay: '#e0b23a' },
};

export interface AsykPal {
  light: string;
  mid: string;
  dark: string;
  outline: string;
  vein: string;
}

export const ASYK_SETS: Record<string, AsykPal> = {
  asyk_bone: { light: '#fffaf0', mid: '#efe0b8', dark: '#c4a56c', outline: '#4b3018', vein: 'rgba(139,105,58,0.35)' },
  asyk_red: { light: '#ffe6df', mid: '#eba393', dark: '#a84a3a', outline: '#4a1a12', vein: 'rgba(120,40,30,0.35)' },
};

export const GOLDEN_PAL: AsykPal = { light: '#fff6c0', mid: '#f0c53a', dark: '#b0801a', outline: '#5a3d0a', vein: 'rgba(120,80,10,0.35)' };
export const HEAVY_PAL: AsykPal = { light: '#d6d1c8', mid: '#7c766c', dark: '#3e3a34', outline: '#1a1612', vein: 'rgba(20,16,12,0.4)' };

export interface ThemePal {
  ground: [string, string];
  blotDark: string;
  blotLight: string;
  speckDark: string;
  speckLight: string;
  grass: string;
  sky: [string, string, string];
  hill: [string, string];
  crown: string;
  trunk: string;
  fence: string;
  frame: string;
  frameDots: string;
  frameLine: string;
  vignette: string;
  bunting?: boolean;
  night?: boolean;
}

export const THEMES: Record<string, ThemePal> = {
  theme_yard: {
    ground: ['#cf9f62', '#bb8544'],
    blotDark: 'rgba(120,70,30,0.10)',
    blotLight: 'rgba(255,225,170,0.10)',
    speckDark: '110,65,28',
    speckLight: '255,232,188',
    grass: '105,110,45',
    sky: ['#f2d9a4', '#e9c68c', '#d9ad72'],
    hill: ['#c9a26a', '#b48a50'],
    crown: '#6f6a34',
    trunk: '#5a4526',
    fence: '#6a4526',
    frame: '#9a4526',
    frameDots: '#16a5a3',
    frameLine: '#f6ecd0',
    vignette: '60,30,10',
  },
  theme_steppe: {
    ground: ['#bdb56a', '#9c9a4c'],
    blotDark: 'rgba(70,90,30,0.12)',
    blotLight: 'rgba(240,240,170,0.12)',
    speckDark: '80,90,30',
    speckLight: '235,240,190',
    grass: '70,110,40',
    sky: ['#cfe6ee', '#e0eee6', '#d6e6c4'],
    hill: ['#a3b97c', '#86a062'],
    crown: '#4d6b2c',
    trunk: '#4a3c22',
    fence: '#5a4a2a',
    frame: '#3f6b5a',
    frameDots: '#f6ecd0',
    frameLine: '#f6ecd0',
    vignette: '30,50,20',
  },
  theme_toy: {
    ground: ['#e3bd7c', '#d0a360'],
    blotDark: 'rgba(150,90,40,0.10)',
    blotLight: 'rgba(255,240,200,0.14)',
    speckDark: '140,90,40',
    speckLight: '255,240,205',
    grass: '120,120,55',
    sky: ['#ffe6b0', '#f8d29a', '#e8b878'],
    hill: ['#d9b27a', '#c49a60'],
    crown: '#7d7a3a',
    trunk: '#5a4526',
    fence: '#7a4a2a',
    frame: '#b03a2e',
    frameDots: '#f2c230',
    frameLine: '#fff3d0',
    vignette: '80,30,20',
    bunting: true,
  },
  theme_night: {
    ground: ['#6a6890', '#4a4870'],
    blotDark: 'rgba(20,20,50,0.18)',
    blotLight: 'rgba(200,200,255,0.08)',
    speckDark: '30,30,70',
    speckLight: '190,190,240',
    grass: '90,110,120',
    sky: ['#141a3d', '#232b5c', '#3a3f7a'],
    hill: ['#2a3060', '#1e2450'],
    crown: '#1b2d3a',
    trunk: '#141a22',
    fence: '#2a2f44',
    frame: '#2b2f55',
    frameDots: '#e7c65a',
    frameLine: '#c9cff0',
    vignette: '10,10,40',
    night: true,
  },
};

export function sakaPal(id: string): SakaPal {
  return SAKA_SKINS[id] ?? SAKA_SKINS.saka_bronze;
}
export function asykPal(id: string): AsykPal {
  return ASYK_SETS[id] ?? ASYK_SETS.asyk_bone;
}
export function themePal(id: string): ThemePal {
  return THEMES[id] ?? THEMES.theme_yard;
}
