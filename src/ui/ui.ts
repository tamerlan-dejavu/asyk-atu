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
import type { BotLevel, CustomLevel, Difficulty, Lang, LoftLevel, Quality, Ruleset } from '../types';
import { cloudKey, dailyKey as rsDailyKey, levelKey } from '../game/rules/ruleset';
import { $, botLabel, coinIcon, heartIcon, icon, levelName, modeLabel, ornament, playerName, setHtml, stars, toast, u } from './common';
import { artUrl, cacheIcons, SAKA_ART, uiIcon } from '../game/render/art';
import * as ed from './editor';
import { recordsScreen, type RecordsTab } from './records';
import { makeLink, senderName, shareCard, shareLink } from './share';
import { shopScreen, type ShopOverlay } from './shop';
import { fullscreenSupported, leftPanel, rightPanel, toggleFullscreen } from './side';
import { isWide, onLayout } from './layout';
import { cloud, type BoardRow } from '../cloud/cloud';
import {
  aboutBlock,
  bindProfile,
  boardTable,
  handleCloudAction,
  leaderboardScreen,
  loadBoard,
  loadCloudHistory,
  profileScreen,
  syncLabel,
} from './cloudui';

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
  | 'challenge'
  | 'profile'
  | 'board';

let screen: Screen = 'menu';
let gstate: GameState = 'MENU';
let hud: HudData | null = null;
let tutStep = -1;
let result: ResultData | null = null;
let training = false;
let confirmReset = false;
let confirmQuit = false;
/** R во время раунда: подтверждение перезапуска (игра на паузе) */
let confirmRestart = false;
let confirmDeleteId: string | null = null;
let recordsTab: RecordsTab = 'levels';
let shopOverlay: ShopOverlay = 'none';
let bannerTimer = 0;
let pendingLink: LinkKind | null = null;
/** вызов по короткой ссылке: id, число прохождений и «кто уже прошёл» */
let pendingShort: { id: string; plays: number; rows: BoardRow[] | null | 'loading' | 'error' } | null = null;
let linkLoading = false;
let lastStart: StartRequest | null = null;
let hintType: 'golden' | 'heavy' | 'block' | 'loft' | null = null;
const achQueue: string[] = [];
let achShowing = false;

const lvName = (id: number, custom?: string): string => (custom ? u(custom) : levelName(id));

// ------------------------------------------------------------------ экраны
function menuScreen(): string {
  const lang = getLang();
  const langBtn = (l: Lang, label: string) =>
    `<button class="chip${lang === l ? ' on' : ''}" data-act="lang" data-arg="${l}" aria-pressed="${lang === l}">${label}</button>`;
  const rs = FEATURES.resume ? store.data.resume : null;
  const cont = rs
    ? `<button class="btn primary big cont" data-act="continue">${t('continue')}<small>${t('continueInfo', {
        name:
          rs.mode === 'endless'
            ? t('waveLabel', { n: rs.extra.wave ?? 1 })
            : rs.mode === 'campaign'
              ? levelName(rs.levelId)
              : modeLabel(rs.mode),
        score: (rs.extra.totalScore ?? 0) + rs.round.scores[0] + (rs.mode === 'versus' || rs.mode === 'duel' ? rs.round.scores[1] : 0),
      })}</small></button>`
    : '';
  const saka = store.data.equipped.saka;
  const dust = Array.from(
    { length: 14 },
    (_, i) => `<i style="left:${(i * 37) % 100}%;animation-duration:${9 + ((i * 7) % 8)}s;animation-delay:-${(i * 1.3) % 9}s"></i>`,
  ).join('');
  return `
  <section class="screen menu">
    <div class="dust" aria-hidden="true">${dust}</div>
    <div class="menu-top">
      ${FEATURES.shop ? `<button class="skinbadge" data-act="goto" data-arg="shop" aria-label="${t('shop')}"><img src="${artUrl('saka', `${SAKA_ART[saka] ?? 'saka_bronze'}`)}" alt="" aria-hidden="true"/>${t(`item_${saka}` as Key)}</button>` : '<span></span>'}
      ${FEATURES.shop ? `<span class="coinbadge" aria-label="${t('coins')}">${coinIcon()} ${store.data.coins}</span>` : ''}
    </div>
    <div class="title-wrap">
      <img class="emblem" src="${uiIcon('emblem_asyk')}" alt="" aria-hidden="true" draggable="false"/>
      <h1>${t('title')}</h1>
      <p class="tag">${t('tagline')}</p>
    </div>
    <div class="stack">
      ${cont}
      <button class="btn ${rs ? '' : 'primary big'}" data-act="play">${t('play')}</button>
      <div class="mgrid2">
        <button class="btn sec" data-act="goto" data-arg="modes">${icon('ui_bolt')} ${t('modes')}</button>
        ${FEATURES.shop ? `<button class="btn sec" data-act="goto" data-arg="shop">${coinIcon()} ${t('shop')}</button>` : ''}
        <button class="btn sec" data-act="goto" data-arg="records">${icon('ui_trophy')} ${t('records')}</button>
        <button class="btn sec" data-act="goto" data-arg="rules">${icon('ui_star_full')} ${t('howTo')}</button>
        <button class="btn sec wide" data-act="goto" data-arg="settings">${icon('ui_gear')} ${t('settings')}</button>
      </div>
    </div>
    ${FEATURES.cloud ? `<div class="menu-sync">${syncLabel()}</div>` : ''}
    <div class="menu-foot">
      <div class="chips" role="group" aria-label="${t('language')}">${langBtn('ru', 'RU')}${langBtn('kk', 'ҚАЗ')}${langBtn('en', 'EN')}</div>
      <div class="chips">
        ${FEATURES.cloud ? `<button class="chip icon${cloud.signedIn ? ' on' : ''}" data-act="goto" data-arg="profile" aria-label="${t('profile')}">👤</button>` : ''}
        <button class="chip icon${store.data.sound ? ' on' : ''}" data-act="sound" aria-pressed="${store.data.sound}" aria-label="${t('sound')}">${store.data.sound ? '🔊' : '🔇'}</button>
        ${isWide() && fullscreenSupported() ? `<button class="chip icon${document.fullscreenElement ? ' on' : ''}" data-act="fullscreen" aria-pressed="${!!document.fullscreenElement}" aria-label="${t('fullscreen')} (F)">⛶</button>` : ''}
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
      ${card('loftPlay', '', icon('ui_bolt'), 'rulesetLoft', 'modeLoftDesc')}
      ${FEATURES.cloud ? card('goto', 'board', icon('ui_trophy'), 'leaderboard', 'modeBoardDesc') : ''}
    </div>
  </section>`;
}

function levelCard(l: { id: number; throws: number; par: number | null }, open: boolean): string {
  const st = store.data.levels[levelKey(l.id, store.data.ruleset)];
  const meta = l.id === 0 ? '' : `<span>${t('throwsN', { n: l.throws })}</span><span>${t('parN', { n: l.par ?? 0 })}</span>`;
  return `
    <button class="card${open ? '' : ' locked'}" data-act="level" data-arg="${l.id}" ${open ? '' : 'disabled'} aria-label="${t('levelN', { n: l.id })}: ${levelName(l.id)}${open ? '' : ' — ' + t('locked')}">
      <span class="num">${l.id === 0 ? '★' : l.id}</span>
      <span class="cname">${levelName(l.id)}</span>
      ${open ? stars(st?.stars ?? 0) : icon('ui_lock', 'lock')}
      <span class="cmeta">${open ? meta : t('locked')}</span>
      <span class="cbest">${open && st ? `${t('best')}: ${st.best}` : ''}</span>
    </button>`;
}

function levelsScreen(): string {
  const s = store.data;
  const open = (id: number) => id <= s.unlocked;
  const ch = (key: Key, list: typeof LEVELS) =>
    `<h3 class="chapter">${t(key)}</h3><div class="grid">${list.map((l) => levelCard(l, open(l.id))).join('')}</div>`;
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('chooseLevel')}</h2></header>
    ${ornament()}
    <div class="chips rs-switch" role="group" aria-label="${t('ruleset')}">${(['classic', 'loft'] as Ruleset[])
      .map(
        (r) =>
          `<button class="chip wide${s.ruleset === r ? ' on' : ''}" data-act="rulesetSet" data-arg="${r}" aria-pressed="${s.ruleset === r}">${t(r === 'loft' ? 'rulesetLoft' : 'rulesetClassic')}</button>`,
      )
      .join('')}</div>
    <label class="toggle"><input type="checkbox" data-act="training" ${training ? 'checked' : ''}/> <span><b>${t('training')}</b><small>${t('trainingHint')}</small></span></label>
    <div class="scroll levels-scroll">
      ${ch(
        'chapter1',
        LEVELS.filter((l) => l.id <= 5),
      )}
      ${ch(
        'chapter2',
        LEVELS.filter((l) => l.id >= 6),
      )}
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
  const b = (lvl: BotLevel, key: Key) =>
    `<button class="btn ${lvl === 'hard' ? 'primary' : ''}" data-act="startDuel" data-arg="${lvl}">🤖 ${t(key)}</button>`;
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
  const best = store.data.daily[rsDailyKey(dateKey(), store.data.ruleset)]?.best;
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
  const eb = store.data.ruleset === 'loft' ? store.data.endlessBestLoft : store.data.endlessBest;
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
  if (linkLoading)
    return `<section class="screen"><header class="bar"><h2>${t('challengeTitle')}</h2></header>${ornament()}<div class="panel"><p>${t('cloudConnecting')}</p></div></section>`;
  const l = pendingLink;
  if (!l) return menuScreen();
  const friend = l.name ?? t('friend');
  const line = l.score !== undefined ? t('challengeFrom', { name: u(friend), score: l.score }) : t('challengeNoScore', { name: u(friend) });
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
      ${pendingShort ? `<p class="small">${t('playsN', { n: pendingShort.plays })}</p>` : ''}
      <button class="btn primary big" data-act="challengePlay">${t('play')}</button>
      ${pendingShort && cloud.signedIn ? `<h3>${t('whoPlayed')}</h3>${boardTable(pendingShort.rows)}` : ''}
    </div>
  </section>`;
}

const svgField = `<svg viewBox="0 0 120 150" class="illus" role="img" aria-hidden="true"><rect width="120" height="150" rx="8" fill="#c8975a"/><circle cx="60" cy="52" r="38" fill="rgba(122,70,28,.25)" stroke="#0e7f7d" stroke-width="3"/>${[
  [42, 46],
  [60, 46],
  [78, 46],
  [50, 62],
  [70, 62],
]
  .map(
    ([x, y]) =>
      `<polygon points="${x - 8},${y} ${x - 4},${y - 4} ${x + 4},${y - 4} ${x + 8},${y} ${x + 4},${y + 4} ${x - 4},${y + 4}" fill="#f6ecd0" stroke="#4b3018" stroke-width="1.2"/>`,
  )
  .join(
    '',
  )}<line x1="8" y1="128" x2="112" y2="128" stroke="#16a5a3" stroke-width="2" stroke-dasharray="5 4"/><polygon points="46,126 52,118 68,118 74,126 68,134 52,134" fill="#aab4bf" stroke="#11171c" stroke-width="1.6"/></svg>`;
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
      <article class="rule"><div class="illus-text" aria-hidden="true">${stars(3)}</div><div><h3>${t('rulesStars')}</h3><p>${t('rulesStarsText')}</p></div></article>
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
      <label class="slider"><span>${t('volume')}</span><input type="range" min="0" max="100" step="5" data-vol="1" value="${Math.round(s.volume * 100)}" aria-label="${t('volume')}"/><output>${Math.round(s.volume * 100)}%</output></label>
      ${canVibrate ? `<h3>${t('vibration')}</h3><div class="chips">${opt('vibSet', '1', t('on'), s.vibration)}${opt('vibSet', '0', t('off'), !s.vibration)}</div>` : ''}
      <h3>${t('ruleset')}</h3>
      <div class="chips">${opt('rulesetSet', 'classic', t('rulesetClassic'), s.ruleset !== 'loft')}${opt('rulesetSet', 'loft', t('rulesetLoft'), s.ruleset === 'loft')}</div>
      <p class="small">${t('rulesetHint')}</p>
      <h3>${t('quality')}</h3>
      <div class="chips">${opt('quality', 'auto', t('qualityAuto'), q === 'auto')}${opt('quality', 'high', t('qualityHigh'), q === 'high')}${opt('quality', 'medium', t('qualityMedium'), q === 'medium')}${opt('quality', 'low', t('qualityLow'), q === 'low')}</div>
      <p class="small">${t('qualityHint')}</p>
      <label class="field"><span>${t('yourName')}</span><input data-name="0" maxlength="16" placeholder="${t('yourNamePh')}" autocomplete="off"/></label>
      ${FEATURES.cloud ? `<button class="btn sec" data-act="goto" data-arg="profile">👤 ${t('profile')}</button>` : ''}
      ${aboutBlock()}
    </div>
  </section>`;
}

// ------------------------------------------------------------------ HUD
/** Три кнопки высоты броска у большого пальца (набор «навес»). Иконки: линия, дуга, высокая дуга. */
function loftBar(): string {
  if (!hud || hud.ruleset !== 'loft' || gstate === 'MENU') return '';
  if (hud.mode === 'duel' && hud.player === 1) return '';
  const icon: Record<LoftLevel, string> = {
    low: '<path d="M4 20 L28 16" />',
    mid: '<path d="M4 22 Q16 6 28 22" />',
    high: '<path d="M4 24 Q16 -8 28 24" />',
  };
  const btn = (l: LoftLevel, key: Key) =>
    `<button class="loftbtn${hud!.loft === l ? ' on' : ''}" data-act="loftSet" data-arg="${l}" aria-pressed="${hud!.loft === l}" aria-label="${t('loftHeight')}: ${t(key)}"><svg viewBox="0 0 32 28" aria-hidden="true">${icon[l]}</svg><small>${t(key)}</small></button>`;
  return `<div class="loftbar" role="group" aria-label="${t('loftHeight')}">${btn('high', 'loftHigh')}${btn('mid', 'loftMid')}${btn('low', 'loftLow')}</div>`;
}

function hudHtml(): string {
  if (!hud || gstate === 'MENU') return '';
  return hudCore() + loftBar();
}

function hudCore(): string {
  const h = hud!;
  if (h.mode === 'versus' || h.mode === 'duel') {
    const chip = (i: 0 | 1) => {
      const active = h.player === i;
      const left = h.versusLeft[i];
      let ic = '';
      for (let k = 0; k < 6; k++) ic += heartIcon(k < left);
      return `<div class="pchip p${i + 1}${active ? ' active' : ''}"><b class="pn">${u(playerName(i, h.mode, h.botLevel))}</b><span class="ps">${h.scores[i]}</span><span class="icons">${ic}</span></div>`;
    };
    return `<div class="hud versus"><button class="btn icon-btn" data-act="pause" aria-label="${t('pause')}">❚❚</button>${chip(0)}${chip(1)}</div>`;
  }
  let icons = '';
  if (Number.isFinite(h.throwsTotal) && h.throwsTotal <= 16) {
    for (let k = 0; k < h.throwsTotal; k++) icons += heartIcon(k < h.throwsLeft);
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
    const key: Key =
      hintType === 'golden' ? 'hintGolden' : hintType === 'heavy' ? 'hintHeavy' : hintType === 'loft' ? 'hintLoft' : 'hintBlock';
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
  if (confirmRestart) {
    return `<div class="modal"><div class="panel pop">
      <h2>${t('restartAsk')}</h2>${ornament()}
      <p>${t('restartConfirm')}</p>
      <div class="row2"><button class="btn danger" data-act="restartYes">${t('yes')}</button><button class="btn sec" data-act="restartNo">${t('no')}</button></div>
    </div></div>`;
  }
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
  return r.coins > 0 && FEATURES.shop
    ? `<p class="coins">${coinIcon()} ${t('coinsEarned', { n: `<b class="count coin" data-to="${r.coins}">${r.coins}</b>` })}</p>`
    : '';
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
      <p class="total">${t('runScore', { n: `<b class="count" data-to="${e.total}">${e.total}</b>` })}</p>
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
      if (!store.data.customLevels.some((c) => c.code === r.challenge?.code))
        extra.push(`<button class="btn sec" data-act="saveMine">${t('saveToMine')}</button>`);
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
          .map(
            (d) =>
              `<button class="chip wide${store.data.difficulty === d ? ' on' : ''}" data-act="difficulty" data-arg="${d}">${t(d === 'easy' ? 'diffEasy' : 'diffNormal')}</button>`,
          )
          .join('')}</div></div>`
      : '';
  return `<div class="modal"><div class="panel pop result ${win ? 'win' : 'lose'}">
    <h2>${win ? t('victory') : t('defeat')}</h2>${ornament()}
    ${s.mode === 'custom' ? `<p class="small">${lvName(300, r.name)}</p>` : ''}
    ${showStars ? stars(s.stars, true) : ''}
    ${!win ? `<p class="small">${t('defeatHint')}</p>` : ''}
    <ul class="lines">${lines}</ul>
    <p class="total">${t('totalScore', { n: `<b class="count" data-to="${s.score}">${s.score}</b>` })}</p>
    ${r.newRecord ? `<p class="badge">${t('newRecord')}</p>` : ''}
    ${best}
    ${friendCompare(r, s.score)}
    ${coinsLine(r)}
    ${saveProgressHint(r)}
    ${diffPick}
    <div class="stack">${buttons}</div></div></div>`;
}

/** Гостю (или игроку без аккаунта) после победы предлагаем сохранить прогресс в облаке. */
function saveProgressHint(r: ResultData): string {
  if (!FEATURES.cloud || !cloud.ready || !r.summary.cleared || r.editorTest) return '';
  if (cloud.user && !cloud.user.anonymous) return '';
  return `<button class="btn sec" data-act="toProfile">☁ ${t('saveProgress')}</button>`;
}

/** Результат → облачный рейтинг (через очередь; без сети отправится позже). Локальные рекорды — как раньше. */
function submitToCloud(r: ResultData): void {
  if (!FEATURES.cloud || !cloud.signedIn || r.editorTest) return;
  const s = r.summary;
  const ck = (k: string) => cloudKey(k, r.ruleset);
  const base = { kind: 'result' as const, stars: s.stars, throws: s.throwsUsed, combo: s.bestCombo };
  if (s.mode === 'campaign') cloud.submitResult({ ...base, mode: 'level', key: ck(`level:${r.levelId}`), score: s.score });
  else if (s.mode === 'daily') cloud.submitResult({ ...base, mode: 'daily', key: ck(`daily:${r.dailyKey ?? dateKey()}`), score: s.score });
  else if (s.mode === 'endless' && r.endless) cloud.submitResult({ ...base, mode: 'endless', key: ck('endless'), score: r.endless.total });
  else if (s.mode === 'custom' && r.challenge?.shortId)
    cloud.submitResult({ ...base, mode: 'challenge', key: ck(`challenge:${r.challenge.shortId}`), score: s.score });
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
    profile: profileScreen,
    board: leaderboardScreen,
  };
  const keepScroll = el.querySelector('.scroll')?.scrollTop ?? 0;
  setHtml(el, map[screen]());
  el.classList.add('shown');
  bindInputs(el);
  const sc = el.querySelector('.scroll');
  if (sc) sc.scrollTop = keepScroll;
  if (screen === 'editor') ed.mountEditor(el, () => renderScreen());
  if (screen === 'profile') bindProfile(el);
}

function renderHud(): void {
  setHtml($('hud'), hudHtml());
  setHtml($('hint'), hintHtml());
  renderSide();
}

/** Боковые панели (десктоп/планшет): перерисовываются, только если содержимое изменилось — фокус не теряется. */
const sideCache = { l: '', r: '' };
function renderSide(): void {
  const wide = isWide();
  const ctx = { hud, gstate };
  const l = wide ? leftPanel(ctx) : '';
  const r = wide ? rightPanel(ctx) : '';
  const elL = $('side-l');
  const elR = $('side-r');
  if (l !== sideCache.l) setHtml(elL, l);
  if (r !== sideCache.r) setHtml(elR, r);
  sideCache.l = l;
  sideCache.r = r;
  elL.hidden = !l;
  elR.hidden = !r;
  elL.setAttribute('aria-label', t('sideGame'));
  elR.setAttribute('aria-label', t('sideControls'));
}

/** Меню и тосты: на телефоне — внутри поля (как раньше), на широком экране — в отдельном слое по центру окна. */
function placeLayers(): void {
  const host = isWide() ? $('overlay') : $('ui');
  for (const id of ['screen', 'toast', 'ach']) {
    const el = $(id);
    if (el.parentElement !== host) {
      if (id === 'screen') host.prepend(el);
      else host.appendChild(el);
    }
  }
}

/** Размытая копия текущей карты вокруг поля (виден только на широком экране). */
function drawBackdrop(ground: CanvasImageSource, far: CanvasImageSource | null): void {
  const c = document.querySelector<HTMLCanvasElement>('#backdrop canvas');
  const g = c?.getContext('2d');
  if (!c || !g) return;
  g.imageSmoothingQuality = 'high';
  g.drawImage(ground, 0, 0, c.width, c.height);
  if (far) g.drawImage(far, 0, 0, c.width, Math.round((c.height * 190) / 1128));
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  g.fillRect(0, 0, c.width, c.height);
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
  document.documentElement.dataset.quality = store.data.quality;
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
  pendingShort = null;
  if (link.kind === 'k') {
    void openShort(link.id, link.score, link.name);
    return;
  }
  if (link.kind === 'c' && !decodeChallenge(link.code).ok) {
    toast(t('badLink'), 3500);
    gotoScreen('menu');
    return;
  }
  pendingLink = link;
  if (gstate !== 'MENU') bus.emit('toMenu', undefined);
  gotoScreen('challenge');
}

/** Короткая ссылка #k=: вызов читается из облака (доступно и без входа). */
async function openShort(id: string, score?: number, name?: string): Promise<void> {
  if (gstate !== 'MENU') bus.emit('toMenu', undefined);
  linkLoading = true;
  gotoScreen('challenge');
  const ch = await cloud.getShort(id);
  linkLoading = false;
  if (!ch || !decodeChallenge(ch.code).ok) {
    toast(t(cloud.ready ? 'badLink' : 'cloudOff'), 3500);
    gotoScreen('menu');
    return;
  }
  pendingLink = { kind: 'c', code: ch.code, score, name };
  pendingShort = { id: ch.id, plays: ch.plays, rows: cloud.signedIn ? 'loading' : null };
  gotoScreen('challenge');
  if (cloud.signedIn) {
    const rows = await cloud.leaderboard('challenge', `challenge:${ch.id}`);
    if (pendingShort?.id === ch.id) {
      pendingShort.rows = rows ?? 'error';
      if (screen === 'challenge') renderScreen();
    }
  }
}

/** Ссылка на своё испытание: короткая через облако, иначе полная с кодом (обе формы работают всегда). */
async function challengeLink(code: string, title: string, score?: number): Promise<string> {
  const d = decodeChallenge(code);
  if (cloud.ready && d.ok) {
    const id = await cloud.createShort(code, title, d.challenge.throws, d.challenge.par);
    if (id) return makeLink({ kind: 'k', id, score, name: senderName() });
  }
  return makeLink({ kind: 'c', code, score, name: senderName() });
}

function playPendingLink(): void {
  const l = pendingLink;
  if (!l) return;
  const base = { challengeScore: l.score, challengeName: l.name ?? t('friend') };
  if (l.kind === 'c') {
    const shortId = pendingShort?.id;
    if (shortId) cloud.played(shortId);
    start({ mode: 'custom', levelId: 300, code: l.code, shortId, ...base });
  } else if (l.kind === 'd') start({ mode: 'daily', levelId: 200, dailyKey: l.date, ruleset: l.ruleset ?? 'classic', ...base });
  else if (l.kind === 'e') start({ mode: 'endless', levelId: 400, runSeed: l.seed, ruleset: l.ruleset ?? 'classic', ...base });
  pendingLink = null;
  pendingShort = null;
}

function cardFor(r: ResultData): void {
  const s = r.summary;
  const title =
    s.mode === 'custom'
      ? r.name || t('custom')
      : s.mode === 'endless'
        ? t('waveReached', { n: r.endless?.wave ?? 1 })
        : s.mode === 'daily'
          ? `${t('dailyTitle')} ${r.dailyKey ?? ''}`
          : levelName(r.levelId);
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
  if (handleCloudAction(act, arg, $('screen'), renderScreen)) return;
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
      if (arg === 'board') void loadBoard(renderScreen);
      break;
    case 'rtab':
      recordsTab = arg as RecordsTab;
      confirmReset = false;
      renderAll();
      if (recordsTab === 'history') void loadCloudHistory(renderScreen);
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
    case 'loftSet':
      store.update((s) => (s.loft = arg as LoftLevel));
      if (hud) hud = { ...hud, loft: arg as LoftLevel };
      sfx.click();
      renderHud();
      break;
    case 'rulesetSet':
      store.update((s) => {
        s.ruleset = arg === 'loft' ? 'loft' : 'classic';
        s.rulesetChosen = true;
      });
      renderAll();
      break;
    case 'loftPlay':
      store.update((s) => {
        s.ruleset = 'loft';
        s.rulesetChosen = true;
      });
      gotoScreen('levels');
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
      confirmRestart = false;
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
    case 'restartYes':
      confirmRestart = false;
      handleAction('restart', undefined, el);
      break;
    case 'restartNo':
      confirmRestart = false;
      bus.emit('resume', undefined);
      break;
    case 'fullscreen':
      toggleFullscreen();
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
      void challengeLink(ed.currentCode(), ed.toChallenge().name).then(shareUrl);
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
      void challengeLink(c.code, c.name).then(shareUrl);
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
      if (result?.challenge?.code) {
        const r = result;
        const code = r.challenge!.code!;
        const link = r.challenge?.shortId
          ? Promise.resolve(makeLink({ kind: 'k', id: r.challenge.shortId, score: r.summary.score, name: senderName() }))
          : challengeLink(code, r.name ?? '', r.summary.score);
        void link.then(shareUrl);
      }
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
      const best = result?.mode === 'daily' ? result.summary.score : store.data.daily[rsDailyKey(key, store.data.ruleset)]?.best;
      void shareUrl(makeLink({ kind: 'd', date: key, score: best, name: senderName(), ruleset: result?.ruleset ?? store.data.ruleset }));
      break;
    }
    case 'shareEndless':
      if (result?.endless)
        void shareUrl(
          makeLink({ kind: 'e', seed: result.endless.runSeed, score: result.endless.total, name: senderName(), ruleset: result.ruleset }),
        );
      break;
    case 'card':
      if (result) cardFor(result);
      break;
    case 'toProfile':
      store.update((s) => (s.resume = null));
      result = null;
      screen = 'profile';
      bus.emit('toMenu', undefined);
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
      renderSide();
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

/**
 * Горячие клавиши. Прицел (стрелки, Space при натяжении, Esc/ПКМ — отмена натяжения) — в AimController,
 * он получает событие раньше и гасит его, если натяжение идёт. Здесь — всё остальное.
 */
function onKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  const inRound = gstate !== 'MENU' && gstate !== 'LEVEL_COMPLETE' && gstate !== 'LEVEL_FAILED';
  const onButton = target?.tagName === 'BUTTON';
  if (hud?.ruleset === 'loft' && inRound && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3')) {
    const l: LoftLevel = e.code === 'Digit1' ? 'low' : e.code === 'Digit2' ? 'mid' : 'high';
    handleAction('loftSet', l, document.body);
    return;
  }
  switch (e.code) {
    case 'Escape':
      if (gstate === 'PAUSED') {
        confirmRestart = false;
        confirmQuit = false;
        bus.emit('resume', undefined);
      } else if (gstate === 'AIMING' || gstate === 'FLYING' || gstate === 'SETTLING') bus.emit('pause', undefined);
      return;
    case 'KeyM':
      handleAction('sound', undefined, document.body);
      return;
    case 'KeyF':
      toggleFullscreen();
      return;
    case 'KeyR':
      if (gstate === 'LEVEL_COMPLETE' || gstate === 'LEVEL_FAILED') handleAction('restart', undefined, document.body);
      else if (inRound && hud?.mode !== 'training') {
        confirmRestart = true;
        if (gstate === 'PAUSED') renderModal();
        else bus.emit('pause', undefined);
      } else if (inRound) handleAction('restart', undefined, document.body);
      return;
    case 'Space':
    case 'Enter': {
      // итог раунда: главная кнопка (дальше / ещё раз); на кнопке в фокусе браузер нажмёт её сам
      if (onButton || (gstate !== 'LEVEL_COMPLETE' && gstate !== 'LEVEL_FAILED')) return;
      const main = document.querySelector<HTMLButtonElement>('#modal .btn.primary');
      if (main) {
        e.preventDefault();
        main.click();
      }
      return;
    }
  }
}

/** Итог раунда: звёзды загораются по очереди (звук + искры), очки и тиын «набегают». */
function animateResult(r: ResultData): void {
  const modal = $('modal');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const starsOn = [...modal.querySelectorAll<HTMLElement>('.stars.big .sti.on')];
  starsOn.forEach((el, i) =>
    window.setTimeout(
      () => {
        if (!el.isConnected) return;
        sfx.star(i);
        el.classList.add('lit');
        if (!reduced) sparkle(el);
      },
      reduced ? 0 : 280 + i * 320,
    ),
  );
  const delay = reduced ? 0 : 250 + starsOn.length * 320;
  modal.querySelectorAll<HTMLElement>('.count').forEach((el) => {
    const to = Number(el.dataset.to) || 0;
    if (reduced || to <= 0) return;
    const coin = el.classList.contains('coin');
    el.textContent = '0';
    const dur = Math.min(900, 300 + to * 6);
    let last = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      if (!el.isConnected) return;
      const u = Math.max(0, Math.min(1, (now - t0) / dur));
      const v = Math.round(to * (1 - Math.pow(1 - u, 3)));
      el.textContent = String(v);
      if (
        coin &&
        v !== last &&
        now - t0 > 0 &&
        Math.floor(v / Math.max(1, Math.ceil(to / 8))) !== Math.floor(last / Math.max(1, Math.ceil(to / 8)))
      )
        sfx.coin();
      last = v;
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  void r;
}

/** Искры вокруг элемента (DOM, 8 штук, удаляются по окончании анимации). */
function sparkle(el: HTMLElement): void {
  const host = el.closest('.panel') as HTMLElement | null;
  if (!host) return;
  const a = el.getBoundingClientRect();
  const b = host.getBoundingClientRect();
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('i');
    s.className = 'spark';
    const ang = (i / 8) * Math.PI * 2;
    s.style.left = `${a.left - b.left + a.width / 2}px`;
    s.style.top = `${a.top - b.top + a.height / 2}px`;
    s.style.setProperty('--dx', `${Math.cos(ang) * 2.2}em`);
    s.style.setProperty('--dy', `${Math.sin(ang) * 2.2}em`);
    s.addEventListener('animationend', () => s.remove());
    host.appendChild(s);
  }
}

/**
 * Иконки интерфейса и начертания шрифтов подгружаются сразу после старта: иначе браузер запросит их лениво
 * (при первом показе экрана) — и без сети экран уровней остался бы без звёзд и замков.
 */
function warmUp(): void {
  // после скачивания — перерисовать, чтобы экран уже брал иконки из памяти
  void cacheIcons([
    'ui_coin',
    'ui_heart',
    'ui_star_full',
    'ui_star_empty',
    'ui_lock',
    'ui_trophy',
    'ui_bolt',
    'ui_gear',
    'emblem_asyk',
  ]).then(() => renderAll());
  const sample = 'Aa Аа Әә Ққ';
  const faces = ['700 16px "Montserrat Alternates"', '800 16px "Montserrat Alternates"', '400 16px Nunito', '700 16px Nunito'];
  if (document.fonts?.load) for (const f of faces) void document.fonts.load(f, sample).catch(() => undefined);
}

export function initUI(): void {
  warmUp();
  const root = $('ui');
  root.innerHTML = `<div id="screen"></div><div id="hud"></div><div id="hint"></div><div id="floats"></div><div id="banner" role="status"></div><div id="modal"></div><div id="toast" role="status"></div><div id="ach" role="status"></div>`;

  // одни и те же обработчики на поле, слой меню десктопа и боковые панели
  const bindRoot = (el: HTMLElement) => {
    el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t || t.tagName === 'INPUT') return;
      handleAction(t.dataset.act!, t.dataset.arg, t);
    });
    el.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.act === 'training') {
        training = t.checked;
        renderAll();
      }
      if (t.dataset.vol !== undefined) {
        sfx.unlock();
        sfx.click();
      }
    });
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.vol !== undefined) {
        const v = Number(t.value) / 100;
        store.update((s) => (s.volume = v));
        sfx.setVolume(v);
        const out = t.parentElement?.querySelector('output');
        if (out) out.textContent = `${t.value}%`;
        return;
      }
      if (t.dataset.name !== undefined) {
        const i = Number(t.dataset.name) as 0 | 1;
        store.update((s) => (s.playerNames[i] = t.value.slice(0, 16)));
      } else if (t.id === 'ed-name') {
        ed.setName(t.value);
      }
    });
  };
  for (const id of ['ui', 'overlay', 'side-l', 'side-r']) bindRoot($(id));
  placeLayers();
  onLayout(() => {
    placeLayers();
    renderAll();
  });
  bus.on('backdrop', ({ ground, far }) => drawBackdrop(ground, far));
  document.addEventListener('fullscreenchange', () => renderAll());

  bus.on('hud', (h) => {
    hud = h;
    renderHud();
  });
  bus.on('state', (s) => {
    const prev = gstate;
    gstate = s;
    if (s !== 'PAUSED') confirmRestart = false;
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
    submitToCloud(r);
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
    animateResult(r);
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
  cloud.onChange(() => {
    if (gstate === 'MENU') {
      bus.emit('look', undefined); // облачное сохранение могло сменить оформление
      renderScreen();
    }
  });
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
  window.addEventListener('keydown', onKey);

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
