/**
 * Благодарности: музыка и 3D-модель. Эти же данные — в public/CREDITS.txt и README.
 * Музыка — Pixabay (Pixabay Content License: можно использовать в играх, указание автора не обязательно,
 * но мы его указываем). Файлы перекодированы в моно 64 кбит/с (scripts/encode-music.ts).
 */
export interface Credit {
  /** что это в игре (ключ i18n не нужен — названия произведений не переводятся) */
  role: 'menu' | 'game' | 'model';
  title: string;
  author: string;
  license: string;
  url: string;
}

export const MUSIC_CREDITS: Credit[] = [
  {
    role: 'menu',
    title: 'Poetica',
    author: 'roman_sol',
    license: 'Pixabay Content License',
    url: 'https://pixabay.com/music/search/poetica%20roman_sol/',
  },
  {
    role: 'game',
    title: 'Atlas Kazakhstan',
    author: 'vadim_makes_sound',
    license: 'Pixabay Content License',
    url: 'https://pixabay.com/music/search/atlas%20kazakhstan/',
  },
];

export const MODEL_CREDIT: Credit = {
  role: 'model',
  title: 'Asyq (асық, асык) 3d model',
  author: 'cozaim',
  license: 'CC BY-NC 4.0',
  url: 'https://sketchfab.com/3d-models/asyq-3d-model-098b2e1cbda7465cb31177ac7c4dfe57',
};
