import { t, type Key } from '../i18n';
import { store } from '../storage/save';
import type { BotLevel, GameMode } from '../types';
import { uiIcon } from '../game/render/art';

export const $ = (id: string): HTMLElement => document.getElementById(id)!;

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const HORN = `<svg class="horn" viewBox="0 0 40 30" aria-hidden="true"><path d="M2 15 C12 14 20 8 15 3 C11 0 7 6 11 8 M2 15 C10 20 18 22 19 28 C19 32 12 32 12 27" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
export const ornament = (): string => `<div class="orn" aria-hidden="true"></div>`;

/** Иконка из пака (public/assets/ui). Без подписи — декоративная (скрыта от экранного диктора). */
export function icon(name: string, cls = 'uic', label = ''): string {
  return `<img class="${cls}" src="${uiIcon(name)}" alt="${label}"${label ? '' : ' aria-hidden="true"'} draggable="false" decoding="async"/>`;
}
export const coinIcon = (): string => icon('ui_coin');

/** Попытка (бросок): полное сердце — осталась, тусклое — использована (отличаются и формой прозрачности, и цветом). */
export function heartIcon(filled: boolean): string {
  return icon('ui_heart', `ico heart${filled ? '' : ' used'}`);
}

export function stars(n: number, big = false): string {
  let out = `<span class="stars${big ? ' big' : ''}" role="img" aria-label="${n} / 3">`;
  for (let i = 0; i < 3; i++)
    out += `<img class="sti${i < n ? ' on' : ''}" style="--i:${i}" src="${uiIcon(i < n ? 'ui_star_full' : 'ui_star_empty')}" alt="" aria-hidden="true" draggable="false"/>`;
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

// ------------------------------------------------------------------ пользовательский текст — только через textContent
const userTexts = new Map<number, string>();
let uSeq = 0;
/** Место для строки пользователя (имя, название): вставляется в DOM через textContent, без разметки. */
export function u(s: string): string {
  if (userTexts.size > 400) userTexts.clear();
  const id = ++uSeq;
  userTexts.set(id, s);
  return `<bdi data-u="${id}"></bdi>`;
}
export function fillUser(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-u]').forEach((el) => {
    const id = Number(el.dataset.u);
    el.textContent = userTexts.get(id) ?? '';
    userTexts.delete(id);
    el.removeAttribute('data-u');
  });
}
export function setHtml(el: HTMLElement, html: string): void {
  el.innerHTML = html;
  fillUser(el);
}
