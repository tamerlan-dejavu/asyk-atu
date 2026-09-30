// Проверка политик RLS против dev-проекта Supabase (запускать вручную: npm run check:rls).
// Нужны переменные SUPABASE_URL и SUPABASE_ANON_KEY (публичный ключ; service_role НЕ нужен и не используется).
// Создаёт двух анонимных пользователей и проверяет, что чужие данные недоступны.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (dev project)');
  process.exit(2);
}

const mk = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const A = mk();
const B = mk();
const a = await A.auth.signInAnonymously();
const b = await B.auth.signInAnonymously();
if (a.error || b.error) {
  console.error('Anonymous sign-in failed (enable it in Auth settings):', a.error?.message ?? b.error?.message);
  process.exit(2);
}
const idA = a.data.user.id;
const idB = b.data.user.id;

// профили создаются триггером
const profA = await A.from('profiles').select('nickname').eq('id', idA).single();
check('профиль создаётся автоматически', !profA.error && /^Игрок-/.test(profA.data?.nickname ?? ''), profA.data?.nickname);

// сохранения: B пишет своё, A не видит и не меняет чужое
await B.from('saves').insert({ user_id: idB, data: { v: 2, secret: 'B' }, schema_version: 2 });
const readB = await A.from('saves').select('*').eq('user_id', idB);
check('A не читает saves B', !readB.error && readB.data.length === 0);
const updB = await A.from('saves')
  .update({ data: { v: 2, hacked: true } })
  .eq('user_id', idB)
  .select();
check('A не меняет saves B', (updB.data ?? []).length === 0);
const insB = await A.from('saves').insert({ user_id: idB, data: { v: 2 }, schema_version: 2 });
check('A не создаёт saves от имени B', Boolean(insB.error));
const own = await A.from('saves')
  .insert({ user_id: idA, data: { v: 2 }, schema_version: 2 })
  .select('rev');
check('A пишет свои saves', !own.error, own.error?.message);

// рейтинг: прямая запись запрещена, только через submit_result
const direct = await A.from('bests').insert({ user_id: idA, mode: 'level', key: 'level:1', score: 10 });
check('прямая запись в bests запрещена', Boolean(direct.error));
const tooHigh = await A.rpc('submit_result', {
  p_mode: 'level',
  p_key: 'level:1',
  p_score: 4999,
  p_stars: 3,
  p_throws: 1,
  p_best_combo: 5,
});
check('завышенный счёт отклоняется', Boolean(tooHigh.error), tooHigh.error?.message);
const okRes = await A.rpc('submit_result', { p_mode: 'level', p_key: 'level:1', p_score: 70, p_stars: 3, p_throws: 2, p_best_combo: 3 });
check('честный результат принимается', !okRes.error, okRes.error?.message);
const tooFast = await A.rpc('submit_result', { p_mode: 'level', p_key: 'level:1', p_score: 60, p_stars: 3, p_throws: 2, p_best_combo: 3 });
check('ограничение частоты (2 с)', Boolean(tooFast.error));
const resB = await B.from('results').select('*').eq('user_id', idA);
check('B не читает журнал A', !resB.error && resB.data.length === 0);
const board = await B.rpc('get_leaderboard', { p_mode: 'level', p_key: 'level:1', p_limit: 20 });
check('рейтинг читается', !board.error && board.data.some((r) => r.score === 70));

// вызовы: создать можно только от своего имени; читать может гость
const fake = await A.from('challenges').insert({ id: 'Zz9Zz9Zz', owner: idB, title: 'x', code: '1.AAAA', throws: 5, par: 3 });
check('A не создаёт вызов от имени B', Boolean(fake.error));
const mine = await A.from('challenges').insert({ id: 'Aa1Aa1Aa', owner: idA, title: 'ok', code: '1.AAAA', throws: 5, par: 3 });
check('A создаёт свой вызов', !mine.error, mine.error?.message);
const anon = mk();
const pub = await anon.from('challenges').select('id').eq('id', 'Aa1Aa1Aa');
check('гость читает вызов по ссылке', !pub.error && pub.data.length === 1);
const delByB = await B.from('challenges').delete().eq('id', 'Aa1Aa1Aa').select();
check('B не удаляет вызов A', (delByB.data ?? []).length === 0);

// удаление аккаунта убирает всё
const del = await A.rpc('delete_me');
check('delete_me выполняется', !del.error, del.error?.message);
const gone = await B.from('challenges').select('id').eq('id', 'Aa1Aa1Aa');
check('вызовы удалённого аккаунта исчезли', !gone.error && gone.data.length === 0);
await B.rpc('delete_me');

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
