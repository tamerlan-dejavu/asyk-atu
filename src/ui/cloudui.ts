import { cloud, type AuthError, type BoardRow } from '../cloud/cloud';
import { dateKey } from '../game/levels/daily';
import { LEVELS } from '../game/levels/levels';
import { PRO_LEVELS } from '../game/levels/levels-pro';
import { t, type Key } from '../i18n';
import { store } from '../storage/save';
import { cloudKey } from '../game/rules/ruleset';
import { BUILD } from '../util/build';
import { levelName, ornament, stars, toast, u } from './common';

export type LbTab = 'daily' | 'endless' | 'level';

interface UiState {
  authMode: 'register' | 'login';
  confirmDelete: boolean;
  busy: boolean;
  lbTab: LbTab;
  lbLevel: number;
  lbRows: BoardRow[] | null | 'loading' | 'error';
  cloudHist: { ts: number; mode: string; key: string; score: number; stars: number }[] | null;
}

export const cu: UiState = {
  authMode: 'register',
  confirmDelete: false,
  busy: false,
  lbTab: 'daily',
  lbLevel: 1,
  lbRows: null,
  cloudHist: null,
};

const ERR_KEY: Record<AuthError, Key> = {
  invalid: 'errInvalid',
  taken: 'errTaken',
  weak: 'errWeak',
  exists: 'errExists',
  credentials: 'errCredentials',
  network: 'errNetwork',
  limit: 'errLimit',
};
export const authErrorText = (e: AuthError): string => t(e === 'invalid' ? 'errInvalid' : ERR_KEY[e]);

/** Статус синхронизации — ненавязчивая строка (меню, профиль). */
export function syncLabel(): string {
  if (!cloud.signedIn) return '';
  const key: Key | null =
    cloud.sync === 'saved'
      ? 'syncSaved'
      : cloud.sync === 'saving'
        ? 'syncSaving'
        : cloud.sync === 'offline'
          ? 'syncOffline'
          : cloud.sync === 'error'
            ? 'syncError'
            : null;
  if (!key) return '';
  const icon = cloud.sync === 'saved' ? '☁✓' : cloud.sync === 'saving' ? '☁…' : '☁✕';
  return `<span class="syncbadge s-${cloud.sync}" role="status">${icon} ${t(key)}</span>`;
}

export function aboutBlock(): string {
  const time = BUILD.time ? BUILD.time.replace('T', ' ').slice(0, 16) + ' UTC' : '—';
  return `<h3>${t('about')}</h3><p class="small mono">${t('buildInfo', { sha: BUILD.sha, time })}</p>`;
}

// ------------------------------------------------------------------ профиль
export function profileScreen(): string {
  const header = `<header class="bar"><button class="btn sec sm" data-act="goto" data-arg="menu">← ${t('back')}</button><h2>${t('profileTitle')}</h2></header>${ornament()}`;
  if (cloud.status === 'connecting')
    return `<section class="screen">${header}<div class="panel"><p>${t('cloudConnecting')}</p></div></section>`;
  if (!cloud.ready) return `<section class="screen">${header}<div class="panel"><p>${t('cloudOff')}</p></div></section>`;
  const busy = cu.busy ? 'aria-disabled="true"' : '';
  const authForm = (primaryKey: Key, act: string, withSwitch: boolean) => `
    <label class="field"><span>${t('email')}</span><input id="pf-email" type="email" autocomplete="email" maxlength="120"/></label>
    <label class="field"><span>${t('password')}</span><input id="pf-pass" type="password" autocomplete="${act === 'pfLogin' ? 'current-password' : 'new-password'}" maxlength="72"/></label>
    <button class="btn primary" data-act="${act}" ${busy}>${t(primaryKey)}</button>
    ${withSwitch ? `<button class="btn sec sm" data-act="pfSwitch">${t(cu.authMode === 'register' ? 'haveAccount' : 'noAccount')}</button>` : ''}`;

  if (!cloud.user) {
    return `<section class="screen">${header}<div class="panel scroll">
      <p>${t('cloudIntro')}</p>
      <button class="btn primary big" data-act="pfGuest" ${busy}>☁ ${t('guestLogin')}</button>
      <p class="small">${t('guestHint')}</p>
      <hr/>
      ${cu.authMode === 'register' ? authForm('register', 'pfRegister', true) : authForm('login', 'pfLogin', true)}
    </div></section>`;
  }
  const me = cloud.user;
  const who = me.anonymous ? `${u(me.nickname ?? '—')} · ${t('guestAccount')}` : `${u(me.nickname ?? '—')} · ${u(me.email ?? '')}`;
  const del = cu.confirmDelete
    ? `<div class="confirm" role="alertdialog"><p>${t('deleteConfirm')}</p><div class="row2"><button class="btn danger" data-act="pfDeleteYes">${t('yes')}</button><button class="btn sec" data-act="pfDeleteNo">${t('no')}</button></div></div>`
    : `<button class="btn danger sm" data-act="pfDeleteAsk">${t('deleteAccount')}</button>`;
  return `<section class="screen">${header}<div class="panel scroll">
    <p><b>${t('signedInAs', { name: who })}</b></p>
    ${syncLabel()}
    <label class="field"><span>${t('nickname')}</span><input id="pf-nick" maxlength="16" autocomplete="nickname"/></label>
    <button class="btn" data-act="pfNick" ${busy}>${t('nickSave')}</button>
    ${me.anonymous ? `<hr/><h3>${t('saveProgress')}</h3><p class="small">${t('saveProgressHint')}</p>${authForm('saveProgress', 'pfRegister', false)}` : ''}
    <hr/>
    <div class="row2"><button class="btn sec" data-act="pfLogout" ${busy}>${t('logout')}</button>${del}</div>
  </div></section>`;
}

/** Значения полей профиля выставляются из данных через value (не через разметку). */
export function bindProfile(root: HTMLElement): void {
  const nick = root.querySelector<HTMLInputElement>('#pf-nick');
  if (nick && cloud.user) nick.value = cloud.user.nickname ?? '';
}

async function run(rerender: () => void, fn: () => Promise<AuthError | null>, okKey?: Key): Promise<void> {
  if (cu.busy) return;
  cu.busy = true;
  rerender();
  const err = await fn();
  cu.busy = false;
  if (err) toast(authErrorText(err), 3500);
  else if (okKey) toast(t(okKey));
  rerender();
}

/** Действия профиля. Возвращает true, если действие обработано. */
export function handleCloudAction(act: string, arg: string | undefined, root: HTMLElement, rerender: () => void): boolean {
  const val = (id: string) => root.querySelector<HTMLInputElement>(id)?.value.trim() ?? '';
  switch (act) {
    case 'pfGuest':
      void run(rerender, () => cloud.signInGuest());
      return true;
    case 'pfSwitch':
      cu.authMode = cu.authMode === 'register' ? 'login' : 'register';
      rerender();
      return true;
    case 'pfRegister': {
      const email = val('#pf-email');
      const pass = root.querySelector<HTMLInputElement>('#pf-pass')?.value ?? '';
      if (!/^\S+@\S+\.\S+$/.test(email) || pass.length < 6) {
        toast(t(pass.length < 6 ? 'errWeak' : 'errInvalid'));
        return true;
      }
      void run(rerender, () => cloud.register(email, pass), 'syncSaved');
      return true;
    }
    case 'pfLogin': {
      const email = val('#pf-email');
      const pass = root.querySelector<HTMLInputElement>('#pf-pass')?.value ?? '';
      void run(rerender, () => cloud.signIn(email, pass));
      return true;
    }
    case 'pfLogout':
      void run(rerender, async () => (await cloud.signOut(), null));
      return true;
    case 'pfNick':
      void run(rerender, () => cloud.setNickname(val('#pf-nick')), 'nickSaved');
      return true;
    case 'pfDeleteAsk':
      cu.confirmDelete = true;
      rerender();
      return true;
    case 'pfDeleteNo':
      cu.confirmDelete = false;
      rerender();
      return true;
    case 'pfDeleteYes':
      cu.confirmDelete = false;
      void run(rerender, async () => ((await cloud.deleteAccount()) ? null : 'network'), 'deleted');
      return true;
    case 'lbTab':
      cu.lbTab = arg as LbTab;
      void loadBoard(rerender);
      return true;
    case 'lbLevel':
      cu.lbLevel = Number(arg);
      void loadBoard(rerender);
      return true;
    case 'lbGuest':
      void run(rerender, async () => {
        const e = await cloud.signInGuest();
        if (!e) void loadBoard(rerender);
        return e;
      });
      return true;
  }
  return false;
}

// ------------------------------------------------------------------ рейтинг
export async function loadBoard(rerender: () => void): Promise<void> {
  if (!cloud.signedIn) {
    cu.lbRows = null;
    rerender();
    return;
  }
  cu.lbRows = 'loading';
  rerender();
  const [mode, key] =
    cu.lbTab === 'daily'
      ? (['daily', `daily:${dateKey()}`] as const)
      : cu.lbTab === 'endless'
        ? (['endless', 'endless'] as const)
        : (['level', `level:${cu.lbLevel}`] as const);
  const rows = await cloud.leaderboard(mode, cloudKey(key, store.data.ruleset));
  cu.lbRows = rows ?? 'error';
  rerender();
}

export function boardTable(rows: BoardRow[] | null | 'loading' | 'error', withStars = false): string {
  if (rows === 'loading')
    return `<ul class="board skeleton" aria-busy="true">${'<li><span></span><span></span><span></span></li>'.repeat(6)}</ul>`;
  if (rows === 'error') return `<p class="small">${t('errNetwork')}</p>`;
  if (!rows || rows.length === 0) return `<p class="small">${t('lbEmpty')}</p>`;
  return `<ol class="board">${rows
    .map(
      (r) =>
        `<li class="${r.isMe ? 'me' : ''}"><span class="pl">${r.place}</span><span class="nk">${u(r.nickname)}${r.isMe ? ` <small>(${t('lbYou')})</small>` : ''}${r.verified ? ` <small class="ver">✓ ${t('lbVerified')}</small>` : ''}</span>${withStars && r.stars !== null ? stars(r.stars) : ''}<b>${r.score}</b></li>`,
    )
    .join('')}</ol>`;
}

export function leaderboardScreen(): string {
  const tab = (id: LbTab, key: Key) =>
    `<button class="tab${cu.lbTab === id ? ' on' : ''}" data-act="lbTab" data-arg="${id}" role="tab" aria-selected="${cu.lbTab === id}">${t(key)}</button>`;
  const header = `<header class="bar"><button class="btn sec sm" data-act="goto" data-arg="modes">← ${t('back')}</button><h2>${t('leaderboard')}</h2></header>${ornament()}`;
  if (!cloud.ready)
    return `<section class="screen">${header}<div class="panel"><p>${cloud.status === 'connecting' ? t('cloudConnecting') : t('cloudOff')}</p></div></section>`;
  let body: string;
  if (!cloud.signedIn) {
    body = `<p>${t('lbLoginHint')}</p><button class="btn primary" data-act="lbGuest">☁ ${t('guestLogin')}</button>`;
  } else {
    const levels = [...LEVELS.filter((l) => l.id > 0), ...(store.data.pro ? PRO_LEVELS : [])];
    const picker =
      cu.lbTab === 'level'
        ? `<div class="chips lvpick">${levels.map((l) => `<button class="chip${cu.lbLevel === l.id ? ' on' : ''}" data-act="lbLevel" data-arg="${l.id}" aria-label="${levelName(l.id)}">${l.id}</button>`).join('')}</div><p class="small">${levelName(cu.lbLevel)}</p>`
        : '';
    body = `${picker}${boardTable(cu.lbRows, cu.lbTab === 'level')}`;
  }
  return `<section class="screen">${header}<div class="tabs" role="tablist">${tab('daily', 'lbToday')}${tab('endless', 'lbEndless')}${tab('level', 'lbLevels')}</div><div class="panel scroll">${body}</div></section>`;
}

// ------------------------------------------------------------------ облачная история
export async function loadCloudHistory(rerender: () => void): Promise<void> {
  if (!cloud.signedIn) return;
  const h = await cloud.history();
  if (h) {
    cu.cloudHist = h;
    rerender();
  }
}

export function cloudHistoryBlock(): string {
  if (!cloud.signedIn || !cu.cloudHist) return '';
  if (cu.cloudHist.length === 0) return '';
  return `<h3>☁ ${t('cloudHistory')}</h3><ul class="hist">${cu.cloudHist
    .map((e) => {
      const d = new Date(e.ts);
      const when = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = e.key.startsWith('level:')
        ? levelName(Number(e.key.slice(6)))
        : e.mode === 'daily'
          ? `${t('daily')} ${e.key.slice(6)}`
          : e.mode === 'endless'
            ? t('endless')
            : t('custom');
      return `<li><span class="hm">${label}<small>${when}</small></span>${e.mode === 'level' ? stars(e.stars) : ''}<b>${e.score}</b></li>`;
    })
    .join('')}</ul>`;
}
