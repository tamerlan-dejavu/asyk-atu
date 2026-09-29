import {
  cleanName,
  decodeChallenge,
  defaultPar,
  encodeChallenge,
  MAX_ASYKS,
  MAX_BLOCKS,
  MAX_THROWS,
  MIN_THROWS,
  quantize,
  validateLayout,
  type Challenge,
} from '../challenge/codec';
import { ASYK, BLOCK, ZONE } from '../game/config';
import { bonePolygon } from '../game/physics/bodies';
import { t } from '../i18n';
import type { AsykSpec, AsykType } from '../types';
import { ornament } from './common';

/** Черновик редактируемого испытания (живёт, пока открыта страница). */
export interface Draft {
  /** id в «Моих испытаниях», если редактируем сохранённое */
  id: string | null;
  name: string;
  throws: number;
  par: number;
  parAuto: boolean;
  asyks: AsykSpec[];
  /** ключ расстановки, которую автор уже прошёл */
  verifiedKey: string | null;
}

const SNAP = 4;
const VB = { x: ZONE.x - ZONE.r - 14, y: ZONE.y - ZONE.r - 14, s: (ZONE.r + 14) * 2 };
const MAX_OBJECTS = MAX_ASYKS + MAX_BLOCKS;

export let draft: Draft = newDraft();
let selected: number | null = null;

export function newDraft(): Draft {
  return { id: null, name: '', throws: 6, par: 4, parAuto: true, asyks: [], verifiedKey: null };
}

export function resetDraft(d?: Draft): void {
  draft = d ?? newDraft();
  selected = null;
}

export function loadFromCode(code: string, id: string | null, verified: boolean): boolean {
  const r = decodeChallenge(code);
  if (!r.ok) return false;
  const c = r.challenge;
  const d: Draft = { id, name: c.name, throws: c.throws, par: c.par, parAuto: false, asyks: c.asyks.map((a) => ({ ...a })), verifiedKey: null };
  if (verified) d.verifiedKey = layoutKey(d);
  resetDraft(d);
  return true;
}

/** Ключ расстановки: изменение объектов или числа бросков сбрасывает «пройдено». */
export function layoutKey(d: Draft = draft): string {
  return JSON.stringify([d.throws, d.asyks.map((a) => quantize(a))]);
}

export const isVerified = (): boolean => draft.verifiedKey !== null && draft.verifiedKey === layoutKey();
export function markVerified(): void {
  draft.verifiedKey = layoutKey();
}

export function realCount(d: Draft = draft): number {
  return d.asyks.filter((a) => a.type !== 'block').length;
}

export function toChallenge(d: Draft = draft): Challenge {
  return { name: cleanName(d.name) || t('namePlaceholder'), throws: d.throws, par: d.par, asyks: d.asyks.map(quantize) };
}

export function currentCode(): string {
  return encodeChallenge(toChallenge());
}

function autoPar(): void {
  if (draft.parAuto) draft.par = Math.min(draft.throws, defaultPar(draft.throws, Math.max(1, realCount())));
}

// ---------------------------------------------------------------- отрисовка
function shape(a: AsykSpec, i: number, bad: boolean): string {
  const type = a.type ?? 'normal';
  const deg = (a.angle * 180) / Math.PI;
  const cls = `obj t-${type}${bad ? ' bad' : ''}${selected === i ? ' sel' : ''}`;
  let body: string;
  if (type === 'block') {
    const s = BLOCK.size;
    body = `<rect x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" rx="${BLOCK.radius}"/><path d="M0 -10 L10 0 L0 10 L-10 0Z" class="orn"/>`;
  } else {
    const pts = bonePolygon(ASYK.w, ASYK.h)
      .map((p) => `${p.x},${p.y}`)
      .join(' ');
    body = `<polygon points="${pts}"/>${type === 'heavy' ? `<rect x="${-ASYK.w / 2 + 8}" y="-3" width="${ASYK.w - 16}" height="6" class="stripe"/>` : ''}`;
  }
  return `<g class="${cls}" data-i="${i}" transform="translate(${a.x} ${a.y}) rotate(${deg})">${body}<circle r="${type === 'block' ? 26 : 30}" class="hit"/></g>`;
}

function stepper(act: string, label: string, value: number): string {
  return `<div class="stepper"><span>${label}</span><button class="btn sec sm" data-act="${act}" data-arg="-1" aria-label="−">−</button><b>${value}</b><button class="btn sec sm" data-act="${act}" data-arg="1" aria-label="+">+</button></div>`;
}

function issueText(): { text: string; error: boolean } {
  const v = validateLayout(draft.asyks);
  if (v.tooFew) return { text: t('errFew'), error: draft.asyks.length > 0 };
  if (v.tooMany) return { text: t('errMany'), error: true };
  if (v.tooManyBlocks) return { text: t('errBlocks'), error: true };
  if (v.bad.size > 0) return { text: t('errOverlap'), error: true };
  return { text: '', error: false };
}

export function editorScreen(): string {
  const v = validateLayout(draft.asyks);
  const issue = issueText();
  const verified = isVerified();
  const canTest = v.ok;
  const canShare = v.ok && verified;
  const tool = (act: string, arg: string, label: string, cls = '') =>
    `<button class="btn sec sm tool ${cls}" data-act="${act}" data-arg="${arg}">${label}</button>`;
  return `
  <section class="screen editor">
    <header class="bar"><button class="btn sec sm" data-act="goto" data-arg="modes">← ${t('back')}</button><h2>${t('editor')}</h2></header>
    ${ornament()}
    <div class="panel scroll">
      <svg id="ed-svg" class="ed-field" viewBox="${VB.x} ${VB.y} ${VB.s} ${VB.s}" role="application" aria-label="${t('editor')}">
        <circle cx="${ZONE.x}" cy="${ZONE.y}" r="${ZONE.r}" class="zone"/>
        <g id="ed-objs">${draft.asyks.map((a, i) => shape(a, i, v.bad.has(i))).join('')}</g>
      </svg>
      <p id="ed-msg" class="ed-msg${issue.error ? ' err' : ''}" role="status">${issue.text || t('editorHint')}</p>
      <div class="tools">
        ${tool('edAdd', 'normal', '+ ' + t('addAsyk'))}${tool('edAdd', 'golden', '+ ' + t('addGolden'), 'gold')}${tool('edAdd', 'heavy', '+ ' + t('addHeavy'), 'hv')}${tool('edAdd', 'block', '+ ' + t('addBlock'), 'bl')}
      </div>
      <div class="tools">
        <button class="btn sec sm tool" data-act="edRot" data-arg="-15" aria-label="${t('rotateLeft')}">↺</button>
        <button class="btn sec sm tool" data-act="edRot" data-arg="15" aria-label="${t('rotateRight')}">↻</button>
        <button class="btn sec sm tool" data-act="edDel" aria-label="${t('delete')}">🗑 ${t('delete')}</button>
        <button class="btn sec sm tool" data-act="edClear">${t('clearAll')}</button>
      </div>
      <label class="field"><span>${t('nameLabel')}</span><input id="ed-name" maxlength="24" placeholder="${t('namePlaceholder')}" autocomplete="off"/></label>
      <div class="row2">${stepper('edThrows', t('throwsLabel'), draft.throws)}${stepper('edPar', t('parLabel'), draft.par)}</div>
      <p class="small vbadge ${verified ? 'ok' : ''}">${verified ? '✓ ' + t('verified') : t('notVerified')}</p>
      <div class="stack tight">
        <button class="btn primary" data-act="edTest" ${canTest ? '' : 'aria-disabled="true"'}>${t('test')}</button>
        <div class="row2">
          <button class="btn" data-act="edSave" ${canTest ? '' : 'aria-disabled="true"'}>${t('save')}</button>
          <button class="btn" data-act="edShare" ${canShare ? '' : 'aria-disabled="true"'}>${t('share')}</button>
        </div>
        ${canTest && !verified ? `<small class="hintline">${t('shareLocked')}</small>` : ''}
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- действия
function freeSpot(type: AsykType): AsykSpec {
  const base: AsykSpec = { x: ZONE.x, y: ZONE.y, angle: 0, type };
  const tryAt = (x: number, y: number): boolean => {
    const cand = quantize({ ...base, x, y });
    const list = [...draft.asyks, cand];
    return !validateLayout(list).bad.has(list.length - 1);
  };
  if (tryAt(ZONE.x, ZONE.y)) return quantize(base);
  for (let r = 40; r <= ZONE.r - 30; r += 32) {
    const n = Math.max(6, Math.round((2 * Math.PI * r) / 60));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = Math.round((ZONE.x + Math.cos(a) * r) / SNAP) * SNAP;
      const y = Math.round((ZONE.y + Math.sin(a) * r) / SNAP) * SNAP;
      if (tryAt(x, y)) return quantize({ ...base, x, y });
    }
  }
  return quantize(base);
}

export function addObject(type: AsykType): boolean {
  if (draft.asyks.length >= MAX_OBJECTS) return false;
  draft.asyks.push(freeSpot(type));
  selected = draft.asyks.length - 1;
  autoPar();
  return true;
}

export function rotateSelected(deg: number): void {
  if (selected === null) return;
  const a = draft.asyks[selected];
  draft.asyks[selected] = quantize({ ...a, angle: a.angle + (deg * Math.PI) / 180 });
}

export function deleteSelected(): void {
  if (selected === null) return;
  draft.asyks.splice(selected, 1);
  selected = null;
  autoPar();
}

export function clearAll(): void {
  draft.asyks = [];
  selected = null;
  autoPar();
}

export function changeThrows(d: number): void {
  draft.throws = Math.min(MAX_THROWS, Math.max(MIN_THROWS, draft.throws + d));
  draft.par = Math.min(draft.par, draft.throws);
  autoPar();
}

export function changePar(d: number): void {
  draft.parAuto = false;
  draft.par = Math.min(draft.throws, Math.max(1, draft.par + d));
}

export function setName(v: string): void {
  draft.name = v.slice(0, 24);
}

export function selectedIndex(): number | null {
  return selected;
}

/** Обновляет подсветку ошибок и сообщение без полной перерисовки (во время перетаскивания). */
function refreshValidation(root: ParentNode): void {
  const v = validateLayout(draft.asyks);
  root.querySelectorAll<SVGGElement>('#ed-objs .obj').forEach((g) => {
    const i = Number(g.dataset.i);
    g.classList.toggle('bad', v.bad.has(i));
    g.classList.toggle('sel', selected === i);
  });
  const msg = root.querySelector('#ed-msg');
  if (msg) {
    const issue = issueText();
    msg.textContent = issue.text || t('editorHint');
    msg.classList.toggle('err', issue.error);
  }
}

/**
 * Подключает перетаскивание к SVG редактора (Pointer Events: мышь и палец).
 * onChange вызывается после завершения жеста — UI перерисует панель кнопок/статусов.
 */
export function mountEditor(root: HTMLElement, onChange: () => void): void {
  const svg = root.querySelector<SVGSVGElement>('#ed-svg');
  if (!svg) return;
  let drag: { i: number; dx: number; dy: number; id: number; moved: boolean } | null = null;

  const toSvg = (e: PointerEvent): { x: number; y: number } => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    const p = m ? pt.matrixTransform(m.inverse()) : pt;
    return { x: p.x, y: p.y };
  };

  svg.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || drag) return;
    const g = (e.target as Element).closest<SVGGElement>('.obj');
    if (!g) {
      selected = null;
      refreshValidation(root);
      return;
    }
    e.preventDefault();
    const i = Number(g.dataset.i);
    selected = i;
    const p = toSvg(e);
    drag = { i, dx: draft.asyks[i].x - p.x, dy: draft.asyks[i].y - p.y, id: e.pointerId, moved: false };
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* не критично */
    }
    refreshValidation(root);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toSvg(e);
    const a = draft.asyks[drag.i];
    const nx = Math.round((p.x + drag.dx) / SNAP) * SNAP;
    const ny = Math.round((p.y + drag.dy) / SNAP) * SNAP;
    // не даём утащить далеко за кон
    const r = Math.hypot(nx - ZONE.x, ny - ZONE.y);
    const k = r > ZONE.r + 30 ? (ZONE.r + 30) / r : 1;
    a.x = Math.round(ZONE.x + (nx - ZONE.x) * k);
    a.y = Math.round(ZONE.y + (ny - ZONE.y) * k);
    drag.moved = true;
    const g = root.querySelector<SVGGElement>(`#ed-objs .obj[data-i="${drag.i}"]`);
    g?.setAttribute('transform', `translate(${a.x} ${a.y}) rotate(${(a.angle * 180) / Math.PI})`);
    refreshValidation(root);
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    onChange();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}
