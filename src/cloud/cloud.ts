import type { SupabaseClient, User } from '@supabase/supabase-js';
import { FEATURES } from '../config/features';
import { getStorage, store } from '../storage/save';
import { BUILD } from '../util/build';
import { getClient, isAvailable } from './client';
import { mergeSaves, syncFingerprint } from './merge';
import { Outbox, type ResultJob } from './outbox';

/** off — облако выключено сборкой; offline — недоступно (сеть/проект спит); online — работает. */
export type CloudStatus = 'off' | 'connecting' | 'offline' | 'online';
export type SyncStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

export interface CloudUser {
  id: string;
  anonymous: boolean;
  email: string | null;
  nickname: string | null;
}

export interface BoardRow {
  place: number;
  nickname: string;
  score: number;
  stars: number | null;
  verified: boolean;
  isMe: boolean;
}

export interface ShortChallenge {
  id: string;
  title: string;
  code: string;
  plays: number;
}

export type AuthError = 'invalid' | 'taken' | 'weak' | 'exists' | 'credentials' | 'network' | 'limit';

export const NICK_RE = /^[\p{L}\p{N}_ .-]{3,16}$/u;
const SYNC_DEBOUNCE_MS = 3000;
const MAX_ERRORS = 5;

function authError(e: unknown): AuthError {
  const msg = String((e as { message?: string })?.message ?? e).toLowerCase();
  const code = String((e as { code?: string })?.code ?? '');
  if (code === '23505' || msg.includes('duplicate')) return 'taken';
  if (msg.includes('already') || msg.includes('registered') || code === 'email_exists' || code === 'user_already_exists') return 'exists';
  if (msg.includes('password') && (msg.includes('least') || msg.includes('weak'))) return 'weak';
  if (msg.includes('invalid login') || code === 'invalid_credentials') return 'credentials';
  if (msg.includes('rate') || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'limit';
  if (msg.includes('fetch') || msg.includes('network')) return 'network';
  return 'invalid';
}

/**
 * Облачный слой: всё здесь — надстройка. Любая ошибка сети гасится и не влияет на игру;
 * локальное сохранение остаётся первичным.
 */
class Cloud {
  status: CloudStatus = FEATURES.cloud ? 'connecting' : 'off';
  sync: SyncStatus = 'idle';
  user: CloudUser | null = null;
  private sb: SupabaseClient | null = null;
  private listeners = new Set<() => void>();
  private syncTimer = 0;
  private flushTimer = 0;
  private lastPushed = '';
  private rev: number | null = null;
  private errorsSent = 0;
  private readonly outbox = new Outbox(typeof window === 'undefined' ? null : getStorage());

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  get ready(): boolean {
    return this.status === 'online' && this.sb !== null;
  }

  get signedIn(): boolean {
    return this.ready && this.user !== null;
  }

  async init(): Promise<void> {
    if (!FEATURES.cloud) return;
    const ok = await isAvailable();
    if (!ok) {
      this.status = 'offline';
      this.emit();
      window.addEventListener('online', () => void this.retryInit(), { once: true });
      return;
    }
    this.sb = await getClient();
    if (!this.sb) {
      this.status = 'offline';
      this.emit();
      return;
    }
    this.status = 'online';
    const { data } = await this.sb.auth.getSession();
    if (data.session?.user) await this.afterLogin(data.session.user);
    this.sb.auth.onAuthStateChange((_ev, session) => {
      const u = session?.user ?? null;
      if (!u) {
        this.user = null;
        this.emit();
      }
    });
    store.onChange(() => this.scheduleSync());
    window.addEventListener('online', () => this.scheduleFlush(0));
    this.emit();
  }

  private async retryInit(): Promise<void> {
    this.status = 'connecting';
    this.emit();
    await this.init();
  }

  // ------------------------------------------------------------------ авторизация
  private async afterLogin(u: User): Promise<void> {
    this.user = { id: u.id, anonymous: Boolean(u.is_anonymous), email: u.email ?? null, nickname: null };
    await this.loadProfile();
    await this.pull();
    this.scheduleFlush(0);
    this.emit();
  }

  private async loadProfile(): Promise<void> {
    if (!this.sb || !this.user) return;
    try {
      const { data } = await this.sb.from('profiles').select('nickname').eq('id', this.user.id).maybeSingle();
      this.user.nickname = (data?.nickname as string | undefined) ?? null;
    } catch {
      /* без никнейма */
    }
  }

  /** Гость в один клик: анонимный аккаунт, прогресс сразу синхронизируется. */
  async signInGuest(): Promise<AuthError | null> {
    if (!this.sb) return 'network';
    try {
      const { data, error } = await this.sb.auth.signInAnonymously();
      if (error || !data.user) return authError(error);
      await this.afterLogin(data.user);
      return null;
    } catch (e) {
      return authError(e);
    }
  }

  /** «Сохранить прогресс»: гость → постоянный аккаунт (данные остаются). Без гостя — обычная регистрация. */
  async register(email: string, password: string): Promise<AuthError | null> {
    if (!this.sb) return 'network';
    try {
      if (this.user?.anonymous) {
        const { data, error } = await this.sb.auth.updateUser({ email, password });
        if (error || !data.user) return authError(error);
        await this.afterLogin(data.user);
        return null;
      }
      const { data, error } = await this.sb.auth.signUp({ email, password });
      if (error || !data.user) return authError(error);
      if (!data.session) return 'invalid'; // подтверждение почты должно быть выключено (см. RUNBOOK)
      await this.afterLogin(data.user);
      return null;
    } catch (e) {
      return authError(e);
    }
  }

  async signIn(email: string, password: string): Promise<AuthError | null> {
    if (!this.sb) return 'network';
    try {
      const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
      if (error || !data.user) return authError(error);
      await this.afterLogin(data.user);
      return null;
    } catch (e) {
      return authError(e);
    }
  }

  async signOut(): Promise<void> {
    await this.pushNow();
    try {
      await this.sb?.auth.signOut();
    } catch {
      /* локально всё равно выходим */
    }
    this.user = null;
    this.rev = null;
    this.lastPushed = '';
    this.emit();
  }

  async setNickname(nick: string): Promise<AuthError | null> {
    const n = nick.trim();
    if (!NICK_RE.test(n)) return 'invalid';
    if (!this.sb || !this.user) return 'network';
    try {
      const { error } = await this.sb.from('profiles').update({ nickname: n }).eq('id', this.user.id);
      if (error) return authError(error);
      this.user.nickname = n;
      this.emit();
      return null;
    } catch (e) {
      return authError(e);
    }
  }

  /** Удаление аккаунта и всех данных в облаке (профиль, сохранения, результаты, вызовы). */
  async deleteAccount(): Promise<boolean> {
    if (!this.sb || !this.user) return false;
    try {
      const { error } = await this.sb.rpc('delete_me');
      if (error) return false;
      await this.sb.auth.signOut().catch(() => undefined);
      this.user = null;
      this.rev = null;
      this.emit();
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ синхронизация
  private setSync(s: SyncStatus): void {
    if (this.sync !== s) {
      this.sync = s;
      this.emit();
    }
  }

  private scheduleSync(): void {
    if (!this.signedIn) return;
    if (syncFingerprint(store.data) === this.lastPushed) return; // изменился только текущий раунд
    window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => void this.pushNow(), SYNC_DEBOUNCE_MS);
  }

  /** Загрузка облачного сохранения и слияние с локальным. */
  async pull(): Promise<void> {
    if (!this.sb || !this.user) return;
    try {
      const { data, error } = await this.sb.from('saves').select('data, rev, updated_at').eq('user_id', this.user.id).maybeSingle();
      if (error) throw error;
      if (data) {
        const merged = mergeSaves(
          { save: store.data, at: store.updatedAt },
          { save: data.data, at: Date.parse(data.updated_at as string) || 0 },
        );
        this.rev = Number(data.rev);
        if (syncFingerprint(merged) !== syncFingerprint(store.data)) store.replace(merged);
        this.lastPushed = syncFingerprint(data.data) === syncFingerprint(merged) ? syncFingerprint(merged) : '';
      } else {
        this.rev = null;
        this.lastPushed = '';
      }
      await this.pushNow();
    } catch {
      this.setSync(navigator.onLine ? 'error' : 'offline');
    }
  }

  /** Отправка с оптимистичной проверкой rev: при конфликте — загрузка, слияние и повтор. */
  async pushNow(attempt = 0): Promise<void> {
    window.clearTimeout(this.syncTimer);
    if (!this.sb || !this.user) return;
    const fp = syncFingerprint(store.data);
    if (fp === this.lastPushed) {
      this.setSync('saved');
      return;
    }
    this.setSync('saving');
    const payload = { ...store.data, resume: null };
    try {
      if (this.rev === null) {
        const { data, error } = await this.sb
          .from('saves')
          .insert({ user_id: this.user.id, data: payload, schema_version: 2 })
          .select('rev')
          .maybeSingle();
        if (error) {
          if (error.code === '23505' && attempt < 2) return this.pull(); // запись уже есть — слить
          throw error;
        }
        this.rev = Number(data?.rev ?? 0);
      } else {
        const { data, error } = await this.sb
          .from('saves')
          .update({ data: payload, schema_version: 2 })
          .eq('user_id', this.user.id)
          .eq('rev', this.rev)
          .select('rev');
        if (error) throw error;
        if (!data || data.length === 0) {
          if (attempt < 2) return this.pull(); // другое устройство успело записать — слить и повторить
          throw new Error('conflict');
        }
        this.rev = Number(data[0].rev);
      }
      this.lastPushed = fp;
      this.setSync('saved');
    } catch {
      this.setSync(navigator.onLine ? 'error' : 'offline');
    }
  }

  // ------------------------------------------------------------------ результаты
  submitResult(job: ResultJob): void {
    if (!FEATURES.cloud) return;
    this.outbox.push(job);
    this.scheduleFlush(0);
  }

  private scheduleFlush(delay: number): void {
    window.clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(() => void this.flush(), delay);
  }

  private async flush(): Promise<void> {
    if (!this.signedIn || !this.sb) return;
    const sb = this.sb;
    await this.outbox.flush(async (j) => {
      try {
        const { error } = await sb.rpc('submit_result', {
          p_mode: j.mode,
          p_key: j.key,
          p_score: j.score,
          p_stars: j.stars,
          p_throws: j.throws,
          p_best_combo: j.combo,
        });
        if (!error) return 'ok';
        // слишком часто — повторить; нарушение правил (выше предела и т.п.) — выбросить
        return error.code === '53400' ? 'retry' : 'drop';
      } catch {
        return 'retry';
      }
    });
    const next = this.outbox.nextDelay();
    if (next !== null) this.scheduleFlush(next + 50);
  }

  // ------------------------------------------------------------------ рейтинг
  async leaderboard(mode: ResultJob['mode'], key: string): Promise<BoardRow[] | null> {
    if (!this.signedIn || !this.sb) return null;
    try {
      const { data, error } = await this.sb.rpc('get_leaderboard', { p_mode: mode, p_key: key, p_limit: 20 });
      if (error || !Array.isArray(data)) return null;
      return data.map((r: Record<string, unknown>) => ({
        place: Number(r.place),
        nickname: String(r.nickname ?? ''),
        score: Number(r.score),
        stars: r.stars === null ? null : Number(r.stars),
        verified: Boolean(r.verified),
        isMe: Boolean(r.is_me),
      }));
    } catch {
      return null;
    }
  }

  /** Облачная история (последние 50 своих результатов). */
  async history(): Promise<{ ts: number; mode: string; key: string; score: number; stars: number }[] | null> {
    if (!this.signedIn || !this.sb) return null;
    try {
      const { data, error } = await this.sb
        .from('results')
        .select('created_at, mode, key, score, stars')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error || !data) return null;
      return data.map((r) => ({
        ts: Date.parse(r.created_at as string),
        mode: String(r.mode),
        key: String(r.key),
        score: Number(r.score),
        stars: Number(r.stars ?? 0),
      }));
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ короткие ссылки
  private randomId(): string {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    return [...buf].map((b) => abc[b % abc.length]).join('');
  }

  /** Сохраняет вызов в облаке и возвращает 8-символьный id (или null — тогда используется ссылка с кодом). */
  async createShort(code: string, title: string, throws: number, par: number): Promise<string | null> {
    if (!this.ready) return null;
    if (!this.user && (await this.signInGuest())) return null; // вызов требует облачного профиля — гость в один клик
    if (!this.sb || !this.user) return null;
    for (let i = 0; i < 3; i++) {
      const id = this.randomId();
      try {
        const { error } = await this.sb
          .from('challenges')
          .insert({ id, owner: this.user.id, title: title.slice(0, 24), code, throws, par });
        if (!error) return id;
        if (error.code !== '23505') return null;
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Читает вызов по короткому id (доступно и без входа). */
  async getShort(id: string): Promise<ShortChallenge | null> {
    if (!/^[A-Za-z0-9]{8}$/.test(id)) return null;
    if (this.status === 'connecting') await new Promise<void>((res) => this.onceReady(res));
    if (!this.ready || !this.sb) return null;
    try {
      const { data, error } = await this.sb.from('challenges').select('id, title, code, plays').eq('id', id).maybeSingle();
      if (error || !data) return null;
      return { id: String(data.id), title: String(data.title ?? ''), code: String(data.code), plays: Number(data.plays) };
    } catch {
      return null;
    }
  }

  private onceReady(fn: () => void): void {
    const off = this.onChange(() => {
      if (this.status !== 'connecting') {
        off();
        fn();
      }
    });
  }

  played(id: string): void {
    if (!this.ready || !this.sb) return;
    void this.sb.rpc('challenge_played', { p_id: id }).then(
      () => undefined,
      () => undefined,
    );
  }

  // ------------------------------------------------------------------ ошибки клиента
  reportError(message: string): void {
    if (!this.signedIn || !this.sb || this.errorsSent >= MAX_ERRORS) return;
    this.errorsSent++;
    void this.sb
      .from('client_errors')
      .insert({ message: message.slice(0, 300), build: BUILD.sha })
      .then(
        () => undefined,
        () => undefined,
      );
  }
}

export const cloud = new Cloud();
