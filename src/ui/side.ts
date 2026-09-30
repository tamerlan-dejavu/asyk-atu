import type { HudData } from '../bus';
import { FEATURES } from '../config/features';
import { dateKey } from '../game/levels/daily';
import { ACHIEVEMENTS } from '../game/rules/achievements';
import { dailyKey as rsDailyKey, levelKey } from '../game/rules/ruleset';
import type { GameState } from '../game/rules/turnState';
import { t, type Key } from '../i18n';
import { isOwned, ITEMS } from '../shop/catalog';
import { store } from '../storage/save';
import { coinIcon, heartIcon, levelName, modeLabel, playerName, stars, u } from './common';

/**
 * Боковые панели десктопа (DOM поверх страницы, не внутри canvas). На телефоне не показываются —
 * там та же информация в HUD над полем. Левая — игра (игроки, счёт, раунд, выбитые асыки, пауза),
 * правая — управление, рекорд, тиын, достижения и быстрые настройки.
 */
export interface SideCtx {
  hud: HudData | null;
  gstate: GameState;
}

/** Асык в «инвентаре»: выбитый — светлый, оставшийся в коне — контур. */
function asykIcon(won: boolean): string {
  return `<svg class="ico asyk${won ? '' : ' used'}" viewBox="0 0 30 18" aria-hidden="true"><path d="M3 9 C3 3 9 2 12 5 C14 3 16 3 18 5 C21 2 27 3 27 9 C27 15 21 16 18 13 C16 15 14 15 12 13 C9 16 3 15 3 9 Z" fill="${won ? '#f6ecd0' : 'none'}" stroke="${won ? '#4b3018' : '#f6ecd0'}" stroke-width="1.8"/></svg>`;
}

const kbd = (k: string) => `<kbd>${k}</kbd>`;

function roundLine(h: HudData): string {
  if (h.mode === 'endless') return t('waveLabel', { n: h.wave ?? 1 });
  if (h.mode === 'versus' || h.mode === 'duel') {
    const done = 6 - Math.min(h.versusLeft[0], h.versusLeft[1]);
    return t('sideRoundN', { n: Math.min(6, done + 1), m: 6 });
  }
  if (!Number.isFinite(h.throwsTotal)) return t('unlimited');
  return t('sideThrowN', { n: Math.min(h.throwsTotal, h.throwsTotal - h.throwsLeft + 1), m: h.throwsTotal });
}

function titleOf(h: HudData): string {
  if (h.mode === 'daily') return t('dailyTitle');
  if (h.mode === 'endless') return t('endless');
  if (h.mode === 'custom') return h.name ? u(h.name) : t('custom');
  if (h.mode === 'versus') return t('versusTitle');
  if (h.mode === 'duel') return t('duel');
  if (h.mode === 'training') return `${t('training')} · ${levelName(h.levelId)}`;
  return h.levelId === 0 ? levelName(0) : `${t('levelTitle', { n: h.levelId })} · ${levelName(h.levelId)}`;
}

export function leftPanel(c: SideCtx): string {
  const h = c.hud;
  if (!h || c.gstate === 'MENU') return '';
  const two = h.mode === 'versus' || h.mode === 'duel';
  const player = (i: 0 | 1) => {
    const left = two ? h.versusLeft[i] : h.throwsLeft;
    const total = two ? 6 : h.throwsTotal;
    let ic = '';
    if (Number.isFinite(total) && total <= 16) for (let k = 0; k < total; k++) ic += heartIcon(k < left);
    else if (Number.isFinite(total)) ic = `<span class="small">${left} / ${total}</span>`;
    else ic = `<span class="inf">${t('unlimited')}</span>`;
    const active = two && h.player === i;
    return `<div class="splayer p${i + 1}${active ? ' active' : ''}">
      <span class="pn">${u(playerName(i, h.mode, h.botLevel))}${active ? `<small>${t('sideTurn')}</small>` : ''}</span>
      <b class="ps" aria-label="${t('score')}">${two ? h.scores[i] : h.score}</b>
      <span class="icons" aria-label="${t('throwsLeft')}">${ic}</span>
    </div>`;
  };
  const knocked = h.asykTotal - h.asyksLeft;
  let inv = '';
  for (let k = 0; k < h.asykTotal; k++) inv += asykIcon(k < knocked);
  return `<section class="spanel">
    <header class="shead">
      <button class="btn icon-btn" data-act="pause" aria-label="${t('pause')} (Esc)">❚❚</button>
      <div class="stitle"><small>${modeLabel(h.mode)}</small><b>${titleOf(h)}</b></div>
    </header>
    <p class="sround">${roundLine(h)}</p>
    <div class="splayers">${player(0)}${two ? player(1) : ''}</div>
    <div class="sblock">
      <h3>${t('sideKnocked')} <span class="snum">${knocked} / ${h.asykTotal}</span></h3>
      <div class="inv">${inv}</div>
    </div>
  </section>`;
}

function bestOf(h: HudData): string {
  const s = store.data;
  if (h.mode === 'campaign' || h.mode === 'training') {
    const st = s.levels[levelKey(h.levelId, h.ruleset)];
    return st ? `${st.best} ${stars(st.stars)}` : '';
  }
  if (h.mode === 'daily') {
    const b = s.daily[rsDailyKey(dateKey(), h.ruleset)]?.best;
    return b !== undefined ? String(b) : '';
  }
  if (h.mode === 'endless') {
    const eb = h.ruleset === 'loft' ? s.endlessBestLoft : s.endlessBest;
    return eb.score > 0 ? t('endlessBest', { score: eb.score, wave: eb.wave }) : '';
  }
  return '';
}

export const fullscreenSupported = (): boolean =>
  typeof document !== 'undefined' &&
  document.fullscreenEnabled === true &&
  typeof document.documentElement.requestFullscreen === 'function';

export function toggleFullscreen(): void {
  if (!fullscreenSupported()) return;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

export function rightPanel(c: SideCtx): string {
  const h = c.hud;
  if (!h || c.gstate === 'MENU') return '';
  const s = store.data;
  const loft = h.ruleset === 'loft';
  const row = (keys: string, label: string) => `<li><span class="keys">${keys}</span><span>${label}</span></li>`;
  const controls = [
    `<li class="wide">${t('keyDrag')}</li>`,
    row(`${kbd(t('keyRightClick'))} ${kbd('Esc')}`, t('keyCancel')),
    row(kbd('Space'), t('keySpace')),
    row(`${kbd('←')} ${kbd('→')}`, t('keyAngle')),
    row(`${kbd('↑')} ${kbd('↓')}`, t('keyPower')),
    loft ? row(`${kbd('1')} ${kbd('2')} ${kbd('3')}`, t('loftHeight')) : '',
    row(kbd('Esc'), t('pause')),
    row(kbd('M'), t('sound')),
    fullscreenSupported() ? row(kbd('F'), t('fullscreen')) : '',
    row(kbd('R'), t('restart')),
  ].join('');
  const best = bestOf(h);
  const bestBlock =
    h.mode === 'versus' || h.mode === 'duel'
      ? ''
      : `<div class="sblock"><h3>${t('sideBest')}</h3><p class="sbest">${best || `<span class="small">${t('sideNoBest')}</span>`}</p></div>`;
  const got = ACHIEVEMENTS.filter((a) => (s.achievements[a.id] ?? 0) > 0);
  const extras = [
    FEATURES.shop ? `<span class="coinbadge" aria-label="${t('coins')}">${coinIcon()} ${s.coins}</span>` : '',
    FEATURES.achievements
      ? `<span class="achbadge" title="${t('achievements')}">${t('achievements')}: <b>${got.length} / ${ACHIEVEMENTS.length}</b> <span aria-hidden="true">${got
          .slice(-4)
          .map((a) => a.icon)
          .join('')}</span></span>`
      : '',
  ].join('');
  const chip = (act: string, arg: string, label: string, on: boolean) =>
    `<button class="chip${on ? ' on' : ''}" data-act="${act}" data-arg="${arg}" aria-pressed="${on}">${label}</button>`;
  const q = s.quality;
  const themes = ITEMS.filter((i) => i.cat === 'theme' && isOwned(s, i.id));
  const fs = !!document.fullscreenElement;
  return `<section class="spanel">
    <div class="sblock">
      <h3>${t('sideControls')}</h3>
      <ul class="skeys">${controls}</ul>
    </div>
    ${bestBlock}
    ${extras ? `<div class="sextras">${extras}</div>` : ''}
    <div class="sblock sset">
      <div class="srow">
        <button class="btn sec sm" data-act="sound" aria-pressed="${s.sound}">${s.sound ? '🔊' : '🔇'} ${t('sound')}</button>
        ${fullscreenSupported() ? `<button class="btn sec sm" data-act="fullscreen" aria-pressed="${fs}">⛶ ${t(fs ? 'fullscreenExit' : 'fullscreen')}</button>` : ''}
      </div>
      <h3>${t('quality')}</h3>
      <div class="chips">${chip('quality', 'auto', t('qualityAuto'), q === 'auto')}${chip('quality', 'high', t('qualityHigh'), q === 'high')}${chip('quality', 'low', t('qualityLow'), q === 'low')}</div>
      <h3>${t('view')}</h3>
      <div class="chips">${chip('viewSet', '2d', t('view2d'), s.view !== '3d')}${chip('viewSet', '3d', t('view3d'), s.view === '3d')}</div>
      ${
        themes.length > 1
          ? `<h3>${t('sideTheme')}</h3><div class="chips">${themes.map((i) => chip('equip', i.id, t(`item_${i.id}` as Key), s.equipped.theme === i.id)).join('')}</div>`
          : ''
      }
    </div>
  </section>`;
}
