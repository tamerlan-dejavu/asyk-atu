import { dateKey } from '../game/levels/daily';
import { LEVELS } from '../game/levels/levels';
import { PRO_LEVELS } from '../game/levels/levels-pro';
import { ACHIEVEMENTS, progressOf } from '../game/rules/achievements';
import { t, type Key } from '../i18n';
import { MAX_LEVEL, store } from '../storage/save';
import { esc, levelName, modeLabel, ornament, stars } from './common';
import { cloudHistoryBlock } from './cloudui';

export type RecordsTab = 'levels' | 'history' | 'stats' | 'ach';

function tabs(cur: RecordsTab): string {
  const btn = (id: RecordsTab, key: Key) =>
    `<button class="tab${cur === id ? ' on' : ''}" data-act="rtab" data-arg="${id}" role="tab" aria-selected="${cur === id}">${t(key)}</button>`;
  return `<div class="tabs" role="tablist">${btn('levels', 'tabLevels')}${btn('history', 'tabHistory')}${btn('stats', 'tabStats')}${btn('ach', 'tabAch')}</div>`;
}

function levelsTab(confirmReset: boolean): string {
  const s = store.data;
  const list = s.pro ? [...LEVELS, ...PRO_LEVELS] : LEVELS;
  const rows = list
    .map((l) => {
      const st = s.levels[String(l.id)];
      return `<tr><td>${l.id === 0 ? '★' : l.id}. ${levelName(l.id)}</td><td>${stars(st?.stars ?? 0)}</td><td class="r">${st ? st.best : '—'}</td></tr>`;
    })
    .join('');
  const daily = s.daily[dateKey()]?.best;
  return `
    <table class="tbl"><thead><tr><th></th><th>★</th><th class="r">${t('bestScore')}</th></tr></thead><tbody>${rows}</tbody></table>
    <ul class="stats">
      <li><span>${t('dailyTitle')}</span><b>${daily ?? '—'}</b></li>
      <li><span>${t('endless')}</span><b>${s.endlessBest.score > 0 ? t('endlessBest', { score: s.endlessBest.score, wave: s.endlessBest.wave }) : '—'}</b></li>
    </ul>
    ${
      confirmReset
        ? `<div class="confirm" role="alertdialog"><p>${t('resetConfirm')}</p><div class="row2"><button class="btn danger" data-act="resetYes">${t('yes')}</button><button class="btn sec" data-act="resetNo">${t('no')}</button></div></div>`
        : `<button class="btn danger" data-act="resetAsk">${t('resetProgress')}</button>`
    }`;
}

function historyTab(): string {
  const h = [...store.data.history].reverse();
  if (h.length === 0) return `<p class="small">${t('emptyList')}</p>${cloudHistoryBlock()}`;
  return `<ul class="hist">${h
    .map((e) => {
      const d = new Date(e.ts);
      const when = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const ref = e.mode === 'campaign' ? levelName(Number(e.ref.replace('L', ''))) : esc(e.ref);
      return `<li><span class="hm">${modeLabel(e.mode)}<small>${ref} · ${when}</small></span>${e.mode === 'campaign' ? stars(e.stars) : ''}<b>${e.score}</b></li>`;
    })
    .join('')}</ul>${cloudHistoryBlock()}`;
}

/** Простой график последних 10 результатов (SVG, без библиотек). */
function chart(values: number[]): string {
  if (values.length === 0) return '';
  const W = 300;
  const H = 90;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (W - 20) / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${10 + i * step},${H - 10 - (v / max) * (H - 24)}`);
  const dots = pts.map((p) => `<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3.4" fill="#0e7f7d"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('chartTitle')}"><polyline points="${pts.join(' ')}" fill="none" stroke="#0e7f7d" stroke-width="2.4" stroke-linejoin="round"/>${dots}<line x1="10" y1="${H - 10}" x2="${W - 10}" y2="${H - 10}" stroke="#9a4526" stroke-width="1.2"/></svg>`;
}

function statsTab(): string {
  const s = store.data;
  const acc = s.stats.throws > 0 ? Math.round((s.stats.hits / s.stats.throws) * 100) : 0;
  const totalStars = Object.values(s.levels).reduce((a, l) => a + l.stars, 0);
  const last = s.history.slice(-10).map((e) => e.score);
  return `
    <ul class="stats">
      <li><span>${t('statsThrows')}</span><b>${s.stats.throws}</b></li>
      <li><span>${t('statsOut')}</span><b>${s.stats.asyksOut}</b></li>
      <li><span>${t('statsAccuracy')}</span><b>${acc}%</b></li>
      <li><span>${t('statBestCombo')}</span><b>${s.counters.bestCombo}</b></li>
      <li><span>${t('statStreak')}</span><b>${s.dailyStreak.count}</b></li>
      <li><span>${t('totalStars')}</span><b>${totalStars} / ${(MAX_LEVEL + 1) * 3}</b></li>
      <li><span>${t('statCoins')}</span><b>${s.coins}</b></li>
    </ul>
    <h3>${t('chartTitle')}</h3>
    ${last.length ? chart(last) : `<p class="small">${t('emptyList')}</p>`}`;
}

function achTab(): string {
  const s = store.data;
  return `<ul class="ach-list">${ACHIEVEMENTS.map((a) => {
    const done = s.achievements[a.id] !== undefined;
    const pr = progressOf(s, a.id);
    return `<li class="${done ? 'done' : 'locked'}"><span class="aico" aria-hidden="true">${done ? a.icon : '🔒'}</span><span class="atxt"><b>${t(('ach_' + a.id) as Key)}</b><small>${t(('achDesc_' + a.id) as Key)}${pr && !done ? ` · ${pr[0]}/${pr[1]}` : ''}</small></span><span class="areward">${t('coinsEarned', { n: a.reward })}</span></li>`;
  }).join('')}</ul>`;
}

export function recordsScreen(tab: RecordsTab, confirmReset: boolean): string {
  const body = tab === 'levels' ? levelsTab(confirmReset) : tab === 'history' ? historyTab() : tab === 'stats' ? statsTab() : achTab();
  return `
  <section class="screen">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('recordsTitle')}</h2></header>
    ${ornament()}
    ${tabs(tab)}
    <div class="panel scroll">${body}</div>
  </section>`;
}
