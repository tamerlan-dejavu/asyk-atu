import type { SaveV2 } from '../types';

export type ShopCat = 'saka' | 'theme' | 'asyk';

export interface ShopItem {
  id: string;
  cat: ShopCat;
  /** цена в тиын; предметы набора «Той-Pro» за тиын не продаются */
  price: number;
  pro?: boolean;
}

/**
 * Все предметы — КОСМЕТИКА: физика, размеры, очки, звёзды и ссылки-вызовы не зависят
 * от выбранного оформления (см. render/looks.ts и тест render-isolation).
 */
export const ITEMS: ShopItem[] = [
  { id: 'saka_bronze', cat: 'saka', price: 0 },
  { id: 'saka_silver', cat: 'saka', price: 100 },
  { id: 'saka_gold', cat: 'saka', price: 200 },
  { id: 'saka_oyu', cat: 'saka', price: 250 },
  { id: 'saka_eagle', cat: 'saka', price: 300 },
  { id: 'saka_snowleopard', cat: 'saka', price: 350 },
  { id: 'saka_tulpar', cat: 'saka', price: 400 },
  { id: 'saka_lava', cat: 'saka', price: 450 },
  { id: 'saka_jade', cat: 'saka', price: 0, pro: true },
  { id: 'saka_onyx', cat: 'saka', price: 0, pro: true },
  { id: 'theme_yard', cat: 'theme', price: 0 },
  { id: 'theme_steppe', cat: 'theme', price: 150 },
  { id: 'theme_toy', cat: 'theme', price: 200 },
  { id: 'theme_night', cat: 'theme', price: 0, pro: true },
  { id: 'asyk_bone', cat: 'asyk', price: 0 },
  { id: 'asyk_red', cat: 'asyk', price: 120 },
  { id: 'asyk_wood', cat: 'asyk', price: 150 },
];

/** Что входит в тестовый набор «Той-Pro» (кроме 5 дополнительных уровней). */
export const PRO_BUNDLE = ['saka_jade', 'saka_onyx', 'theme_night'];

export function itemById(id: string): ShopItem | undefined {
  return ITEMS.find((i) => i.id === id);
}

export function isOwned(save: SaveV2, id: string): boolean {
  const it = itemById(id);
  if (!it) return false;
  if (it.pro) return save.pro;
  return it.price === 0 || save.owned.includes(id);
}

export type BuyResult = 'ok' | 'owned' | 'poor' | 'proOnly' | 'unknown';

/** Покупка за внутриигровую валюту. Pro-предметы за тиын не продаются. */
export function buyItem(save: SaveV2, id: string): BuyResult {
  const it = itemById(id);
  if (!it) return 'unknown';
  if (it.pro) return save.pro ? 'owned' : 'proOnly';
  if (isOwned(save, id)) return 'owned';
  if (save.coins < it.price) return 'poor';
  save.coins -= it.price;
  save.owned.push(id);
  return 'ok';
}

/** Надеть купленный предмет. */
export function equipItem(save: SaveV2, id: string): boolean {
  const it = itemById(id);
  if (!it || !isOwned(save, id)) return false;
  save.equipped[it.cat] = id;
  return true;
}

/**
 * ТЕСТОВАЯ покупка «Той-Pro»: деньги не списываются (реальных платежей нет).
 * Реально открывает набор: 5 дополнительных уровней, 2 сақа и площадку.
 */
export function activatePro(save: SaveV2): boolean {
  if (save.pro) return false;
  save.pro = true;
  for (const id of PRO_BUNDLE) if (!save.owned.includes(id)) save.owned.push(id);
  return true;
}
