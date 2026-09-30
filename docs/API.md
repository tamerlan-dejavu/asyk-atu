# Облачное API (Supabase)

Схема — `supabase/migrations/0001_init.sql`, пределы счёта — `0002_level_limits.sql` (генерируется из `src/game/levels`). На всех таблицах включён RLS: по умолчанию всё запрещено, разрешено только перечисленное.

## Таблицы

| Таблица                                                                             | Назначение                                                  | Чтение                       | Запись                                                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| `profiles(id, nickname, created_at)`                                                | никнейм (создаётся триггером при регистрации: `Игрок-4821`) | вошедшие                     | только своя строка (`update`)                           |
| `saves(user_id, data jsonb, schema_version, rev, updated_at)`                       | облачное сохранение (без `resume`)                          | только своё                  | только своё; `rev` увеличивает триггер                  |
| `bests(user_id, mode, key, score, stars, throws, best_combo, verified, updated_at)` | лучший результат на режим/ключ → рейтинг                    | вошедшие                     | **только через `submit_result`**                        |
| `results(id, user_id, mode, key, score, …, created_at)`                             | журнал, ≤ 200 на пользователя                               | только свои                  | только через `submit_result`                            |
| `challenges(id, owner, title, code, throws, par, plays, created_at)`                | короткие ссылки на вызовы                                   | все, включая гостя без входа | создать/удалить — владелец; ≤ 20 на владельца (триггер) |
| `level_limits(mode, key, max_score)`                                                | верхняя граница правдоподобного счёта                       | все                          | только миграцией                                        |
| `client_errors(id, user_id, ts, message ≤ 300, build)`                              | ошибки клиента                                              | никто                        | только `insert`, ≤ 5 за 10 минут (триггер)              |

Ключи `bests.key`: `level:<id>`, `daily:<YYYY-MM-DD>`, `endless`, `challenge:<id>`.

## Функции (RPC)

### `submit_result(p_mode, p_key, p_score, p_stars, p_throws, p_best_combo) → (best, place)`

`security definer`, только для `authenticated`.

1. Требует `auth.uid()`.
2. Проверяет диапазоны и `score ≤ level_limits` (точный ключ → общий `*` для режима → 5000).
3. Частота: не чаще раза в 2 секунды (код `53400` — клиент повторит позже).
4. Пишет в `results`, обновляет `bests` по правилу «только если лучше», чистит хвост `results` > 200.
5. Возвращает лучший результат и место.

### `get_leaderboard(p_mode, p_key, p_limit = 20) → (place, nickname, score, stars, verified, is_me)`

`security invoker` (работает под RLS вызывающего): топ-N и своё место ± 2 соседа.

### `challenge_played(p_id)`

Увеличивает `challenges.plays`. Доступна `anon` и `authenticated`.

### `delete_me()`

Удаляет пользователя из `auth.users`; каскадом уходят профиль, сохранения, результаты, рейтинг и вызовы.

## Клиент

- `src/cloud/client.ts` — `isAvailable()` (health-check, тайм-аут 2 с) и ленивый `createClient`.
- `src/cloud/cloud.ts` — вход (гость, email+пароль, превращение гостя в аккаунт), синхронизация (`rev`), очередь результатов, рейтинг, короткие ссылки, отчёт об ошибках.
- `src/cloud/merge.ts` — чистая функция `mergeSaves`, покрыта тестами.
- `src/cloud/outbox.ts` — очередь с экспоненциальной паузой 1 → 60 с.

## Не реализовано (P2)

Edge Function `verify-result` (проверка результата воспроизведением бросков) — описана в `docs/DEFENSE.md` как следующий шаг; колонка `bests.verified` уже есть, сейчас все результаты `verified = false`.
