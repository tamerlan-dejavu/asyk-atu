-- Асық ату: схема облака (Supabase Postgres). Все таблицы под RLS: по умолчанию всё запрещено.
-- Применение: supabase db push (см. docs/RUNBOOK.md).

-- ---------------------------------------------------------------- таблицы
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  nickname text unique not null check (nickname ~ '^[[:alnum:]_ .-]{3,16}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.saves (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null check (pg_column_size(data) < 200000),
  schema_version int not null,
  rev bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.bests (
  user_id uuid not null references auth.users on delete cascade,
  mode text not null check (mode in ('level', 'endless', 'daily', 'challenge')),
  key text not null check (char_length(key) <= 40),
  score int not null check (score between 0 and 5000),
  stars int check (stars between 0 and 3),
  throws int check (throws between 0 and 500),
  best_combo int check (best_combo between 0 and 30),
  verified boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode, key)
);
create index if not exists bests_board on public.bests (mode, key, score desc, updated_at);

create table if not exists public.results (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  mode text not null,
  key text not null,
  score int not null,
  stars int,
  throws int,
  best_combo int,
  created_at timestamptz not null default now()
);
create index if not exists results_user on public.results (user_id, created_at desc);

create table if not exists public.challenges (
  id text primary key check (id ~ '^[A-Za-z0-9]{8}$'),
  owner uuid not null references auth.users on delete cascade,
  title text not null default '' check (char_length(title) <= 24),
  code text not null check (char_length(code) <= 600 and code ~ '^1\.[A-Za-z0-9_-]+$'),
  throws int not null check (throws between 3 and 10),
  par int not null check (par between 1 and 10),
  plays int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists challenges_owner on public.challenges (owner);

-- верхняя граница правдоподобного счёта; заполняется 0002_level_limits.sql (генерируется из levels.ts)
create table if not exists public.level_limits (
  mode text not null,
  key text not null,
  max_score int not null,
  primary key (mode, key)
);

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid(),
  ts timestamptz not null default now(),
  message text not null check (char_length(message) <= 300),
  build text check (char_length(build) <= 40)
);

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.saves enable row level security;
alter table public.bests enable row level security;
alter table public.results enable row level security;
alter table public.challenges enable row level security;
alter table public.level_limits enable row level security;
alter table public.client_errors enable row level security;

-- профили: никнеймы видны вошедшим (для рейтинга); менять — только свой
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- сохранения: только свои
create policy saves_read on public.saves for select to authenticated using (user_id = auth.uid());
create policy saves_insert on public.saves for insert to authenticated with check (user_id = auth.uid());
create policy saves_update on public.saves for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- рейтинг: читать могут вошедшие; ПРЯМОЙ записи нет — только через submit_result()
create policy bests_read on public.bests for select to authenticated using (true);

-- журнал результатов: только свои, запись только через submit_result()
create policy results_read on public.results for select to authenticated using (user_id = auth.uid());

-- вызовы: читает кто угодно (ссылка работает до входа); создаёт/удаляет владелец
create policy challenges_read on public.challenges for select to anon, authenticated using (true);
create policy challenges_insert on public.challenges for insert to authenticated with check (owner = auth.uid());
create policy challenges_delete on public.challenges for delete to authenticated using (owner = auth.uid());

-- пределы счёта: читают все (клиент может показать), пишет только миграция
create policy limits_read on public.level_limits for select to anon, authenticated using (true);

-- ошибки клиента: только вставка
create policy errors_insert on public.client_errors for insert to authenticated with check (user_id is null or user_id = auth.uid());

-- ---------------------------------------------------------------- триггеры
-- не более 5 ошибок клиента за 10 минут на пользователя
create or replace function public.client_errors_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.client_errors
      where user_id = new.user_id and ts > now() - interval '10 minutes') >= 5 then
    return null; -- молча отбрасываем
  end if;
  return new;
end $$;
drop trigger if exists client_errors_limit on public.client_errors;
create trigger client_errors_limit before insert on public.client_errors
  for each row execute function public.client_errors_limit();

-- не более 20 вызовов на владельца
create function public.challenges_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.challenges where owner = new.owner) >= 20 then
    raise exception 'challenge limit reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger challenges_limit before insert on public.challenges
  for each row execute function public.challenges_limit();

-- rev сохранения растёт на сервере; клиент передаёт ожидаемый rev (оптимистичная блокировка)
create or replace function public.saves_touch() returns trigger
language plpgsql as $$
begin
  new.rev := coalesce(old.rev, 0) + 1;
  new.updated_at := now();
  return new;
end $$;
create trigger saves_touch before update on public.saves
  for each row execute function public.saves_touch();

-- ---------------------------------------------------------------- функции
-- Отправка результата: единственный путь записи в рейтинг.
create or replace function public.submit_result(
  p_mode text, p_key text, p_score int, p_stars int, p_throws int, p_best_combo int
) returns table (best int, place bigint)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lim int;
  last_at timestamptz;
begin
  if uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;
  if p_mode not in ('level', 'endless', 'daily', 'challenge') or char_length(p_key) > 40 then
    raise exception 'bad mode/key' using errcode = '22023';
  end if;
  if p_score < 0 or p_stars not between 0 and 3 or p_throws not between 0 and 500 or p_best_combo not between 0 and 30 then
    raise exception 'out of range' using errcode = '22023';
  end if;
  -- предел: точный ключ → общий для режима ('*') → глобальный 5000
  select max_score into lim from public.level_limits where mode = p_mode and key = p_key;
  if lim is null then
    select max_score into lim from public.level_limits where mode = p_mode and key = '*';
  end if;
  if p_score > coalesce(lim, 5000) then
    raise exception 'score above limit' using errcode = '22023';
  end if;
  -- частота: не чаще раза в 2 секунды
  select max(created_at) into last_at from public.results where user_id = uid;
  if last_at is not null and last_at > now() - interval '2 seconds' then
    raise exception 'too frequent' using errcode = '53400';
  end if;

  insert into public.results (user_id, mode, key, score, stars, throws, best_combo)
  values (uid, p_mode, p_key, p_score, p_stars, p_throws, p_best_combo);

  insert into public.bests as b (user_id, mode, key, score, stars, throws, best_combo)
  values (uid, p_mode, p_key, p_score, p_stars, p_throws, p_best_combo)
  on conflict (user_id, mode, key) do update set
    score = greatest(b.score, excluded.score),
    stars = greatest(coalesce(b.stars, 0), coalesce(excluded.stars, 0)),
    throws = case when excluded.score > b.score then excluded.throws else b.throws end,
    best_combo = greatest(coalesce(b.best_combo, 0), coalesce(excluded.best_combo, 0)),
    updated_at = case when excluded.score > b.score then now() else b.updated_at end;

  -- хвост журнала: не более 200 записей на пользователя
  delete from public.results r
  where r.user_id = uid and r.id not in (
    select id from public.results where user_id = uid order by created_at desc limit 200
  );

  return query
    select b.score, (
      select count(*) + 1 from public.bests o
      where o.mode = p_mode and o.key = p_key and o.score > b.score
    )
    from public.bests b where b.user_id = uid and b.mode = p_mode and b.key = p_key;
end $$;

-- Рейтинг: топ-N и своё место с соседями (никнеймы из profiles).
create or replace function public.get_leaderboard(p_mode text, p_key text, p_limit int default 20)
returns table (place bigint, nickname text, score int, stars int, verified boolean, is_me boolean)
language sql stable security invoker set search_path = public as $$
  with ranked as (
    select rank() over (order by b.score desc, b.updated_at asc) as place,
           coalesce(p.nickname, 'Player') as nickname, b.score, b.stars, b.verified,
           b.user_id = auth.uid() as is_me
    from public.bests b left join public.profiles p on p.id = b.user_id
    where b.mode = p_mode and b.key = p_key
  ), me as (select place from ranked where is_me limit 1)
  select * from ranked
  where place <= least(greatest(p_limit, 1), 100)
     or (exists (select 1 from me) and place between (select place from me) - 2 and (select place from me) + 2)
  order by place, nickname;
$$;

-- Счётчик прохождений вызова (доступен и гостю без входа).
create or replace function public.challenge_played(p_id text) returns void
language sql security definer set search_path = public as $$
  update public.challenges set plays = plays + 1 where id = p_id;
$$;

-- Удаление аккаунта и всех данных (каскадом: профиль, сохранения, результаты, рейтинг, вызовы).
create or replace function public.delete_me() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'auth required' using errcode = '28000';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

-- права на функции
revoke all on function public.submit_result(text, text, int, int, int, int) from public, anon;
grant execute on function public.submit_result(text, text, int, int, int, int) to authenticated;
revoke all on function public.get_leaderboard(text, text, int) from public;
grant execute on function public.get_leaderboard(text, text, int) to authenticated;
revoke all on function public.challenge_played(text) from public;
grant execute on function public.challenge_played(text) to anon, authenticated;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;
revoke all on function public.client_errors_limit() from public, anon, authenticated;
revoke all on function public.challenges_limit() from public, anon, authenticated;

-- Профиль создаётся автоматически при регистрации (в т.ч. анонимной): никнейм «Игрок-4821».
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  nick text;
  i int := 0;
begin
  loop
    nick := 'Игрок-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from public.profiles where nickname = nick) or i > 20;
    i := i + 1;
  end loop;
  if i > 20 then
    nick := 'Игрок-' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  insert into public.profiles (id, nickname) values (new.id, nick) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public, anon, authenticated;
