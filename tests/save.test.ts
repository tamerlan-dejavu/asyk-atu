import { describe, expect, it } from 'vitest';
import { applyLevelResult, BACKUP_KEY, BACKUP_V1_KEY, defaultSave, sanitizeResume, SAVE_KEY, SaveStore, type StorageLike } from '../src/storage/save';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe('save', () => {
  it('пустое хранилище → значения по умолчанию', () => {
    const s = new SaveStore(fakeStorage());
    expect(s.data).toEqual(defaultSave());
    expect(s.data.lang).toBe('ru');
  });

  it('битый JSON не роняет игру и сохраняется в бэкап', () => {
    const st = fakeStorage({ [SAVE_KEY]: '{not json' });
    const s = new SaveStore(st);
    expect(s.data).toEqual(defaultSave());
    expect(st.data[BACKUP_KEY]).toBe('{not json');
  });

  it('отсутствие localStorage (приватный режим) — игра работает', () => {
    const s = new SaveStore(null);
    s.update((d) => {
      d.sound = false;
    });
    expect(s.data.sound).toBe(false);
  });

  it('хранилище, бросающее исключения, не ломает чтение и запись', () => {
    const boom: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    const s = new SaveStore(boom);
    expect(() => s.update((d) => (d.tutorialDone = true))).not.toThrow();
    expect(s.data.tutorialDone).toBe(true);
  });

  it('миграция v1 → v2 сохраняет прогресс и бэкапит старое значение', () => {
    const v1 = JSON.stringify({
      v: 1,
      lang: 'kk',
      sound: false,
      quality: 'high',
      tutorialDone: true,
      unlocked: 3,
      levels: { '1': { best: 75, stars: 3, plays: 2 } },
      stats: { throws: 10, asyksOut: 6, hits: 5 },
      daily: { '2026-09-01': { best: 40 } },
      playerNames: ['A', 'B'],
    });
    const st = fakeStorage({ [SAVE_KEY]: v1 });
    const s = new SaveStore(st);
    expect(s.data.v).toBe(2);
    expect(s.data.lang).toBe('kk');
    expect(s.data.unlocked).toBe(3);
    expect(s.data.levels['1']).toEqual({ best: 75, stars: 3, plays: 2 });
    expect(s.data.daily['2026-09-01'].best).toBe(40);
    expect(s.data.playerNames).toEqual(['A', 'B']);
    expect(s.data.coins).toBe(0);
    expect(st.data[BACKUP_V1_KEY]).toBe(v1);
    expect(JSON.parse(st.data[SAVE_KEY]).v).toBe(2);
  });

  it('неизвестная версия схемы → сброс с бэкапом старого значения', () => {
    const old = JSON.stringify({ v: 0, levels: { '1': { best: 999 } } });
    const st = fakeStorage({ [SAVE_KEY]: old });
    const s = new SaveStore(st);
    expect(s.data).toEqual(defaultSave());
    expect(st.data[BACKUP_KEY]).toBe(old);
    expect(JSON.parse(st.data[SAVE_KEY]).v).toBe(2);
  });

  it('данные переживают «перезагрузку»', () => {
    const st = fakeStorage();
    const a = new SaveStore(st);
    a.update((d) => applyLevelResult(d, 1, 75, 3));
    const b = new SaveStore(st);
    expect(b.data.levels['1']).toEqual({ best: 75, stars: 3, plays: 1 });
    expect(b.data.unlocked).toBe(2);
  });

  it('мусор в полях заменяется значениями по умолчанию', () => {
    const st = fakeStorage({ [SAVE_KEY]: JSON.stringify({ v: 2, lang: 'de', sound: 'yes', unlocked: 'x', levels: { '1': 5 }, playerNames: [1, 2] }) });
    const s = new SaveStore(st);
    expect(s.data.lang).toBe('ru');
    expect(s.data.sound).toBe(true);
    expect(s.data.unlocked).toBe(0);
    expect(s.data.levels).toEqual({});
    expect(s.data.playerNames).toEqual(['', '']);
  });

  it('рекорд и звёзды не уменьшаются; уровень открывается только при ≥1★', () => {
    const d = defaultSave();
    expect(applyLevelResult(d, 2, 50, 2).newRecord).toBe(true);
    const worse = applyLevelResult(d, 2, 30, 1);
    expect(worse.newRecord).toBe(false);
    expect(d.levels['2']).toEqual({ best: 50, stars: 2, plays: 2 });
    expect(d.unlocked).toBe(3);
    applyLevelResult(d, 4, 10, 0);
    expect(d.unlocked).toBe(3);
  });

  it('сброс прогресса сохраняет язык/звук/качество', () => {
    const st = fakeStorage();
    const s = new SaveStore(st);
    s.update((d) => {
      d.lang = 'kk';
      applyLevelResult(d, 1, 10, 1);
    });
    s.reset();
    expect(s.data.levels).toEqual({});
    expect(s.data.lang).toBe('kk');
  });
});

describe('resume', () => {
  const good = {
    v: 1,
    ts: 1,
    mode: 'campaign',
    levelId: 2,
    level: {
      id: 2,
      nameKey: 'level2',
      throws: 6,
      par: 4,
      zone: { x: 360, y: 350, r: 180 },
      asyks: [{ id: 'a1', x: 360, y: 340, angle: 0.5, type: 'golden' }],
    },
    round: { throwsUsed: 2, scores: [20, 0], player: 0, versusThrows: [0, 0], bestCombo: 1, scoredIds: ['a0'], asykTotal: 6 },
    extra: {},
  };

  it('корректный resume проходит проверку', () => {
    const r = sanitizeResume(good)!;
    expect(r.level.asyks[0].type).toBe('golden');
    expect(r.round.scoredIds).toEqual(['a0']);
  });

  it('повреждённый или чужой версии resume отбрасывается без падения', () => {
    expect(sanitizeResume(null)).toBeNull();
    expect(sanitizeResume({ ...good, v: 7 })).toBeNull();
    expect(sanitizeResume({ ...good, mode: 'hack' })).toBeNull();
    expect(sanitizeResume({ ...good, level: { ...good.level, asyks: [{ x: 'a' }] } })).toBeNull();
    expect(sanitizeResume({ ...good, level: { ...good.level, asyks: [] } })).toBeNull();
    expect(sanitizeResume({ ...good, round: 5 })).toBeNull();
  });

  it('resume переживает перезагрузку и битый resume в сохранении обнуляется', () => {
    const st = fakeStorage();
    const a = new SaveStore(st);
    a.update((d) => (d.resume = sanitizeResume(good)));
    expect(new SaveStore(st).data.resume?.levelId).toBe(2);
    const raw = JSON.parse(st.data[SAVE_KEY]);
    raw.resume = { v: 1, mode: 'campaign' };
    st.data[SAVE_KEY] = JSON.stringify(raw);
    expect(new SaveStore(st).data.resume).toBeNull();
  });
});
