import { describe, expect, it } from 'vitest';
import { backoffMs, Outbox, OUTBOX_KEY, type ResultJob } from '../src/cloud/outbox';
import type { StorageLike } from '../src/storage/save';

const mem = (): StorageLike & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v), removeItem: (k) => void delete data[k] };
};
const job = (score: number): ResultJob => ({ kind: 'result', mode: 'level', key: 'level:1', score, stars: 1, throws: 3, combo: 1 });

describe('очередь отправки', () => {
  it('экспоненциальная пауза 1, 2, 4… до 60 с', () => {
    expect([0, 1, 2, 3, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 60000]);
  });

  it('без сети задания сохраняются и переживают перезагрузку', async () => {
    const st = mem();
    let now = 0;
    const box = new Outbox(st, () => now);
    box.push(job(10));
    box.push(job(20));
    expect(await box.flush(async () => 'retry')).toBe(0);
    expect(box.size).toBe(2);
    expect(box.nextDelay()).toBe(0); // второе задание не пробовали
    const again = new Outbox(st, () => now);
    expect(again.size).toBe(2);
    now = 10_000;
    const sent: number[] = [];
    expect(await again.flush(async (j) => (sent.push(j.score), 'ok'))).toBe(2);
    expect(sent).toEqual([10, 20]);
    expect(again.size).toBe(0);
  });

  it('повтор после паузы; отклонённое сервером задание выбрасывается', async () => {
    let now = 0;
    const box = new Outbox(mem(), () => now);
    box.push(job(1));
    await box.flush(async () => 'retry');
    expect(box.due()).toHaveLength(0);
    now = 1000;
    expect(box.due()).toHaveLength(1);
    await box.flush(async () => 'drop');
    expect(box.size).toBe(0);
  });

  it('битые данные в хранилище не ломают очередь', () => {
    const st = mem();
    st.data[OUTBOX_KEY] = '{oops';
    expect(new Outbox(st).size).toBe(0);
    expect(new Outbox(null).size).toBe(0);
  });
});
