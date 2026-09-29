import { t, type Key } from '../i18n';
import { store } from '../storage/save';
import type { BotLevel, GameMode } from '../types';

export const $ = (id: string): HTMLElement => document.getElementById(id)!;

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const HORN = `<svg class="horn" viewBox="0 0 40 30" aria-hidden="true"><path d="M2 15 C12 14 20 8 15 3 C11 0 7 6 11 8 M2 15 C10 20 18 22 19 28 C19 32 12 32 12 27" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
export const ornament = (): string => `<div class="orn" aria-hidden="true"></div>`;

export function sakaIcon(filled: boolean): string {
  return `<svg class="ico${filled ? '' : ' used'}" viewBox="0 0 30 18" aria-hidden="true"><polygon points="1,9 8,1 22,1 29,9 22,17 8,17" fill="${filled ? '#aab4bf' : 'none'}" stroke="${filled ? '#11171c' : '#f6ecd0'}" stroke-width="2"/>${filled ? '<line x1="8" y1="9" x2="22" y2="9" stroke="#16a5a3" stroke-width="2.4"/>' : ''}</svg>`;
}

export function stars(n: number, big = false): string {
  let out = `<span class="stars${big ? ' big' : ''}" role="img" aria-label="${n} / 3">`;
  for (let i = 0; i < 3; i++) out += `<span class="star${i < n ? ' on' : ''}" style="--i:${i}">★</span>`;
  return out + '</span>';
}

/** Название испытания: свои — из данных пользователя (экранируется), остальные — из словарей. */
export function levelName(id: number, custom?: string): string {
  if (custom) return custom;
  if (id === 300) return t('custom');
  if (id === 200) return t('daily');
  if (id >= 0 && id <= 15) return t(`level${id}` as Key);
  return t('custom');
}

export const botLabel = (lvl: BotLevel | undefined): string =>
  lvl === 'easy' ? t('botEasy') : lvl === 'hard' ? t('botHard') : t('botNormal');

export function playerName(i: 0 | 1, mode?: GameMode, bot?: BotLevel): string {
  if (mode === 'duel' && i === 1) return `${t('botName')} · ${botLabel(bot)}`;
  const n = store.data.playerNames[i].trim();
  return n || t(i === 0 ? 'player1' : 'player2');
}

export function modeLabel(m: GameMode): string {
  const map: Record<GameMode, Key> = {
    campaign: 'modeCampaign',
    training: 'modeTraining',
    versus: 'modeVersus',
    daily: 'modeDaily',
    endless: 'modeEndless',
    duel: 'modeDuel',
    custom: 'modeCustom',
  };
  return t(map[m]);
}

/** Короткое всплывающее сообщение (не блокирует ввод). */
let toastTimer = 0;
export function toast(text: string, ms = 2200): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}
