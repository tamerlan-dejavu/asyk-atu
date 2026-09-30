import type { StorageLike } from '../storage/save';

export const OUTBOX_KEY = 'asyk-atu:outbox';
export const OUTBOX_LIMIT = 50;
export const BACKOFF_MAX_MS = 60_000;

export interface ResultJob {
  kind: 'result';
  mode: 'level' | 'endless' | 'daily' | 'challenge';
  key: string;
  score: number;
  stars: number;
  throws: number;
  combo: number;
}

export interface Job {
  id: string;
  job: ResultJob;
  tries: number;
  /** когда можно пробовать снова (мс) */
  nextAt: number;
}

/** Пауза перед повтором: 1, 2, 4… секунд, не больше 60. */
export function backoffMs(tries: number): number {
  return Math.min(BACKOFF_MAX_MS, 1000 * 2 ** Math.max(0, tries));
}

/**
 * Очередь отправки результатов. Без сети задания лежат в localStorage и отправляются позже
 * с экспоненциальной паузой. Ошибки валидации сервера (не сетевые) выбрасывают задание — повтор бесполезен.
 */
export class Outbox {
  private jobs: Job[] = [];
  private seq = 0;

  constructor(
    private readonly storage: StorageLike | null,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.load();
  }

  private load(): void {
    try {
      const raw = this.storage?.getItem(OUTBOX_KEY);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      this.jobs = Array.isArray(arr)
        ? (arr as Job[]).filter((j) => j && typeof j.id === 'string' && j.job?.kind === 'result').slice(-OUTBOX_LIMIT)
        : [];
    } catch {
      this.jobs = [];
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(OUTBOX_KEY, JSON.stringify(this.jobs));
    } catch {
      /* без сохранения — очередь живёт в памяти */
    }
  }

  get size(): number {
    return this.jobs.length;
  }

  push(job: ResultJob): void {
    this.jobs.push({ id: `${this.now().toString(36)}-${this.seq++}`, job, tries: 0, nextAt: 0 });
    if (this.jobs.length > OUTBOX_LIMIT) this.jobs.splice(0, this.jobs.length - OUTBOX_LIMIT);
    this.persist();
  }

  /** Задания, которые пора отправлять. */
  due(): Job[] {
    const t = this.now();
    return this.jobs.filter((j) => j.nextAt <= t);
  }

  done(id: string): void {
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.persist();
  }

  /** Сетевая ошибка: повторить позже. */
  retry(id: string): void {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    j.tries++;
    j.nextAt = this.now() + backoffMs(j.tries - 1);
    this.persist();
  }

  /** Время до ближайшего повтора (мс) или null, если очередь пуста. */
  nextDelay(): number | null {
    if (this.jobs.length === 0) return null;
    return Math.max(0, Math.min(...this.jobs.map((j) => j.nextAt)) - this.now());
  }

  /**
   * Прокачивает очередь: send возвращает 'ok' | 'retry' | 'drop'.
   * Задания обрабатываются по порядку; при сетевой ошибке останавливаемся (сети нет — дальше бессмысленно).
   */
  async flush(send: (job: ResultJob) => Promise<'ok' | 'retry' | 'drop'>): Promise<number> {
    let sent = 0;
    for (const j of this.due()) {
      const r = await send(j.job);
      if (r === 'retry') {
        this.retry(j.id);
        break;
      }
      this.done(j.id);
      if (r === 'ok') sent++;
    }
    return sent;
  }
}
