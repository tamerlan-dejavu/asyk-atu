import { buildLink, type LinkKind } from '../challenge/link';
import { t } from '../i18n';
import { store } from '../storage/save';
import { toast } from './common';

/** Адрес игры без хэша. */
export function baseUrl(): string {
  return `${location.origin}${location.pathname}`;
}

/** Имя отправителя для ссылок-вызовов (из настроек). */
export function senderName(): string | undefined {
  const n = store.data.playerNames[0].trim();
  return n || undefined;
}

export function makeLink(link: LinkKind): string {
  return buildLink(baseUrl(), link);
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* попробуем запасной способ */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Поделиться ссылкой: Web Share API (телефоны) или копирование в буфер с подтверждением. */
export async function shareLink(url: string, title: string, text: string): Promise<boolean> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, text, url });
      return true;
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return false; // пользователь закрыл окно
  }
  if (await copyText(url)) {
    toast(t('linkCopied'));
    return true;
  }
  toast(t('copyFailed'), 4000);
  return false;
}

export interface CardData {
  title: string;
  subtitle: string;
  score: number;
  stars?: number;
  line?: string;
}

/** Процедурная карточка результата (canvas → PNG). Только код, без внешних ассетов. */
export function drawCard(d: CardData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 720;
  c.height = 400;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 400);
  bg.addColorStop(0, '#d9ad72');
  bg.addColorStop(1, '#b8823f');
  g.fillStyle = bg;
  g.fillRect(0, 0, 720, 400);
  g.strokeStyle = '#9a4526';
  g.lineWidth = 16;
  g.strokeRect(8, 8, 704, 384);
  g.strokeStyle = '#f6ecd0';
  g.lineWidth = 2;
  g.strokeRect(20, 20, 680, 360);
  g.fillStyle = '#16a5a3';
  for (let x = 60; x < 680; x += 40) {
    for (const y of [14, 386]) {
      g.beginPath();
      g.moveTo(x, y - 5);
      g.lineTo(x + 5, y);
      g.lineTo(x, y + 5);
      g.lineTo(x - 5, y);
      g.closePath();
      g.fill();
    }
  }
  g.textAlign = 'center';
  g.fillStyle = '#f6ecd0';
  g.shadowColor = '#3a2412';
  g.shadowOffsetY = 3;
  g.font = 'bold 54px Georgia, serif';
  g.fillText(t('title'), 360, 96);
  g.shadowOffsetY = 0;
  g.shadowColor = 'transparent';
  g.fillStyle = '#2b1a0e';
  g.font = 'bold 30px system-ui, sans-serif';
  g.fillText(d.subtitle.slice(0, 40), 360, 146);
  g.font = 'bold 40px system-ui, sans-serif';
  g.fillStyle = '#f6ecd0';
  g.fillText(d.title.slice(0, 32), 360, 200);
  g.font = 'bold 96px system-ui, sans-serif';
  g.fillStyle = '#fff';
  g.strokeStyle = '#2b1a0e';
  g.lineWidth = 8;
  g.strokeText(String(d.score), 360, 300);
  g.fillText(String(d.score), 360, 300);
  if (d.stars !== undefined) {
    g.font = '48px system-ui, sans-serif';
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i < d.stars ? '#ffcf3a' : 'rgba(246,236,208,0.35)';
      g.fillText('★', 300 + i * 60, 350);
    }
  }
  if (d.line) {
    g.font = 'bold 24px system-ui, sans-serif';
    g.fillStyle = '#2b1a0e';
    g.fillText(d.line.slice(0, 48), 360, 372);
  }
  return c;
}

/** Делится картинкой (Web Share с файлом) или скачивает PNG. */
export async function shareCard(d: CardData): Promise<void> {
  const canvas = drawCard(d);
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'asyk-atu.png', { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: t('title') });
      return;
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'asyk-atu.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(t('cardShared'));
}
