/**
 * Раскладка страницы. Поле (720×1080) и логика не меняются — только оболочка вокруг поля.
 *  - phone   — ширина ≤ 600 или портрет, а также телефон «боком» (там просим повернуть): как раньше;
 *  - compact — ландшафт 601…1023 (планшет, небольшое окно): поле + одна колонка панелей справа;
 *  - desktop — ландшафт ≥ 1024: панели слева и справа от поля, меню — широким контейнером.
 */
export type Layout = 'phone' | 'compact' | 'desktop';

export const DESKTOP_QUERY = '(min-width: 1024px) and (orientation: landscape)';

/** Чистая функция для тестов: ширина/высота окна и «грубый» указатель (палец). */
export function layoutFor(w: number, h: number, coarse: boolean): Layout {
  const landscape = w > h;
  if (!landscape || w <= 600) return 'phone';
  // телефон боком: показываем «поверните устройство», раскладку не меняем
  if (coarse && h <= 520) return 'phone';
  return w >= 1024 ? 'desktop' : 'compact';
}

const listeners = new Set<(l: Layout) => void>();
let current: Layout = 'phone';

export const layout = (): Layout => current;
export const isWide = (): boolean => current !== 'phone';

export function onLayout(fn: (l: Layout) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function measure(): Layout {
  // десктоп определяется медиа-запросом из ТЗ; остальное — по размерам окна
  const desktop = window.matchMedia(DESKTOP_QUERY).matches;
  const l = layoutFor(window.innerWidth, window.innerHeight, window.matchMedia('(pointer: coarse)').matches);
  return desktop && l !== 'phone' ? 'desktop' : l === 'desktop' ? 'compact' : l;
}

function apply(): void {
  const next = measure();
  if (next === current && document.documentElement.dataset.layout === next) return;
  current = next;
  document.documentElement.dataset.layout = next;
  listeners.forEach((fn) => fn(next));
}

/** Следит за размером окна (debounce 100 мс) и медиа-запросом десктопа — без перезагрузки. */
export function initLayout(onResize?: () => void): void {
  apply();
  let timer = 0;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      apply();
      onResize?.();
    }, 100);
  };
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', later);
  window.matchMedia(DESKTOP_QUERY).addEventListener('change', later);
}
