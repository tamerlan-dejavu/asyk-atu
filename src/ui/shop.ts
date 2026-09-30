import { ASYK_SETS, SAKA_SKINS, THEMES } from '../game/render/looks';
import { ASYK_ART, artUrl, SAKA_ART } from '../game/render/art';
import { t, type Key } from '../i18n';
import { isOwned, ITEMS, type ShopCat, type ShopItem } from '../shop/catalog';
import { store } from '../storage/save';
import { coinIcon, ornament } from './common';

export type ShopOverlay = 'none' | 'confirm' | 'got';

const HEX = (w: number, h: number, cx: number, cy: number): string => {
  const cut = w * 0.25;
  const pts: [number, number][] = [
    [cx - w / 2, cy],
    [cx - w / 2 + cut, cy - h / 2],
    [cx + w / 2 - cut, cy - h / 2],
    [cx + w / 2, cy],
    [cx + w / 2 - cut, cy + h / 2],
    [cx - w / 2 + cut, cy + h / 2],
  ];
  return pts.map((p) => p.join(',')).join(' ');
};

function preview(it: ShopItem): string {
  const id = `g_${it.id}`;
  // сақа и асыки — рисованные ассеты (как в игре); площадки — схема карты
  if (it.cat === 'saka' && SAKA_ART[it.id])
    return `<img class="pv art" src="${artUrl('saka', `${SAKA_ART[it.id]}`)}" alt="" loading="lazy" decoding="async"/>`;
  if (it.cat === 'asyk' && ASYK_ART[it.id])
    return `<img class="pv art" src="${artUrl('asyk', `${ASYK_ART[it.id]}_1`)}" alt="" loading="lazy" decoding="async"/>`;
  if (it.cat === 'saka') {
    const p = SAKA_SKINS[it.id];
    return `<svg viewBox="0 0 80 50" class="pv" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.c[0]}"/><stop offset=".4" stop-color="${p.c[1]}"/><stop offset=".75" stop-color="${p.c[2]}"/><stop offset="1" stop-color="${p.c[3]}"/></linearGradient></defs><polygon points="${HEX(60, 32, 40, 25)}" fill="url(#${id})" stroke="${p.outline}" stroke-width="2.4"/><line x1="18" y1="25" x2="62" y2="25" stroke="${p.inlay}" stroke-width="3"/>${p.ornament ? '<path d="M24 14 l4 4 -4 4 -4 -4z M40 14 l4 4 -4 4 -4 -4z M56 14 l4 4 -4 4 -4 -4z" fill="rgba(246,236,208,.4)"/>' : ''}</svg>`;
  }
  if (it.cat === 'asyk') {
    const p = ASYK_SETS[it.id];
    return `<svg viewBox="0 0 80 50" class="pv" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.light}"/><stop offset=".5" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.dark}"/></linearGradient></defs><polygon points="${HEX(56, 30, 40, 25)}" fill="url(#${id})" stroke="${p.outline}" stroke-width="2.4"/></svg>`;
  }
  const th = THEMES[it.id];
  return `<svg viewBox="0 0 80 50" class="pv" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${th.ground[0]}"/><stop offset="1" stop-color="${th.ground[1]}"/></linearGradient><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${th.sky[0]}"/><stop offset="1" stop-color="${th.sky[2]}"/></linearGradient></defs><rect width="80" height="50" rx="6" fill="url(#${id})"/><rect width="80" height="17" rx="6" fill="url(#${id}s)"/><rect x="0" y="12" width="80" height="5" fill="${th.hill[1]}"/><rect x="1.5" y="1.5" width="77" height="47" rx="5" fill="none" stroke="${th.frame}" stroke-width="3"/><circle cx="40" cy="33" r="9" fill="none" stroke="#0e7f7d" stroke-width="2"/></svg>`;
}

function card(it: ShopItem): string {
  const s = store.data;
  const owned = isOwned(s, it.id);
  const eq = s.equipped[it.cat] === it.id;
  let action: string;
  if (eq) action = `<span class="pill on">${t('equipped')}</span>`;
  else if (owned) action = `<button class="btn sm" data-act="equip" data-arg="${it.id}">${t('equip')}</button>`;
  else if (it.pro) action = `<span class="pill">${t('proOnly')}</span>`;
  else
    action = `<button class="btn sm primary" data-act="buyItem" data-arg="${it.id}" ${s.coins < it.price ? 'aria-disabled="true"' : ''}>${t('buy')} · ${it.price}</button>`;
  // редкость: цвет + форма-ромб + подпись (не только цвет)
  const rar = it.pro || it.price >= 350 ? 3 : it.price >= 150 ? 2 : 1;
  const rarKey: Key = rar === 3 ? 'rarityEpic' : rar === 2 ? 'rarityRare' : 'rarityCommon';
  return `<div class="scard${eq ? ' eq' : ''}">${preview(it)}<b>${t(('item_' + it.id) as Key)}</b><span class="rarity r${rar}">${t(rarKey)}</span>${action}</div>`;
}

function section(cat: ShopCat, title: Key): string {
  return `<h3>${t(title)}</h3><div class="sgrid">${ITEMS.filter((i) => i.cat === cat)
    .map(card)
    .join('')}</div>`;
}

export function shopScreen(overlay: ShopOverlay): string {
  const s = store.data;
  const pro = s.pro
    ? `<div class="pro owned"><h3>${t('proTitle')} ✓</h3><p>${t('proOwned')}</p></div>`
    : `<div class="pro"><h3>${t('proTitle')}</h3><p>${t('proDesc')}</p><button class="btn primary" data-act="proAsk">${t('buyTest')}</button><small>${t('proNote')}</small></div>`;
  const dialog =
    overlay === 'confirm'
      ? `<div class="modal"><div class="panel pop"><div class="testbanner" role="alert">${t('testMode')}</div><h2>${t('proTitle')}</h2><p>${t('proConfirm')}</p><div class="row2"><button class="btn primary" data-act="proYes">${t('yes')}</button><button class="btn sec" data-act="proNo">${t('no')}</button></div></div></div>`
      : overlay === 'got'
        ? `<div class="modal"><div class="panel pop result"><h2>${t('proGot')}</h2>${ornament()}<p>${t('proGotList')}</p><div class="testbanner">${t('testMode')}</div><button class="btn primary" data-act="proOk">${t('ok')}</button></div></div>`
        : '';
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="modes">← ${t('back')}</button><h2>${t('shopTitle')}</h2><span class="coinbadge" aria-label="${t('coins')}">${coinIcon()} ${s.coins}</span></header>
    ${ornament()}
    <div class="panel scroll">
      <p class="small">${t('earnHint')}</p>
      ${pro}
      ${section('saka', 'catSaka')}
      ${section('theme', 'catTheme')}
      ${section('asyk', 'catAsyk')}
    </div>
    ${dialog}
  </section>`;
}
