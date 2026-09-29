import { bus, type HudData, type ResultData } from '../bus';
import { sfx } from '../audio/sfx';
import { dateKey } from '../game/levels/daily';
import { LEVELS } from '../game/levels/levels';
import type { GameState } from '../game/rules/turnState';
import { getLang, onLang, setLang, t, type Key } from '../i18n';
import { MAX_LEVEL, store } from '../storage/save';
import type { Lang, Quality } from '../types';

type Screen = 'menu' | 'levels' | 'rules' | 'records' | 'settings' | 'versus' | 'daily' | 'game';

const $ = (id: string) => document.getElementById(id)!;

let screen: Screen = 'menu';
let gstate: GameState = 'MENU';
let hud: HudData | null = null;
let tutStep = -1;
let result: ResultData | null = null;
let training = false;
let confirmReset = false;
let bannerTimer = 0;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function playerName(i: 0 | 1): string {
  const n = store.data.playerNames[i].trim();
  return n || t(i === 0 ? 'player1' : 'player2');
}

// ------------------------------------------------------------------ мелкие блоки
const HORN = `<svg class="horn" viewBox="0 0 40 30" aria-hidden="true"><path d="M2 15 C12 14 20 8 15 3 C11 0 7 6 11 8 M2 15 C10 20 18 22 19 28 C19 32 12 32 12 27" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
const ornament = () => `<div class="orn" aria-hidden="true"></div>`;

function sakaIcon(filled: boolean): string {
  return `<svg class="ico${filled ? '' : ' used'}" viewBox="0 0 30 18" aria-hidden="true"><polygon points="1,9 8,1 22,1 29,9 22,17 8,17" fill="${filled ? '#aab4bf' : 'none'}" stroke="${filled ? '#11171c' : '#f6ecd0'}" stroke-width="2"/>${filled ? '<line x1="8" y1="9" x2="22" y2="9" stroke="#16a5a3" stroke-width="2.4"/>' : ''}</svg>`;
}

function stars(n: number, big = false): string {
  let out = `<span class="stars${big ? ' big' : ''}" role="img" aria-label="${n} / 3">`;
  for (let i = 0; i < 3; i++) out += `<span class="star${i < n ? ' on' : ''}" style="--i:${i}">★</span>`;
  return out + '</span>';
}

function levelName(id: number): string {
  return t(`level${id}` as Key);
}

// ------------------------------------------------------------------ экраны
function menuScreen(): string {
  const lang = getLang();
  const langBtn = (l: Lang, label: string) => `<button class="chip${lang === l ? ' on' : ''}" data-act="lang" data-arg="${l}" aria-pressed="${lang === l}">${label}</button>`;
  return `
  <section class="screen menu">
    <div class="title-wrap">
      <div class="horns">${HORN}<span class="sp"></span>${HORN}</div>
      <h1>${t('title')}</h1>
      <p class="tag">${t('tagline')}</p>
    </div>
    <div class="stack">
      <button class="btn primary big" data-act="play">${t('play')}</button>
      <button class="btn" data-act="goto" data-arg="versus">${t('versus')}</button>
      <button class="btn" data-act="goto" data-arg="daily">${t('daily')}</button>
      <div class="row2">
        <button class="btn sec" data-act="goto" data-arg="rules">${t('howTo')}</button>
        <button class="btn sec" data-act="goto" data-arg="records">${t('records')}</button>
      </div>
    </div>
    <div class="menu-foot">
      <div class="chips" role="group" aria-label="${t('language')}">${langBtn('ru', 'RU')}${langBtn('kk', 'ҚАЗ')}${langBtn('en', 'EN')}</div>
      <div class="chips">
        <button class="chip icon${store.data.sound ? ' on' : ''}" data-act="sound" aria-pressed="${store.data.sound}" aria-label="${t('sound')}">${store.data.sound ? '🔊' : '🔇'}</button>
        <button class="chip icon" data-act="goto" data-arg="settings" aria-label="${t('settings')}">⚙</button>
      </div>
    </div>
  </section>`;
}

function levelsScreen(): string {
  const s = store.data;
  const cards = LEVELS.map((l) => {
    const st = s.levels[String(l.id)];
    const open = l.id <= s.unlocked || (training && l.id <= s.unlocked);
    const meta = l.id === 0 ? '' : `<span>${t('throwsN', { n: l.throws })}</span><span>${t('parN', { n: l.par ?? 0 })}</span>`;
    return `
    <button class="card${open ? '' : ' locked'}" data-act="level" data-arg="${l.id}" ${open ? '' : 'disabled'} aria-label="${t('levelN', { n: l.id })}: ${levelName(l.id)}${open ? '' : ' — ' + t('locked')}">
      <span class="num">${l.id === 0 ? '★' : l.id}</span>
      <span class="cname">${levelName(l.id)}</span>
      ${open ? stars(st?.stars ?? 0) : `<span class="lock" aria-hidden="true">🔒</span>`}
      <span class="cmeta">${open ? meta : t('locked')}</span>
      <span class="cbest">${open && st ? `${t('best')}: ${st.best}` : ''}</span>
    </button>`;
  }).join('');
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('chooseLevel')}</h2></header>
    ${ornament()}
    <label class="toggle"><input type="checkbox" data-act="training" ${training ? 'checked' : ''}/> <span><b>${t('training')}</b><small>${t('trainingHint')}</small></span></label>
    <div class="grid scroll">${cards}</div>
  </section>`;
}

function versusScreen(): string {
  const n = store.data.playerNames;
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('versusTitle')}</h2></header>
    ${ornament()}
    <div class="panel">
      <p>${t('versusHint')}</p>
      <label class="field p1"><span>${t('versusNames')} — 1</span><input data-name="0" maxlength="16" value="${esc(n[0])}" placeholder="${t('player1')}" autocomplete="off"/></label>
      <label class="field p2"><span>${t('versusNames')} — 2</span><input data-name="1" maxlength="16" value="${esc(n[1])}" placeholder="${t('player2')}" autocomplete="off"/></label>
      <button class="btn primary big" data-act="startVersus">${t('startGame')}</button>
    </div>
  </section>`;
}

function dailyScreen(): string {
  const best = store.data.daily[dateKey()]?.best;
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('dailyTitle')}</h2></header>
    ${ornament()}
    <div class="panel">
      <p class="date">${dateKey()}</p>
      <p>${t('dailyHint')}</p>
      <p><b>${best !== undefined ? t('dailyBest', { n: best }) : t('dailyNone')}</b></p>
      <button class="btn primary big" data-act="startDaily">${t('play')}</button>
    </div>
  </section>`;
}

const svgField = `<svg viewBox="0 0 120 150" class="illus" role="img" aria-hidden="true"><rect width="120" height="150" rx="8" fill="#c8975a"/><circle cx="60" cy="52" r="38" fill="rgba(122,70,28,.25)" stroke="#0e7f7d" stroke-width="3"/>${[[42, 46, 0], [60, 46, 0], [78, 46, 0], [50, 62, 0], [70, 62, 0]].map(([x, y]) => `<polygon points="${x - 8},${y} ${x - 4},${y - 4} ${x + 4},${y - 4} ${x + 8},${y} ${x + 4},${y + 4} ${x - 4},${y + 4}" fill="#f6ecd0" stroke="#4b3018" stroke-width="1.2"/>`).join('')}<line x1="8" y1="128" x2="112" y2="128" stroke="#16a5a3" stroke-width="2" stroke-dasharray="5 4"/><polygon points="46,126 52,118 68,118 74,126 68,134 52,134" fill="#aab4bf" stroke="#11171c" stroke-width="1.6"/></svg>`;
const svgPull = `<svg viewBox="0 0 120 150" class="illus" role="img" aria-hidden="true"><rect width="120" height="150" rx="8" fill="#c8975a"/><polygon points="46,86 52,78 68,78 74,86 68,94 52,94" fill="#aab4bf" stroke="#11171c" stroke-width="1.6"/><line x1="60" y1="70" x2="60" y2="24" stroke="#e5482f" stroke-width="4" stroke-dasharray="8 6"/><polygon points="60,12 50,28 70,28" fill="#e5482f"/><circle cx="60" cy="126" r="9" fill="#f6ecd0" stroke="#4b3018" stroke-width="2"/><line x1="60" y1="94" x2="60" y2="117" stroke="#f6ecd0" stroke-width="3"/></svg>`;
const svgOut = `<svg viewBox="0 0 120 150" class="illus" role="img" aria-hidden="true"><rect width="120" height="150" rx="8" fill="#c8975a"/><circle cx="60" cy="80" r="42" fill="rgba(122,70,28,.25)" stroke="#0e7f7d" stroke-width="3"/><polygon points="52,78 57,73 67,73 72,78 67,83 57,83" fill="#f6ecd0" stroke="#4b3018" stroke-width="1.4"/><polygon points="88,28 93,23 103,23 108,28 103,33 93,33" fill="#f6ecd0" stroke="#4b3018" stroke-width="1.4" opacity=".6"/><circle cx="98" cy="28" r="2.6" fill="#e5482f"/><path d="M66 74 L92 34" stroke="#e5482f" stroke-width="2.4" stroke-dasharray="4 4" fill="none"/></svg>`;

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
      <article class="rule"><div class="illus-text" aria-hidden="true">★★★</div><div><h3>${t('rulesStars')}</h3><p>${t('rulesStarsText')}</p></div></article>
      <article class="rule"><div class="illus-text" aria-hidden="true">1 ⇄ 2</div><div><h3>${t('rulesVersus')}</h3><p>${t('rulesVersusText')}</p></div></article>
    </div>
  </section>`;
}

function recordsScreen(): string {
  const s = store.data;
  const rows = LEVELS.map((l) => {
    const st = s.levels[String(l.id)];
    return `<tr><td>${l.id === 0 ? '★' : l.id}. ${levelName(l.id)}</td><td>${stars(st?.stars ?? 0)}</td><td class="r">${st ? st.best : '—'}</td></tr>`;
  }).join('');
  const acc = s.stats.throws > 0 ? Math.round((s.stats.hits / s.stats.throws) * 100) : 0;
  const totalStars = Object.values(s.levels).reduce((a, l) => a + l.stars, 0);
  const daily = s.daily[dateKey()]?.best;
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('recordsTitle')}</h2></header>
    ${ornament()}
    <div class="panel scroll">
      <table class="tbl"><thead><tr><th></th><th>★</th><th class="r">${t('bestScore')}</th></tr></thead><tbody>${rows}</tbody></table>
      <ul class="stats">
        <li><span>${t('totalStars')}</span><b>${totalStars} / ${(MAX_LEVEL + 1) * 3}</b></li>
        <li><span>${t('statsThrows')}</span><b>${s.stats.throws}</b></li>
        <li><span>${t('statsOut')}</span><b>${s.stats.asyksOut}</b></li>
        <li><span>${t('statsAccuracy')}</span><b>${acc}%</b></li>
        <li><span>${t('dailyTitle')}</span><b>${daily ?? '—'}</b></li>
      </ul>
      ${
        confirmReset
          ? `<div class="confirm" role="alertdialog"><p>${t('resetConfirm')}</p><div class="row2"><button class="btn danger" data-act="resetYes">${t('yes')}</button><button class="btn sec" data-act="resetNo">${t('no')}</button></div></div>`
          : `<button class="btn danger" data-act="resetAsk">${t('resetProgress')}</button>`
      }
    </div>
  </section>`;
}

function settingsScreen(): string {
  const lang = getLang();
  const q = store.data.quality;
  const opt = (act: string, arg: string, label: string, on: boolean) => `<button class="chip wide${on ? ' on' : ''}" data-act="${act}" data-arg="${arg}" aria-pressed="${on}">${label}</button>`;
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('settingsTitle')}</h2></header>
    ${ornament()}
    <div class="panel">
      <h3>${t('language')}</h3>
      <div class="chips">${opt('lang', 'ru', 'RU', lang === 'ru')}${opt('lang', 'kk', 'ҚАЗ', lang === 'kk')}${opt('lang', 'en', 'EN', lang === 'en')}</div>
      <h3>${t('sound')}</h3>
      <div class="chips">${opt('soundSet', '1', t('on'), store.data.sound)}${opt('soundSet', '0', t('off'), !store.data.sound)}</div>
      <h3>${t('quality')}</h3>
      <div class="chips">${opt('quality', 'auto', t('qualityAuto'), q === 'auto')}${opt('quality', 'high', t('qualityHigh'), q === 'high')}${opt('quality', 'low', t('qualityLow'), q === 'low')}</div>
      <p class="small">${t('qualityHint')}</p>
    </div>
  </section>`;
}

// ------------------------------------------------------------------ HUD
function hudHtml(): string {
  if (!hud || gstate === 'MENU') return '';
  const h = hud;
  if (h.mode === 'versus') {
    const chip = (i: 0 | 1) => {
      const active = h.player === i;
      const left = h.versusLeft[i];
      let ic = '';
      for (let k = 0; k < 6; k++) ic += sakaIcon(k < left);
      return `<div class="pchip p${i + 1}${active ? ' active' : ''}"><b class="pn">${esc(playerName(i))}</b><span class="ps">${h.scores[i]}</span><span class="icons">${ic}</span></div>`;
    };
    return `<div class="hud versus"><button class="btn icon-btn" data-act="pause" aria-label="${t('pause')}">❚❚</button>${chip(0)}${chip(1)}</div>`;
  }
  let icons = '';
  if (Number.isFinite(h.throwsTotal)) {
    for (let k = 0; k < h.throwsTotal; k++) icons += sakaIcon(k < h.throwsLeft);
  } else icons = `<span class="inf">${t('unlimited')}</span>`;
  const title =
    h.mode === 'daily' ? t('dailyTitle') : h.mode === 'training' ? `${t('training')} · ${levelName(h.levelId)}` : `${h.levelId === 0 ? levelName(0) : t('levelTitle', { n: h.levelId }) + ' · ' + levelName(h.levelId)}`;
  return `<div class="hud"><button class="btn icon-btn" data-act="pause" aria-label="${t('pause')}">❚❚</button>
    <div class="hmid"><div class="hname">${title}</div><div class="icons" aria-label="${t('throwsLeft')}">${icons}</div></div>
    <div class="hscore"><span>${t('score')}</span><b>${h.score}</b></div></div>`;
}

function hintHtml(): string {
  if (!hud || gstate !== 'AIMING') return '';
  if (tutStep >= 0) {
    const key = (['tut1', 'tut2', 'tut3', 'tut4'] as const)[Math.min(3, tutStep)];
    return `<div class="tut"><div class="tut-text" role="status">${t(key)}</div>${tutStep === 0 ? `<div class="ghost" aria-hidden="true"><i></i></div>` : ''}<button class="btn sec sm skip" data-act="skipTut">${t('skipTutorial')}</button></div>`;
  }
  if (hud.showHint && hud.mode !== 'versus') return `<div class="hint" role="status">${t('hintPull')}</div>`;
  if (hud.showHint) return `<div class="hint" role="status">${t('hintPull')}</div>`;
  return '';
}

function tutInFlight(): string {
  // подсказки обучения во время полёта и в паузах между бросками
  if (tutStep < 0 || gstate === 'AIMING' || gstate === 'PAUSED' || gstate === 'LEVEL_INTRO' || gstate === 'MENU') return '';
  if (gstate === 'LEVEL_COMPLETE' || gstate === 'LEVEL_FAILED') return '';
  const key = (['tut1', 'tut2', 'tut3', 'tut4'] as const)[Math.min(3, tutStep)];
  return `<div class="tut"><div class="tut-text" role="status">${t(key)}</div></div>`;
}

// ------------------------------------------------------------------ модалки
function pauseModal(): string {
  return `<div class="modal"><div class="panel pop">
    <h2>${t('paused')}</h2>${ornament()}
    <div class="stack">
      <button class="btn primary big" data-act="resume">${t('resume')}</button>
      <button class="btn" data-act="restart">${t('restart')}</button>
      <div class="row2">
        <button class="btn sec" data-act="sound">${store.data.sound ? '🔊' : '🔇'} ${t('sound')}</button>
        <button class="btn sec" data-act="quit">${t('toMenu')}</button>
      </div>
    </div></div></div>`;
}

function resultModal(r: ResultData): string {
  const s = r.summary;
  if (s.mode === 'versus') {
    const title = s.winner === -1 ? t('draw') : t('winnerIs', { name: esc(playerName(s.winner as 0 | 1)) });
    return `<div class="modal"><div class="panel pop result">
      <h2>${title}</h2>${ornament()}
      <p class="small">${t('finalScore')}</p>
      <ul class="stats big">
        <li class="p1${s.winner === 0 ? ' win' : ''}"><span>${esc(playerName(0))}</span><b>${s.scores[0]}</b></li>
        <li class="p2${s.winner === 1 ? ' win' : ''}"><span>${esc(playerName(1))}</span><b>${s.scores[1]}</b></li>
      </ul>
      <div class="stack"><button class="btn primary" data-act="restart">${t('retry')}</button><button class="btn sec" data-act="quit">${t('toMenu')}</button></div>
    </div></div>`;
  }
  const win = s.cleared;
  const lines = [
    `<li><span>${t('knocked', { a: s.asykOut, b: s.asykTotal })}</span></li>`,
    Number.isFinite(s.throwsAllowed) ? `<li><span>${t('throwsUsed', { a: s.throwsUsed, b: s.throwsAllowed })}</span></li>` : '',
    s.bestCombo >= 2 ? `<li><span>${t('bestCombo', { n: s.bestCombo })}</span></li>` : '',
    s.bonus > 0 ? `<li class="bonus"><span>${t('economy', { n: s.bonus })}</span></li>` : '',
  ].join('');
  const showStars = s.mode === 'campaign' || s.mode === 'training';
  const best = s.mode === 'daily' && r.dailyBest !== undefined ? `<p class="small">${t('dailyBest', { n: r.dailyBest })}</p>` : '';
  return `<div class="modal"><div class="panel pop result ${win ? 'win' : 'lose'}">
    <h2>${win ? t('victory') : t('defeat')}</h2>${ornament()}
    ${showStars && s.mode === 'campaign' ? stars(s.stars, true) : ''}
    ${!win ? `<p class="small">${t('defeatHint')}</p>` : ''}
    <ul class="lines">${lines}</ul>
    <p class="total">${t('totalScore', { n: s.score })}</p>
    ${r.newRecord ? `<p class="badge">${t('newRecord')}</p>` : ''}
    ${best}
    <div class="stack">
      ${r.hasNext ? `<button class="btn primary big" data-act="next">${t('nextLevel')}</button>` : ''}
      <div class="row2"><button class="btn${r.hasNext ? ' sec' : ' primary'}" data-act="restart">${t('retry')}</button><button class="btn sec" data-act="quit">${t('toMenu')}</button></div>
    </div></div></div>`;
}

// ------------------------------------------------------------------ рендер
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
    rules: rulesScreen,
    records: recordsScreen,
    settings: settingsScreen,
    versus: versusScreen,
    daily: dailyScreen,
    game: () => '',
  };
  const keepScroll = el.querySelector('.scroll')?.scrollTop ?? 0;
  el.innerHTML = map[screen]();
  el.classList.add('shown');
  const sc = el.querySelector('.scroll');
  if (sc) sc.scrollTop = keepScroll;
}

function renderHud(): void {
  $('hud').innerHTML = hudHtml();
  $('hint').innerHTML = hintHtml() || tutInFlight();
}

function renderModal(): void {
  const el = $('modal');
  if (gstate === 'PAUSED') el.innerHTML = pauseModal();
  else if (result && (gstate === 'LEVEL_COMPLETE' || gstate === 'LEVEL_FAILED')) el.innerHTML = resultModal(result);
  else el.innerHTML = '';
}

function renderAll(): void {
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

// ------------------------------------------------------------------ действия
function startCampaign(levelId: number): void {
  result = null;
  bus.emit('start', { mode: training ? 'training' : 'campaign', levelId });
}

function handleAction(act: string, arg: string | undefined): void {
  sfx.unlock();
  switch (act) {
    case 'play':
      sfx.click();
      if (!store.data.tutorialDone) {
        training = false;
        startCampaign(0);
      } else {
        screen = 'levels';
        renderAll();
      }
      break;
    case 'goto':
      sfx.click();
      screen = arg as Screen;
      confirmReset = false;
      renderAll();
      break;
    case 'level':
      sfx.click();
      startCampaign(Number(arg));
      break;
    case 'startVersus':
      result = null;
      bus.emit('start', { mode: 'versus', levelId: 100 });
      break;
    case 'startDaily':
      result = null;
      bus.emit('start', { mode: 'daily', levelId: 200 });
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
      bus.emit('restart', undefined);
      break;
    case 'next':
      result = null;
      bus.emit('next', undefined);
      break;
    case 'quit': {
      const mode = hud?.mode;
      result = null;
      screen = mode === 'campaign' || mode === 'training' ? 'levels' : 'menu';
      bus.emit('toMenu', undefined);
      break;
    }
    case 'skipTut':
      screen = 'levels';
      bus.emit('skipTutorial', undefined);
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
      renderAll();
      break;
  }
}

export function initUI(): void {
  const root = $('ui');
  root.innerHTML = `<div id="screen"></div><div id="hud"></div><div id="hint"></div><div id="floats"></div><div id="banner" role="status"></div><div id="modal"></div>`;

  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    handleAction(el.dataset.act!, el.dataset.arg);
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
    }
    if (s === 'LEVEL_INTRO' && hud) {
      flash(hud.mode === 'versus' ? t('versusTitle') : hud.mode === 'daily' ? t('dailyTitle') : hud.levelId === 0 ? levelName(0) : `${t('levelTitle', { n: hud.levelId })} · ${levelName(hud.levelId)}`, 900);
    }
    if (prev === 'PAUSED' || s === 'PAUSED' || s === 'MENU' || prev === 'MENU' || s === 'LEVEL_COMPLETE' || s === 'LEVEL_FAILED' || prev === 'LEVEL_COMPLETE' || prev === 'LEVEL_FAILED') renderAll();
    else renderHud();
  });
  bus.on('tutorial', ({ step }) => {
    tutStep = step;
    renderHud();
  });
  bus.on('turn', ({ player }) => flash(t('turnOf', { name: playerName(player) }), 1100));
  bus.on('result', (r) => {
    result = r;
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
  bus.on('toast', () => undefined);

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

  renderAll();
}
