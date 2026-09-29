import { bus, type HudData, type ResultData, type StartRequest } from '../bus';
import { sfx } from '../audio/sfx';
import { challengeToLevel, decodeChallenge } from '../challenge/codec';
import { parseHash, type LinkKind } from '../challenge/link';
import { FEATURES } from '../config/features';
import { dateKey } from '../game/levels/daily';
import { LEVELS } from '../game/levels/levels';
import { PRO_LEVELS } from '../game/levels/levels-pro';
import { processEvent } from '../game/rules/achievements';
import type { GameState } from '../game/rules/turnState';
import { getLang, onLang, setLang, t, type Key } from '../i18n';
import { activatePro, buyItem, equipItem, itemById } from '../shop/catalog';
import { CUSTOM_LIMIT, store } from '../storage/save';
import type { BotLevel, CustomLevel, Difficulty, Lang, Quality } from '../types';
import { $, botLabel, HORN, levelName, modeLabel, ornament, playerName, sakaIcon, stars, toast } from './common';
import * as ed from './editor';
import { recordsScreen, type RecordsTab } from './records';
import { makeLink, senderName, shareCard, shareLink } from './share';
import { shopScreen, type ShopOverlay } from './shop';

type Screen =
  | 'menu'
  | 'levels'
  | 'modes'
  | 'rules'
  | 'records'
  | 'settings'
  | 'versus'
  | 'duel'
  | 'daily'
  | 'endless'
  | 'editor'
  | 'mine'
  | 'shop'
  | 'challenge';

let screen: Screen = 'menu';
let gstate: GameState = 'MENU';
let hud: HudData | null = null;
let tutStep = -1;
let result: ResultData | null = null;
let training = false;
let confirmReset = false;
let confirmQuit = false;
let confirmDeleteId: string | null = null;
let recordsTab: RecordsTab = 'levels';
let shopOverlay: ShopOverlay = 'none';
let bannerTimer = 0;
let pendingLink: LinkKind | null = null;
let lastStart: StartRequest | null = null;
let hintType: 'golden' | 'heavy' | 'block' | null = null;
const achQueue: string[] = [];
let achShowing = false;

// ------------------------------------------------------------------ пользовательский текст — только через textContent
const userTexts = new Map<number, string>();
let uSeq = 0;
/** Место для строки пользователя (имя, название): вставляется в DOM через textContent, без разметки. */
function u(s: string): string {
  if (userTexts.size > 400) userTexts.clear();
  const id = ++uSeq;
  userTexts.set(id, s);
  return `<bdi data-u="${id}"></bdi>`;
}
function fillUser(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-u]').forEach((el) => {
    const id = Number(el.dataset.u);
    el.textContent = userTexts.get(id) ?? '';
    userTexts.delete(id);
    el.removeAttribute('data-u');
  });
}
function setHtml(el: HTMLElement, html: string): void {
  el.innerHTML = html;
  fillUser(el);
}

const lvName = (id: number, custom?: string): string => (custom ? u(custom) : levelName(id));

// ------------------------------------------------------------------ экраны
function menuScreen(): string {
  const lang = getLang();
  const langBtn = (l: Lang, label: string) =>
    `<button class="chip${lang === l ? ' on' : ''}" data-act="lang" data-arg="${l}" aria-pressed="${lang === l}">${label}</button>`;
  const rs = FEATURES.resume ? store.data.resume : null;
  const cont = rs
    ? `<button class="btn primary big cont" data-act="continue">${t('continue')}<small>${t('continueInfo', {
        name: rs.mode === 'endless' ? t('waveLabel', { n: rs.extra.wave ?? 1 }) : rs.mode === 'campaign' ? levelName(rs.levelId) : modeLabel(rs.mode),
        score: (rs.extra.totalScore ?? 0) + rs.round.scores[0] + (rs.mode === 'versus' || rs.mode === 'duel' ? rs.round.scores[1] : 0),
      })}</small></button>`
    : '';
  return `
  <section class="screen menu">
    <div class="title-wrap">
      <div class="horns">${HORN}<span class="sp"></span>${HORN}</div>
      <h1>${t('title')}</h1>
      <p class="tag">${t('tagline')}</p>
    </div>
    <div class="stack">
      ${cont}
      <button class="btn ${rs ? '' : 'primary big'}" data-act="play">${t('play')}</button>
      <button class="btn" data-act="goto" data-arg="modes">${t('modes')}</button>
      <div class="row2">
        <button class="btn sec" data-act="goto" data-arg="rules">${t('howTo')}</button>
        <button class="btn sec" data-act="goto" data-arg="records">${t('records')}</button>
      </div>
      <button class="btn sec" data-act="goto" data-arg="settings">${t('settings')}</button>
    </div>
    <div class="menu-foot">
      <div class="chips" role="group" aria-label="${t('language')}">${langBtn('ru', 'RU')}${langBtn('kk', 'ҚАЗ')}${langBtn('en', 'EN')}</div>
      <div class="chips">
        ${FEATURES.shop ? `<span class="coinbadge" aria-label="${t('coins')}">🪙 ${store.data.coins}</span>` : ''}
        <button class="chip icon${store.data.sound ? ' on' : ''}" data-act="sound" aria-pressed="${store.data.sound}" aria-label="${t('sound')}">${store.data.sound ? '🔊' : '🔇'}</button>
      </div>
    </div>
  </section>`;
}

function modesScreen(): string {
  const card = (act: string, arg: string, icon: string, title: Key, desc: Key, extra = '') =>
    `<button class="mcard" data-act="${act}" data-arg="${arg}"><span class="micon" aria-hidden="true">${icon}</span><span class="mtxt"><b>${t(title)}</b><small>${t(desc)}${extra}</small></span></button>`;
  const eb = store.data.endlessBest;
  const db = store.data.daily[dateKey()]?.best;
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('modesTitle')}</h2></header>
    ${ornament()}
    <div class="mgrid scroll">
      ${card('goto', 'versus', '👥', 'versus', 'modeVersusDesc')}
      ${FEATURES.bot ? card('goto', 'duel', '🤖', 'duel', 'modeDuelDesc') : ''}
      ${FEATURES.endless ? card('goto', 'endless', '♾', 'endless', 'modeEndlessDesc', eb.score > 0 ? ` · ${t('endlessBest', { score: eb.score, wave: eb.wave })}` : '') : ''}
      ${card('goto', 'daily', '📅', 'daily', 'modeDailyDesc', db !== undefined ? ` · ${t('best')}: ${db}` : '')}
      ${FEATURES.editor ? card('editorNew', '', '✏', 'editor', 'modeEditorDesc') : ''}
      ${FEATURES.editor ? card('goto', 'mine', '📂', 'myLevels', 'modeMineDesc', ` · ${store.data.customLevels.length}/${CUSTOM_LIMIT}`) : ''}
      ${FEATURES.shop ? card('goto', 'shop', '🪙', 'shop', 'modeShopDesc', ` · ${store.data.coins}`) : ''}
    </div>
  </section>`;
}

function levelCard(l: { id: number; throws: number; par: number | null }, open: boolean): string {
  const st = store.data.levels[String(l.id)];
  const meta = l.id === 0 ? '' : `<span>${t('throwsN', { n: l.throws })}</span><span>${t('parN', { n: l.par ?? 0 })}</span>`;
  return `
    <button class="card${open ? '' : ' locked'}" data-act="level" data-arg="${l.id}" ${open ? '' : 'disabled'} aria-label="${t('levelN', { n: l.id })}: ${levelName(l.id)}${open ? '' : ' — ' + t('locked')}">
      <span class="num">${l.id === 0 ? '★' : l.id}</span>
      <span class="cname">${levelName(l.id)}</span>
      ${open ? stars(st?.stars ?? 0) : `<span class="lock" aria-hidden="true">🔒</span>`}
      <span class="cmeta">${open ? meta : t('locked')}</span>
      <span class="cbest">${open && st ? `${t('best')}: ${st.best}` : ''}</span>
    </button>`;
}

function levelsScreen(): string {
  const s = store.data;
  const open = (id: number) => id <= s.unlocked;
  const ch = (key: Key, list: typeof LEVELS) => `<h3 class="chapter">${t(key)}</h3><div class="grid">${list.map((l) => levelCard(l, open(l.id))).join('')}</div>`;
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('chooseLevel')}</h2></header>
    ${ornament()}
    <label class="toggle"><input type="checkbox" data-act="training" ${training ? 'checked' : ''}/> <span><b>${t('training')}</b><small>${t('trainingHint')}</small></span></label>
    <div class="scroll levels-scroll">
      ${ch('chapter1', LEVELS.filter((l) => l.id <= 5))}
      ${ch('chapter2', LEVELS.filter((l) => l.id >= 6))}
      ${s.pro ? ch('chapter3', PRO_LEVELS) : ''}
    </div>
  </section>`;
}

function versusScreen(): string {
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="modes">← ${t('back')}</button><h2>${t('versusTitle')}</h2></header>
    ${ornament()}
    <div class="panel">
      <p>${t('versusHint')}</p>
      <label class="field p1"><span>${t('versusNames')} — 1</span><input data-name="0" maxlength="16" placeholder="${t('player1')}" autocomplete="off"/></label>
      <label class="field p2"><span>${t('versusNames')} — 2</span><input data-name="1" maxlength="16" placeholder="${t('player2')}" autocomplete="off"/></label>
      <button class="btn primary big" data-act="startVersus">${t('startGame')}</button>
    </div>
  </section>`;
}

function duelScreen(): string {
  const b = (lvl: BotLevel, key: Key) => `<button class="btn ${lvl === 'hard' ? 'primary' : ''}" data-act="startDuel" data-arg="${lvl}">🤖 ${t(key)}</button>`;
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="modes">← ${t('back')}</button><h2>${t('duel')}</h2></header>
    ${ornament()}
    <div class="panel">
      <p>${t('modeDuelDesc')}. ${t('versusHint')}</p>
      <h3>${t('chooseBot')}</h3>
      <div class="stack tight">${b('easy', 'botEasy')}${b('normal', 'botNormal')}${b('hard', 'botHard')}</div>
    </div>
  </section>`;
}

function dailyScreen(): string {
  const best = store.data.daily[dateKey()]?.best;
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="modes">← ${t('back')}</button><h2>${t('dailyTitle')}</h2></header>
    ${ornament()}
    <div class="panel">
      <p class="date">${dateKey()}</p>
      <p>${t('dailyHint')}</p>
      <p><b>${best !== undefined ? t('dailyBest', { n: best }) : t('dailyNone')}</b></p>
      <p class="small">${t('statStreak')}: ${store.data.dailyStreak.count}</p>
      <button class="btn primary big" data-act="startDaily">${t('play')}</button>
      ${best !== undefined ? `<button class="btn" data-act="shareDaily">${t('challengeFriend')}</button>` : ''}
    </div>
  </section>`;
}

function endlessScreen(): string {
  const eb = store.data.endlessBest;
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="modes">← ${t('back')}</button><h2>${t('endless')}</h2></header>
    ${ornament()}
    <div class="panel">
      <p>${t('modeEndlessDesc')}</p>
      <p><b>${eb.score > 0 ? t('endlessBest', { score: eb.score, wave: eb.wave }) : t('emptyList')}</b></p>
      <p class="small">${t('rulesValues')}</p>
      <button class="btn primary big" data-act="startEndless">${t('newRun')}</button>
    </div>
  </section>`;
}

function mineScreen(): string {
  const list = store.data.customLevels;
  const item = (c: CustomLevel) => {
    const d = decodeChallenge(c.code);
    const n = d.ok ? d.challenge.asyks.filter((a) => a.type !== 'block').length : 0;
    const tn = d.ok ? d.challenge.throws : 0;
    const confirm =
      confirmDeleteId === c.id
        ? `<div class="confirm"><p>${t('confirmDelete')}</p><div class="row2"><button class="btn danger sm" data-act="mineDelYes" data-arg="${c.id}">${t('yes')}</button><button class="btn sec sm" data-act="mineDelNo">${t('no')}</button></div></div>`
        : '';
    return `<li class="mitem"><div class="mhead"><b>${u(c.name || t('namePlaceholder'))}</b><small>${t('minfo', { n, t: tn })} · ${c.verified ? '✓ ' + t('verified') : t('notVerified')}</small></div>
      <div class="mact">
        <button class="btn sm primary" data-act="minePlay" data-arg="${c.id}">${t('play')}</button>
        <button class="btn sm sec" data-act="mineEdit" data-arg="${c.id}">${t('edit')}</button>
        <button class="btn sm sec" data-act="mineShare" data-arg="${c.id}" ${c.verified ? '' : 'aria-disabled="true"'}>${t('share')}</button>
        <button class="btn sm sec" data-act="mineDel" data-arg="${c.id}" aria-label="${t('delete')}">🗑</button>
      </div>${confirm}</li>`;
  };
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="modes">← ${t('back')}</button><h2>${t('myLevels')}</h2></header>
    ${ornament()}
    <div class="panel scroll">
      ${list.length ? `<ul class="mlist">${list.map(item).join('')}</ul>` : `<p class="small">${t('emptyList')}</p>`}
      <button class="btn" data-act="editorNew">+ ${t('editor')}</button>
    </div>
  </section>`;
}

function challengeScreen(): string {
  const l = pendingLink;
  if (!l) return menuScreen();
  const friend = l.name ?? t('friend');
  const line =
    l.score !== undefined ? t('challengeFrom', { name: u(friend), score: l.score }) : t('challengeNoScore', { name: u(friend) });
  let title = '';
  if (l.kind === 'c') {
    const d = decodeChallenge(l.code);
    title = d.ok ? u(d.challenge.name || t('custom')) : '';
  } else if (l.kind === 'd') title = `${t('dailyTitle')} · ${l.date}`;
  else title = t('endless');
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="challengeCancel">← ${t('toMenu')}</button><h2>${t('challengeTitle')}</h2></header>
    ${ornament()}
    <div class="panel result">
      <h2>${title}</h2>
      <p class="total">${line}</p>
      <button class="btn primary big" data-act="challengePlay">${t('play')}</button>
    </div>
  </section>`;
}

const svgField = `<svg viewBox="0 0 120 150" class="illus" role="img" aria-hidden="true"><rect width="120" height="150" rx="8" fill="#c8975a"/><circle cx="60" cy="52" r="38" fill="rgba(122,70,28,.25)" stroke="#0e7f7d" stroke-width="3"/>${[[42, 46], [60, 46], [78, 46], [50, 62], [70, 62]].map(([x, y]) => `<polygon points="${x - 8},${y} ${x - 4},${y - 4} ${x + 4},${y - 4} ${x + 8},${y} ${x + 4},${y + 4} ${x - 4},${y + 4}" fill="#f6ecd0" stroke="#4b3018" stroke-width="1.2"/>`).join('')}<line x1="8" y1="128" x2="112" y2="128" stroke="#16a5a3" stroke-width="2" stroke-dasharray="5 4"/><polygon points="46,126 52,118 68,118 74,126 68,134 52,134" fill="#aab4bf" stroke="#11171c" stroke-width="1.6"/></svg>`;
const svgPull = `<svg viewBox="0 0 120 150" class="illus" role="img" aria-hidden="true"><rect width="120" height="150" rx="8" fill="#c8975a"/><polygon points="46,86 52,78 68,78 74,86 68,94 52,94" fill="#aab4bf" stroke="#11171c" stroke-width="1.6"/><line x1="60" y1="70" x2="60" y2="24" stroke="#e5482f" stroke-width="4" stroke-dasharray="8 6"/><polygon points="60,12 50,28 70,28" fill="#e5482f"/><circle cx="60" cy="126" r="9" fill="#f6ecd0" stroke="#4b3018" stroke-width="2"/><line x1="60" y1="94" x2="60" y2="117" stroke="#f6ecd0" stroke-width="3"/></svg>`;
const svgOut = `<svg viewBox="0 0 120 150" class="illus" role="img" aria-hidden="true"><rect width="120" height="150" rx="8" fill="#c8975a"/><circle cx="60" cy="80" r="42" fill="rgba(122,70,28,.25)" stroke="#0e7f7d" stroke-width="3"/><polygon points="52,78 57,73 67,73 72,78 67,83 57,83" fill="#f6ecd0" stroke="#4b3018" stroke-width="1.4"/><polygon points="88,28 93,23 103,23 108,28 103,33 93,33" fill="#f6ecd0" stroke="#4b3018" stroke-width="1.4" opacity=".6"/><circle cx="98" cy="28" r="2.6" fill="#e5482f"/><path d="M66 74 L92 34" stroke="#e5482f" stroke-width="2.4" stroke-dasharray="4 4" fill="none"/></svg>`;
const svgTypes = `<svg viewBox="0 0 120 150" class="illus" role="img" aria-hidden="true"><rect width="120" height="150" rx="8" fill="#c8975a"/><polygon points="22,40 30,32 48,32 56,40 48,48 30,48" fill="#f0c53a" stroke="#5a3d0a" stroke-width="1.6"/><text x="82" y="46" font-size="18" font-weight="700" fill="#2b1a0e">30</text><polygon points="22,80 30,72 48,72 56,80 48,88 30,88" fill="#7c766c" stroke="#1a1612" stroke-width="1.6"/><rect x="28" y="77" width="22" height="6" fill="#d6d1c8"/><text x="82" y="86" font-size="18" font-weight="700" fill="#2b1a0e">15</text><rect x="25" y="106" width="28" height="28" rx="6" fill="#8a8074" stroke="#231d17" stroke-width="1.6"/><text x="82" y="126" font-size="18" font-weight="700" fill="#2b1a0e">0</text></svg>`;

function rulesScreen(): string {
  const block = (svg: string, h: Key, p: Key) => `<article class="rule">${svg}<div><h3>${t(h)}</h3><p>${t(p)}</p></div></article>`;
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('rulesTitle')}</h2></header>
    ${ornament()}
    <div class="panel scroll">
      ${block(svgField, 'rulesField', 'rulesFieldText')}
      ${block(svgPull, 'rulesTurn', 'rulesTurnText')}
      ${block(svgOut, 'rulesOut', 'rulesOutText')}
      <article class="rule"><div class="illus-text" aria-hidden="true">10<br>25<br>40</div><div><h3>${t('rulesScore')}</h3><p>${t('rulesScoreText')}</p></div></article>
      ${block(svgTypes, 'rulesValuesTitle', 'rulesValues')}
      <article class="rule"><div class="illus-text" aria-hidden="true">★★★</div><div><h3>${t('rulesStars')}</h3><p>${t('rulesStarsText')}</p></div></article>
      <article class="rule"><div class="illus-text" aria-hidden="true">1 ⇄ 2</div><div><h3>${t('rulesVersus')}</h3><p>${t('rulesVersusText')}</p></div></article>
    </div>
  </section>`;
}

function settingsScreen(): string {
  const lang = getLang();
  const s = store.data;
  const q = s.quality;
  const opt = (act: string, arg: string, label: string, on: boolean) =>
    `<button class="chip wide${on ? ' on' : ''}" data-act="${act}" data-arg="${arg}" aria-pressed="${on}">${label}</button>`;
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('settingsTitle')}</h2></header>
    ${ornament()}
    <div class="panel scroll">
      <h3>${t('language')}</h3>
      <div class="chips">${opt('lang', 'ru', 'RU', lang === 'ru')}${opt('lang', 'kk', 'ҚАЗ', lang === 'kk')}${opt('lang', 'en', 'EN', lang === 'en')}</div>
      <h3>${t('difficulty')}</h3>
      <div class="chips">${opt('difficulty', 'normal', t('diffNormal'), s.difficulty === 'normal')}${opt('difficulty', 'easy', t('diffEasy'), s.difficulty === 'easy')}</div>
      <p class="small">${t('diffHint')}</p>
      <h3>${t('sound')}</h3>
      <div class="chips">${opt('soundSet', '1', t('on'), s.sound)}${opt('soundSet', '0', t('off'), !s.sound)}</div>
      ${canVibrate ? `<h3>${t('vibration')}</h3><div class="chips">${opt('vibSet', '1', t('on'), s.vibration)}${opt('vibSet', '0', t('off'), !s.vibration)}</div>` : ''}
      <h3>${t('quality')}</h3>
      <div class="chips">${opt('quality', 'auto', t('qualityAuto'), q === 'auto')}${opt('quality', 'high', t('qualityHigh'), q === 'high')}${opt('quality', 'low', t('qualityLow'), q === 'low')}</div>
      <p class="small">${t('qualityHint')}</p>
      <label class="field"><span>${t('yourName')}</span><input data-name="0" maxlength="16" placeholder="${t('yourNamePh')}" autocomplete="off"/></label>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ HUD
function hudHtml(): string {
  if (!hud || gstate === 'MENU') return '';
  const h = hud;
  if (h.mode === 'versus' || h.mode === 'duel') {
    const chip = (i: 0 | 1) => {
      const active = h.player === i;
      const left = h.versusLeft[i];
      let ic = '';
      for (let k = 0; k < 6; k++) ic += sakaIcon(k < left);
      return `<div class="pchip p${i + 1}${active ? ' active' : ''}"><b class="pn">${u(playerName(i, h.mode, h.botLevel))}</b><span class="ps">${h.scores[i]}</span><span class="icons">${ic}</span></div>`;
    };
    return `<div class="hud versus"><button class="btn icon-btn" data-act="pause" aria-label="${t('pause')}">❚❚</button>${chip(0)}${chip(1)}</div>`;
  }
  let icons = '';
  if (Number.isFinite(h.throwsTotal) && h.throwsTotal <= 16) {
    for (let k = 0; k < h.throwsTotal; k++) icons += sakaIcon(k < h.throwsLeft);
  } else if (Number.isFinite(h.throwsTotal)) {
    icons = `<span class="inf small">${h.throwsLeft} / ${h.throwsTotal}</span>`;
  } else icons = `<span class="inf">${t('unlimited')}</span>`;
  let title: string;
  if (h.mode === 'daily') title = t('dailyTitle');
  else if (h.mode === 'endless') title = `${t('endless')} · ${t('waveLabel', { n: h.wave ?? 1 })}`;
  else if (h.mode === 'custom') title = lvName(300, h.name);
  else if (h.mode === 'training') title = `${t('training')} · ${levelName(h.levelId)}`;
  else title = h.levelId === 0 ? levelName(0) : `${t('levelTitle', { n: h.levelId })} · ${levelName(h.levelId)}`;
  return `<div class="hud"><button class="btn icon-btn" data-act="pause" aria-label="${t('pause')}">❚❚</button>
    <div class="hmid"><div class="hname">${title}</div><div class="icons" aria-label="${t('throwsLeft')}">${icons}</div></div>
    <div class="hscore"><span>${t('score')}</span><b>${h.score}</b></div></div>`;
}

function hintHtml(): string {
  let out = '';
  if (hintType && gstate !== 'MENU') {
    const key: Key = hintType === 'golden' ? 'hintGolden' : hintType === 'heavy' ? 'hintHeavy' : 'hintBlock';
    out += `<button class="typehint t-${hintType}" data-act="closeHint"><b>${t(key)}</b><small>${t('tapToClose')}</small></button>`;
  }
  if (!hud) return out;
  if (gstate === 'AIMING') {
    if (tutStep >= 0) {
      const key = (['tut1', 'tut2', 'tut3', 'tut4'] as const)[Math.min(3, tutStep)];
      return (
        out +
        `<div class="tut"><div class="tut-text" role="status">${t(key)}</div>${tutStep === 0 ? `<div class="ghost" aria-hidden="true"><i></i></div>` : ''}<button class="btn sec sm skip" data-act="skipTut">${t('skipTutorial')}</button></div>`
      );
    }
    if (hud.mode === 'duel' && hud.player === 1) return out + `<div class="hint" role="status">🤖 ${t('botThinking')}</div>`;
    if (hud.showHint) return out + `<div class="hint" role="status">${t('hintPull')}</div>`;
    return out;
  }
  if (tutStep >= 0 && (gstate === 'FLYING' || gstate === 'SETTLING' || gstate === 'RESOLVING')) {
    const key = (['tut1', 'tut2', 'tut3', 'tut4'] as const)[Math.min(3, tutStep)];
    out += `<div class="tut"><div class="tut-text" role="status">${t(key)}</div></div>`;
  }
  return out;
}

// ------------------------------------------------------------------ модалки
function pauseModal(): string {
  if (confirmQuit) {
    return `<div class="modal"><div class="panel pop">
      <h2>${t('toMenu')}?</h2>${ornament()}
      <p>${t('quitConfirm')}</p>
      <div class="row2"><button class="btn danger" data-act="quitYes">${t('yes')}</button><button class="btn sec" data-act="quitNo">${t('no')}</button></div>
    </div></div>`;
  }
  const training = hud?.mode === 'training';
  return `<div class="modal"><div class="panel pop">
    <h2>${t('paused')}</h2>${ornament()}
    <div class="stack">
      <button class="btn primary big" data-act="resume">${t('resume')}</button>
      <button class="btn" data-act="restart">${training ? t('reset') : t('restart')}</button>
      <div class="row2">
        <button class="btn sec" data-act="sound">${store.data.sound ? '🔊' : '🔇'} ${t('sound')}</button>
        <button class="btn sec" data-act="quitAsk">${t('toMenu')}</button>
      </div>
    </div></div></div>`;
}

function coinsLine(r: ResultData): string {
  return r.coins > 0 && FEATURES.shop ? `<p class="coins">🪙 ${t('coinsEarned', { n: r.coins })}</p>` : '';
}

function resultModal(r: ResultData): string {
  const s = r.summary;
  if (s.mode === 'versus' || s.mode === 'duel') {
    const title = s.winner === -1 ? t('draw') : t('winnerIs', { name: u(playerName(s.winner as 0 | 1, s.mode, r.botLevel)) });
    return `<div class="modal"><div class="panel pop result">
      <h2>${title}</h2>${ornament()}
      <p class="small">${t('finalScore')}</p>
      <ul class="stats big">
        <li class="p1${s.winner === 0 ? ' win' : ''}"><span>${u(playerName(0, s.mode, r.botLevel))}</span><b>${s.scores[0]}</b></li>
        <li class="p2${s.winner === 1 ? ' win' : ''}"><span>${u(playerName(1, s.mode, r.botLevel))}</span><b>${s.scores[1]}</b></li>
      </ul>
      ${coinsLine(r)}
      <div class="stack"><button class="btn primary" data-act="restart">${t('retry')}</button><button class="btn sec" data-act="quit">${t('toMenu')}</button></div>
    </div></div>`;
  }

  if (s.mode === 'endless' && r.endless) {
    const e = r.endless;
    return `<div class="modal"><div class="panel pop result lose">
      <h2>${t('waveReached', { n: e.wave })}</h2>${ornament()}
      <p class="total">${t('runScore', { n: e.total })}</p>
      <p class="small">${t('endlessBest', { score: store.data.endlessBest.score, wave: store.data.endlessBest.wave })}</p>
      ${e.newBest ? `<p class="badge">${t('newRecord')}</p>` : ''}
      ${friendCompare(r, e.total)}
      ${coinsLine(r)}
      <div class="stack">
        <button class="btn primary big" data-act="restart">${t('again')}</button>
        <div class="row2"><button class="btn" data-act="shareEndless">${t('challengeFriend')}</button><button class="btn sec" data-act="card">${t('card')}</button></div>
        <button class="btn sec" data-act="quit">${t('toMenu')}</button>
      </div></div></div>`;
  }

  const win = s.cleared;
  const lines = [
    `<li><span>${t('knocked', { a: s.asykOut, b: s.asykTotal })}</span></li>`,
    Number.isFinite(s.throwsAllowed) ? `<li><span>${t('throwsUsed', { a: s.throwsUsed, b: s.throwsAllowed })}</span></li>` : '',
    s.bestCombo >= 2 ? `<li><span>${t('bestCombo', { n: s.bestCombo })}</span></li>` : '',
    s.bonus > 0 ? `<li class="bonus"><span>${t('economy', { n: s.bonus })}</span></li>` : '',
  ].join('');
  const showStars = s.mode === 'campaign' || s.mode === 'custom';
  const best = s.mode === 'daily' && r.dailyBest !== undefined ? `<p class="small">${t('dailyBest', { n: r.dailyBest })}</p>` : '';
  let buttons: string;
  if (r.editorTest) {
    buttons = `<button class="btn primary big" data-act="backToEditor">${t('backToEditor')}</button><button class="btn sec" data-act="restart">${t('retry')}</button>`;
  } else {
    const extra: string[] = [];
    if (s.mode === 'daily') extra.push(`<button class="btn" data-act="shareDaily">${t('challengeFriend')}</button>`);
    if (s.mode === 'custom' && r.challenge?.code) {
      extra.push(`<button class="btn" data-act="counter">${t('counterChallenge')}</button>`);
      if (!store.data.customLevels.some((c) => c.code === r.challenge?.code)) extra.push(`<button class="btn sec" data-act="saveMine">${t('saveToMine')}</button>`);
    }
    extra.push(`<button class="btn sec" data-act="card">${t('card')}</button>`);
    buttons = `
      ${r.hasNext ? `<button class="btn primary big" data-act="next">${t('nextLevel')}</button>` : ''}
      <div class="row2"><button class="btn${r.hasNext ? ' sec' : ' primary'}" data-act="restart">${t('retry')}</button><button class="btn sec" data-act="quit">${t('toMenu')}</button></div>
      <div class="row2">${extra.join('')}</div>`;
  }
  const diffPick =
    s.mode === 'campaign' && r.levelId === 0 && win
      ? `<div class="diffpick"><small>${t('difficulty')}</small><div class="chips">${(['normal', 'easy'] as Difficulty[])
          .map((d) => `<button class="chip wide${store.data.difficulty === d ? ' on' : ''}" data-act="difficulty" data-arg="${d}">${t(d === 'easy' ? 'diffEasy' : 'diffNormal')}</button>`)
          .join('')}</div></div>`
      : '';
  return `<div class="modal"><div class="panel pop result ${win ? 'win' : 'lose'}">
    <h2>${win ? t('victory') : t('defeat')}</h2>${ornament()}
    ${s.mode === 'custom' ? `<p class="small">${lvName(300, r.name)}</p>` : ''}
    ${showStars ? stars(s.stars, true) : ''}
    ${!win ? `<p class="small">${t('defeatHint')}</p>` : ''}
    <ul class="lines">${lines}</ul>
    <p class="total">${t('totalScore', { n: s.score })}</p>
    ${r.newRecord ? `<p class="badge">${t('newRecord')}</p>` : ''}
    ${best}
    ${friendCompare(r, s.score)}
    ${coinsLine(r)}
    ${diffPick}
    <div class="stack">${buttons}</div></div></div>`;
}

function friendCompare(r: ResultData, my: number): string {
  const fs = r.challenge?.friendScore;
  if (fs === undefined) return '';
  const name = r.challenge?.friendName ?? t('friend');
  const key: Key = my > fs ? 'youWon' : my < fs ? 'youLost' : 'youTied';
  return `<div class="compare"><p><b>${t(key, { name: u(name) })}</b></p><ul class="stats"><li><span>${t('compareYou')}</span><b>${my}</b></li><li><span>${u(name)}</span><b>${fs}</b></li></ul></div>`;
}

// ------------------------------------------------------------------ рендер
function bindInputs(el: HTMLElement): void {
  el.querySelectorAll<HTMLInputElement>('input[data-name]').forEach((inp) => {
    inp.value = store.data.playerNames[Number(inp.dataset.name) as 0 | 1];
  });
  const edName = el.querySelector<HTMLInputElement>('#ed-name');
  if (edName) edName.value = ed.draft.name;
}

function renderScreen(): void {
  const inGame = gstate !== 'MENU';
  const el = $('screen');
  if (inGame) {
    el.innerHTML = '';
    el.classList.remove('shown');
    return;
  }
  const map: Record<Screen, () => string> = {
    menu: menuScreen,
    levels: levelsScreen,
    modes: modesScreen,
    rules: rulesScreen,
    records: () => recordsScreen(recordsTab, confirmReset),
    settings: settingsScreen,
    versus: versusScreen,
    duel: duelScreen,
    daily: dailyScreen,
    endless: endlessScreen,
    editor: () => ed.editorScreen(),
    mine: mineScreen,
    shop: () => shopScreen(shopOverlay),
    challenge: challengeScreen,
  };
  const keepScroll = el.querySelector('.scroll')?.scrollTop ?? 0;
  setHtml(el, map[screen]());
  el.classList.add('shown');
  bindInputs(el);
  const sc = el.querySelector('.scroll');
  if (sc) sc.scrollTop = keepScroll;
  if (screen === 'editor') ed.mountEditor(el, () => renderScreen());
}

function renderHud(): void {
  setHtml($('hud'), hudHtml());
  setHtml($('hint'), hintHtml());
}

function renderModal(): void {
  const el = $('modal');
  if (gstate === 'PAUSED') setHtml(el, pauseModal());
  else if (result && (gstate === 'LEVEL_COMPLETE' || gstate === 'LEVEL_FAILED')) setHtml(el, resultModal(result));
  else el.innerHTML = '';
}

function renderAll(): void {
  const rot = document.getElementById('rotate');
  if (rot) rot.textContent = '↻ ' + t('rotate');
  renderScreen();
  renderHud();
  renderModal();
  document.title = t('title');
}

function flash(text: string, ms = 1000): void {
  const el = $('banner');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth; // перезапуск анимации
  el.classList.add('show');
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

function showNextAch(): void {
  if (achShowing || achQueue.length === 0) return;
  const id = achQueue.shift()!;
  achShowing = true;
  const el = $('ach');
  el.textContent = '';
  const b = document.createElement('b');
  b.textContent = `🏅 ${t(('ach_' + id) as Key)}`;
  const s = document.createElement('small');
  s.textContent = t(('achDesc_' + id) as Key);
  el.append(b, s);
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  window.setTimeout(() => {
    el.classList.remove('show');
    achShowing = false;
    window.setTimeout(showNextAch, 250);
  }, 2400);
}

// ------------------------------------------------------------------ действия
function start(req: StartRequest): void {
  result = null;
  confirmQuit = false;
  hintType = null;
  lastStart = req;
  bus.emit('start', req);
}

function startCampaign(levelId: number): void {
  start({ mode: training ? 'training' : 'campaign', levelId });
}

function gotoScreen(s: Screen): void {
  screen = s;
  confirmReset = false;
  confirmDeleteId = null;
  shopOverlay = 'none';
  renderAll();
}

function findMine(id: string | undefined): CustomLevel | undefined {
  return store.data.customLevels.find((c) => c.id === id);
}

function onShared(): void {
  const out = processEvent(store.data, { type: 'share' });
  store.persist();
  out.unlocked.forEach((id) => {
    achQueue.push(id);
    showNextAch();
  });
}

async function shareUrl(url: string): Promise<void> {
  const ok = await shareLink(url, t('title'), t('challengeTitle'));
  if (ok) onShared();
}

function saveDraftToMine(): boolean {
  const code = ed.currentCode();
  const list = store.data.customLevels;
  const existing = ed.draft.id ? findMine(ed.draft.id) : undefined;
  if (!existing && list.length >= CUSTOM_LIMIT) {
    toast(t('limitReached'));
    return false;
  }
  const entry: CustomLevel = {
    id: existing?.id ?? Date.now().toString(36),
    name: ed.toChallenge().name,
    code,
    verified: ed.isVerified(),
    ts: Date.now(),
  };
  store.update((s) => {
    const i = s.customLevels.findIndex((c) => c.id === entry.id);
    if (i >= 0) s.customLevels[i] = entry;
    else s.customLevels.push(entry);
  });
  ed.draft.id = entry.id;
  return true;
}

function handleLink(link: LinkKind | null): void {
  if (!link) return;
  if (link.kind === 'c' && !decodeChallenge(link.code).ok) {
    toast(t('badLink'), 3500);
    gotoScreen('menu');
    return;
  }
  pendingLink = link;
  if (gstate !== 'MENU') bus.emit('toMenu', undefined);
  gotoScreen('challenge');
}

function playPendingLink(): void {
  const l = pendingLink;
  if (!l) return;
  const base = { challengeScore: l.score, challengeName: l.name ?? t('friend') };
  if (l.kind === 'c') start({ mode: 'custom', levelId: 300, code: l.code, ...base });
  else if (l.kind === 'd') start({ mode: 'daily', levelId: 200, dailyKey: l.date, ...base });
  else start({ mode: 'endless', levelId: 400, runSeed: l.seed, ...base });
  pendingLink = null;
}

function cardFor(r: ResultData): void {
  const s = r.summary;
  const title =
    s.mode === 'custom' ? r.name || t('custom') : s.mode === 'endless' ? t('waveReached', { n: r.endless?.wave ?? 1 }) : s.mode === 'daily' ? `${t('dailyTitle')} ${r.dailyKey ?? ''}` : levelName(r.levelId);
  const fs = r.challenge?.friendScore;
  void shareCard({
    title,
    subtitle: modeLabel(s.mode),
    score: s.score,
    stars: s.mode === 'campaign' || s.mode === 'custom' ? s.stars : undefined,
    line: fs !== undefined ? `${r.challenge?.friendName ?? t('friend')}: ${fs}` : undefined,
  });
}

function handleAction(act: string, arg: string | undefined, el: HTMLElement): void {
  sfx.unlock();
  const disabled = el.getAttribute('aria-disabled') === 'true';
  switch (act) {
    case 'continue':
      result = null;
      hintType = null;
      bus.emit('continue', undefined);
      break;
    case 'play':
      sfx.click();
      if (!store.data.tutorialDone) {
        training = false;
        startCampaign(0);
      } else gotoScreen('levels');
      break;
    case 'goto':
      sfx.click();
      if (arg === 'records') recordsTab = 'levels';
      gotoScreen(arg as Screen);
      break;
    case 'rtab':
      recordsTab = arg as RecordsTab;
      confirmReset = false;
      renderAll();
      break;
    case 'level':
      sfx.click();
      startCampaign(Number(arg));
      break;
    case 'startVersus':
      start({ mode: 'versus', levelId: 100 });
      break;
    case 'startDuel':
      start({ mode: 'duel', levelId: 100, botLevel: arg as BotLevel });
      break;
    case 'startDaily':
      start({ mode: 'daily', levelId: 200 });
      break;
    case 'startEndless':
      start({ mode: 'endless', levelId: 400 });
      break;
    case 'lang':
      store.update((s) => (s.lang = arg as Lang));
      setLang(arg as Lang);
      break;
    case 'sound':
      store.update((s) => (s.sound = !s.sound));
      sfx.unlock();
      sfx.click();
      renderAll();
      break;
    case 'soundSet':
      store.update((s) => (s.sound = arg === '1'));
      sfx.unlock();
      sfx.click();
      renderAll();
      break;
    case 'vibSet':
      store.update((s) => (s.vibration = arg === '1'));
      renderAll();
      break;
    case 'difficulty':
      store.update((s) => (s.difficulty = arg as Difficulty));
      renderAll();
      break;
    case 'quality':
      store.update((s) => (s.quality = arg as Quality));
      bus.emit('settings', undefined);
      renderAll();
      break;
    case 'pause':
      sfx.click();
      bus.emit('pause', undefined);
      break;
    case 'resume':
      bus.emit('resume', undefined);
      break;
    case 'restart':
      result = null;
      confirmQuit = false;
      hintType = null;
      bus.emit('restart', undefined);
      break;
    case 'next':
      result = null;
      bus.emit('next', undefined);
      break;
    case 'quitAsk':
      confirmQuit = true;
      renderModal();
      break;
    case 'quitNo':
      confirmQuit = false;
      renderModal();
      break;
    case 'quitYes':
    case 'quit': {
      // явный выход: сохранённый раунд очищается
      store.update((s) => (s.resume = null));
      const mode = hud?.mode;
      result = null;
      confirmQuit = false;
      hintType = null;
      screen =
        mode === 'campaign' || mode === 'training'
          ? 'levels'
          : mode === 'custom' && lastStart?.editorTest
            ? 'editor'
            : mode === 'custom'
              ? 'mine'
              : mode === 'versus' || mode === 'duel' || mode === 'endless' || mode === 'daily'
                ? 'modes'
                : 'menu';
      bus.emit('toMenu', undefined);
      break;
    }
    case 'skipTut':
      screen = 'levels';
      bus.emit('skipTutorial', undefined);
      break;
    case 'closeHint':
      if (hintType) {
        const tp = hintType;
        store.update((s) => {
          if (!s.seenHints.includes(tp)) s.seenHints.push(tp);
        });
      }
      hintType = null;
      renderHud();
      break;
    case 'resetAsk':
      confirmReset = true;
      renderAll();
      break;
    case 'resetNo':
      confirmReset = false;
      renderAll();
      break;
    case 'resetYes':
      store.reset();
      confirmReset = false;
      bus.emit('look', undefined);
      renderAll();
      break;

    // ---- редактор
    case 'editorNew':
      ed.resetDraft();
      gotoScreen('editor');
      break;
    case 'edAdd':
      if (!ed.addObject(arg as 'normal')) toast(t('errMany'));
      renderScreen();
      break;
    case 'edRot':
      ed.rotateSelected(Number(arg));
      renderScreen();
      break;
    case 'edDel':
      ed.deleteSelected();
      renderScreen();
      break;
    case 'edClear':
      ed.clearAll();
      renderScreen();
      break;
    case 'edThrows':
      ed.changeThrows(Number(arg));
      renderScreen();
      break;
    case 'edPar':
      ed.changePar(Number(arg));
      renderScreen();
      break;
    case 'edTest':
      if (disabled) break;
      start({ mode: 'custom', levelId: 300, code: ed.currentCode(), editorTest: true });
      break;
    case 'edSave':
      if (disabled) break;
      if (saveDraftToMine()) toast(t('saved'));
      renderScreen();
      break;
    case 'edShare':
      if (disabled) {
        toast(t('shareLocked'));
        break;
      }
      saveDraftToMine();
      void shareUrl(makeLink({ kind: 'c', code: ed.currentCode(), name: senderName() }));
      renderScreen();
      break;
    case 'backToEditor':
      result = null;
      screen = 'editor';
      bus.emit('toMenu', undefined);
      break;

    // ---- мои испытания
    case 'minePlay': {
      const c = findMine(arg);
      if (c) start({ mode: 'custom', levelId: 300, code: c.code });
      break;
    }
    case 'mineEdit': {
      const c = findMine(arg);
      if (c && ed.loadFromCode(c.code, c.id, c.verified)) gotoScreen('editor');
      break;
    }
    case 'mineShare': {
      const c = findMine(arg);
      if (!c) break;
      if (disabled) {
        toast(t('shareLocked'));
        break;
      }
      void shareUrl(makeLink({ kind: 'c', code: c.code, name: senderName() }));
      break;
    }
    case 'mineDel':
      confirmDeleteId = arg ?? null;
      renderScreen();
      break;
    case 'mineDelNo':
      confirmDeleteId = null;
      renderScreen();
      break;
    case 'mineDelYes':
      store.update((s) => (s.customLevels = s.customLevels.filter((c) => c.id !== arg)));
      confirmDeleteId = null;
      renderScreen();
      break;

    // ---- вызовы
    case 'challengePlay':
      playPendingLink();
      break;
    case 'challengeCancel':
      pendingLink = null;
      gotoScreen('menu');
      break;
    case 'counter':
      if (result?.challenge?.code) void shareUrl(makeLink({ kind: 'c', code: result.challenge.code, score: result.summary.score, name: senderName() }));
      break;
    case 'saveMine': {
      const code = result?.challenge?.code;
      if (!code || !result) break;
      if (store.data.customLevels.length >= CUSTOM_LIMIT) {
        toast(t('limitReached'));
        break;
      }
      const d = decodeChallenge(code);
      const cleared = result.summary.cleared;
      store.update((s) =>
        s.customLevels.push({ id: Date.now().toString(36), name: d.ok ? d.challenge.name : '', code, verified: cleared, ts: Date.now() }),
      );
      toast(t('saved'));
      renderModal();
      break;
    }
    case 'shareDaily': {
      const key = result?.dailyKey ?? dateKey();
      const best = result?.mode === 'daily' ? result.summary.score : store.data.daily[key]?.best;
      void shareUrl(makeLink({ kind: 'd', date: key, score: best, name: senderName() }));
      break;
    }
    case 'shareEndless':
      if (result?.endless) void shareUrl(makeLink({ kind: 'e', seed: result.endless.runSeed, score: result.endless.total, name: senderName() }));
      break;
    case 'card':
      if (result) cardFor(result);
      break;

    // ---- магазин
    case 'buyItem': {
      const res = buyItem(store.data, arg ?? '');
      store.persist();
      if (res === 'poor') toast(t('notEnough'));
      else if (res === 'ok') {
        equipItem(store.data, arg ?? '');
        store.persist();
        sfx.win();
        bus.emit('look', undefined);
      }
      renderScreen();
      break;
    }
    case 'equip':
      if (equipItem(store.data, arg ?? '')) {
        store.persist();
        bus.emit('look', undefined);
      }
      renderScreen();
      break;
    case 'proAsk':
      shopOverlay = 'confirm';
      renderScreen();
      break;
    case 'proNo':
      shopOverlay = 'none';
      renderScreen();
      break;
    case 'proYes':
      store.update((s) => activatePro(s));
      shopOverlay = 'got';
      sfx.win();
      renderScreen();
      break;
    case 'proOk':
      shopOverlay = 'none';
      renderScreen();
      break;
  }
}

export function initUI(): void {
  const root = $('ui');
  root.innerHTML = `<div id="screen"></div><div id="hud"></div><div id="hint"></div><div id="floats"></div><div id="banner" role="status"></div><div id="modal"></div><div id="toast" role="status"></div><div id="ach" role="status"></div>`;

  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    handleAction(el.dataset.act!, el.dataset.arg, el);
  });
  root.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.act === 'training') {
      training = el.checked;
      renderAll();
    }
  });
  root.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.name !== undefined) {
      const i = Number(el.dataset.name) as 0 | 1;
      store.update((s) => (s.playerNames[i] = el.value.slice(0, 16)));
    } else if (el.id === 'ed-name') {
      ed.setName(el.value);
    }
  });

  bus.on('hud', (h) => {
    hud = h;
    renderHud();
  });
  bus.on('state', (s) => {
    const prev = gstate;
    gstate = s;
    if (s === 'MENU') {
      result = null;
      tutStep = -1;
      hintType = null;
    }
    if (s === 'FLYING' && hintType) {
      // подсказка о новом типе закрывается первым броском и больше не показывается
      const tp = hintType;
      store.update((d) => {
        if (!d.seenHints.includes(tp)) d.seenHints.push(tp);
      });
      hintType = null;
    }
    if (s === 'LEVEL_INTRO' && hud) {
      const title =
        hud.mode === 'versus'
          ? t('versusTitle')
          : hud.mode === 'duel'
            ? `${t('duel')} · ${botLabel(hud.botLevel)}`
            : hud.mode === 'daily'
              ? t('dailyTitle')
              : hud.mode === 'endless'
                ? t('waveLabel', { n: hud.wave ?? 1 })
                : hud.mode === 'custom'
                  ? hud.name || t('custom')
                  : hud.levelId === 0
                    ? levelName(0)
                    : `${t('levelTitle', { n: hud.levelId })} · ${levelName(hud.levelId)}`;
      flash(title, 900);
    }
    const big = ['PAUSED', 'MENU', 'LEVEL_COMPLETE', 'LEVEL_FAILED'];
    if (big.includes(prev) || big.includes(s)) renderAll();
    else renderHud();
  });
  bus.on('tutorial', ({ step }) => {
    tutStep = step;
    renderHud();
  });
  bus.on('turn', ({ player }) => {
    if (hud?.mode === 'duel' && player === 1) return;
    flash(t('turnOf', { name: playerName(player, hud?.mode, hud?.botLevel) }), 1100);
  });
  bus.on('result', (r) => {
    result = r;
    if (r.editorTest && r.summary.cleared) {
      ed.markVerified();
      if (ed.draft.id) {
        const id = ed.draft.id;
        store.update((s) => {
          const c = s.customLevels.find((x) => x.id === id);
          if (c && c.code === ed.currentCode()) c.verified = true;
        });
      }
    }
    renderModal();
  });
  bus.on('float', ({ x, y, text, kind }) => {
    const d = document.createElement('div');
    d.className = `float ${kind}`;
    d.textContent = text;
    d.style.left = `${(x / 720) * 100}%`;
    d.style.top = `${(y / 1080) * 100}%`;
    d.addEventListener('animationend', () => d.remove());
    $('floats').appendChild(d);
  });
  bus.on('banner', ({ key, params }) => flash(t(key, params), 1000));
  bus.on('toast', ({ key, params }) => toast(t(key, params), 3000));
  bus.on('hint', ({ type }) => {
    hintType = type;
    renderHud();
  });
  bus.on('achievement', ({ id }) => {
    if (!FEATURES.achievements) return;
    achQueue.push(id);
    showNextAch();
  });

  onLang(renderAll);
  // Не даём странице скроллиться/зумиться при игре пальцем (кроме прокручиваемых панелей).
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!(e.target as HTMLElement).closest('.scroll')) e.preventDefault();
    },
    { passive: false },
  );
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault());

  const rot = document.createElement('div');
  rot.id = 'rotate';
  rot.setAttribute('role', 'alert');
  document.body.appendChild(rot);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (gstate === 'PAUSED') bus.emit('resume', undefined);
      else if (gstate === 'AIMING' || gstate === 'FLYING' || gstate === 'SETTLING') bus.emit('pause', undefined);
    }
  });

  // Ссылка-вызов: сразу экран «Вызов», минуя меню. Хэш убираем, чтобы перезагрузка не повторяла вызов.
  const consumeHash = () => {
    const link = parseHash(location.hash);
    if (location.hash) {
      if (!link) toast(t('badLink'), 3500);
      history.replaceState(null, '', location.pathname + location.search);
    }
    handleLink(link);
  };
  window.addEventListener('hashchange', consumeHash);
  renderAll();
  consumeHash();
}

// для e2e/отладки: код испытания → уровень (проверка без DOM)
export const __test = { challengeToLevel, itemById };
