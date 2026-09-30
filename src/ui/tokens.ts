/**
 * Дизайн-токены для кода, который рисует на canvas (Phaser) и не видит CSS-переменных.
 * Значения совпадают с src/styles/tokens.css.
 */
export const COLOR = {
  night900: 0x11163a,
  night800: 0x182050,
  gold300: 0xffe08a,
  gold400: 0xffcf4a,
  gold500: 0xf2b01e,
  terra500: 0xc4532c,
  turq400: 0x2cc4bf,
  turq500: 0x16a5a3,
  cream100: 0xf7edd3,
  ink: 0x2b1a0e,
} as const;

/** Та же палитра строками — для CanvasRenderingContext2D. */
export const CSS_COLOR = {
  gold400: '#ffcf4a',
  gold200: '#fff0bf',
  cream100: '#f7edd3',
  turq400: '#2cc4bf',
  night900: '#11163a',
} as const;

export const FONT = {
  display: "'Montserrat Alternates', 'Nunito', system-ui, sans-serif",
  body: "'Nunito', system-ui, sans-serif",
} as const;

/** Длительности анимаций, мс (как --dur-1/2/3). */
export const DUR = { fast: 120, base: 200, slow: 320 } as const;
