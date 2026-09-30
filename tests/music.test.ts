import { describe, expect, it, vi } from 'vitest';
import { DUCK_LEVEL, MusicManager, type MusicSettings, type TrackId } from '../src/audio/MusicManager';
import { defaultSave, sanitize } from '../src/storage/save';

/** Минимальный AudioParam: планирование сразу применяет целевое значение (время в тестах не идёт). */
class Param {
  constructor(public value: number) {}
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
  cancelScheduledValues() {}
}
class Node {
  connect(n: unknown) {
    return n;
  }
}
class Gain extends Node {
  gain = new Param(1);
}
class Source extends Node {
  buffer: { duration: number } | null = null;
  loop = false;
  started: number[] = [];
  stopped = false;
  start(_t: number, off = 0) {
    this.started.push(off);
  }
  stop() {
    this.stopped = true;
  }
}
class FakeCtx {
  currentTime = 0;
  state = 'running';
  destination = new Node();
  sources: Source[] = [];
  failDecode = false;
  createGain() {
    return new Gain();
  }
  createBufferSource() {
    const s = new Source();
    this.sources.push(s);
    return s;
  }
  async decodeAudioData() {
    if (this.failDecode) throw new Error('bad audio');
    return { duration: 100 };
  }
}

function setup(opts: { ctx?: FakeCtx | null; fetchFails?: boolean } = {}) {
  let ctx: FakeCtx | null = opts.ctx === undefined ? null : opts.ctx;
  const settings: MusicSettings = { sound: true, on: true, volume: 0.35 };
  const proc = { start: vi.fn(), stop: vi.fn() };
  const fetches: TrackId[] = [];
  const m = new MusicManager({
    getCtx: () => ctx as unknown as AudioContext | null,
    fetchTrack: async (id) => {
      fetches.push(id);
      if (opts.fetchFails) throw new Error('404');
      return new ArrayBuffer(8);
    },
    procedural: () => proc,
    settings: () => settings,
  });
  return {
    m,
    settings,
    proc,
    fetches,
    unlock: (c = new FakeCtx()) => {
      ctx = c;
      m.onUnlock();
      return c;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('MusicManager', () => {
  it('до жеста пользователя не звучит; после — стартует желаемый трек', async () => {
    const { m, unlock } = setup();
    m.play('menu');
    await flush();
    expect(m.state).toMatchObject({ track: 'menu', playing: false });
    const ctx = unlock();
    await flush();
    await flush();
    expect(m.state).toMatchObject({ track: 'menu', playing: true, procedural: false });
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].loop).toBe(true);
  });

  it('смена экрана — кроссфейд: новый трек стартует, старый останавливается', async () => {
    const ctx = new FakeCtx();
    const { m } = setup({ ctx });
    await m.crossfadeTo('menu');
    await m.crossfadeTo('game');
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0].stopped).toBe(true);
    expect(m.state.track).toBe('game');
  });

  it('файл не загрузился или не декодируется → процедурная домбра', async () => {
    const a = setup({ ctx: new FakeCtx(), fetchFails: true });
    await a.m.crossfadeTo('menu');
    expect(a.m.state.procedural).toBe(true);
    expect(a.proc.start).toHaveBeenCalled();

    const ctx = new FakeCtx();
    ctx.failDecode = true;
    const b = setup({ ctx });
    await b.m.crossfadeTo('game');
    expect(b.m.state.procedural).toBe(true);
  });

  it('громкость и mute: звук выкл, музыка выкл → 0; иначе — громкость музыки', async () => {
    const ctx = new FakeCtx();
    const { m, settings } = setup({ ctx });
    await m.crossfadeTo('menu');
    expect(m.state.level).toBeCloseTo(0.35);
    settings.on = false;
    m.apply();
    expect(m.state.level).toBe(0);
    settings.on = true;
    settings.sound = false;
    m.mute(true);
    expect(m.state.level).toBe(0);
    settings.sound = true;
    settings.volume = 0.8;
    m.setVolume(0.8);
    expect(m.state.level).toBeCloseTo(0.8);
  });

  it('duck приглушает фон до 60 % и возвращает', async () => {
    const ctx = new FakeCtx();
    const { m } = setup({ ctx });
    await m.crossfadeTo('menu');
    const calls: number[] = [];
    // фейковый параметр применяет последнее значение: после цепочки — снова 1, а 0.6 было в середине
    const orig = Param.prototype.linearRampToValueAtTime;
    Param.prototype.linearRampToValueAtTime = function (v: number) {
      calls.push(v);
      this.value = v;
    };
    m.duck(160);
    Param.prototype.linearRampToValueAtTime = orig;
    expect(calls).toEqual([DUCK_LEVEL, 1]);
    expect(m.state.duck).toBe(1);
  });

  it('пауза и продолжение — с того же места', async () => {
    const ctx = new FakeCtx();
    const { m } = setup({ ctx });
    await m.crossfadeTo('game');
    ctx.currentTime = 12.5;
    m.pause();
    expect(m.state).toMatchObject({ paused: true, playing: false });
    ctx.currentTime = 40;
    m.resume();
    await flush();
    expect(m.state.playing).toBe(true);
    expect(ctx.sources[1].started[0]).toBeCloseTo(12.5, 3);
  });
});

describe('настройки музыки в сохранении', () => {
  it('по умолчанию музыка вкл, громкость 35 %; значения восстанавливаются и ограничиваются', () => {
    const d = defaultSave();
    expect(d.musicOn).toBe(true);
    expect(d.musicVolume).toBeCloseTo(0.35);
    const s = sanitize({ ...d, musicOn: false, musicVolume: 0.6 });
    expect(s).toMatchObject({ musicOn: false, musicVolume: 0.6 });
    expect(sanitize({ ...d, musicVolume: 7 }).musicVolume).toBe(1);
    expect(sanitize({ ...d, musicVolume: 'громко' }).musicVolume).toBeCloseTo(0.35);
    expect(sanitize({ v: 1, unlocked: 2 }).musicOn).toBe(true);
  });
});
