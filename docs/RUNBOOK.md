# Runbook: развёртывание и эксплуатация

## 1. Развернуть с нуля

### 1.1 Игра (без облака) — 5 минут

1. Vercel → **Add New → Project** → импорт `tamerlan-dejavu/asyk-atu`. Настройки берутся из `vercel.json` (Vite, `npm run build`, `dist`).
2. Deploy. Production собирается из `main`, preview — из каждой ветки и pull request.
3. GitHub → Settings → Secrets and variables → Actions → **Variables**: `SITE_URL` = адрес production (для `uptime.yml`).
4. Post-deploy smoke: production проверяется по `SITE_URL` (по умолчанию `https://asyk-atu.vercel.app`). Адреса отдельных preview-деплоев Vercel закрыты защитой (302 на вход в Vercel); чтобы проверять и их, в Vercel → Settings → Deployment Protection → **Protection Bypass for Automation** создать секрет и добавить его в GitHub как secret `VERCEL_AUTOMATION_BYPASS_SECRET`. Без секрета smoke для preview пропускается с пометкой, а не падает.

### 1.2 Облако (Supabase) — 15 минут

1. На supabase.com создать **два** проекта: `asyk-atu-prod` и `asyk-atu-dev` (бесплатный план допускает два активных).
2. В каждом: **Authentication → Sign In / Providers**
   - включить **Allow anonymous sign-ins** (гость в один клик);
   - Email: **выключить Confirm email** (встроенная почта Supabase имеет жёсткие лимиты и сломает регистрацию проверяющим);
   - Authentication → URL Configuration: Site URL = адрес Vercel.
3. Применить миграции (Supabase CLI):
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref-dev>
   npx supabase db push          # применит supabase/migrations/0001_init.sql и 0002_level_limits.sql
   ```
   Повторить для prod (`link` на `<ref-prod>`). Без CLI: SQL Editor → вставить содержимое файлов по порядку.
4. Vercel → Project → Settings → **Environment Variables**:

   | Переменная               | Production       | Preview         |
   | ------------------------ | ---------------- | --------------- |
   | `VITE_CLOUD_ENABLED`     | `true`           | `true`          |
   | `VITE_SUPABASE_URL`      | URL prod-проекта | URL dev-проекта |
   | `VITE_SUPABASE_ANON_KEY` | anon key prod    | anon key dev    |

   **Ключ `service_role` не использовать нигде.**

5. Redeploy. В «Настройки → Профиль» должен появиться «Войти гостем».
6. GitHub → Actions variables: `SUPABASE_URL` (prod), secret `SUPABASE_ANON_KEY` (prod) — для uptime/keep-alive.
7. Проверить политики (dev-проект):
   ```bash
   SUPABASE_URL=https://<ref-dev>.supabase.co SUPABASE_ANON_KEY=<anon-dev> npm run check:rls
   ```
   Ожидается `N/N passed`.

### 1.3 Изменили уровни

`npm run gen:limits` → появится новая версия `supabase/migrations/0002_level_limits.sql` (тест упадёт, если забыть) → `supabase db push`.

## 2. Откат деплоя

- **Быстро (секунды):** Vercel → Deployments → предыдущий успешный production → **⋯ → Instant Rollback**.
- **В репозитории:** `git revert <sha>` → push в `main` → Vercel задеплоит исправленную версию. Историю не переписываем (`push --force` в `main` запрещён).

## 3. Supabase недоступен или «уснул»

- Игра продолжает работать локально (облачные кнопки показывают «Облако недоступно»), результаты копятся в очереди и отправятся позже.
- Бесплатный проект засыпает после недели без активности: `uptime.yml` раз в 6 часов делает запрос и держит его бодрым. Если всё же уснул — Supabase Dashboard → **Restore project** (1–2 минуты).
- Если проблема надолго: Vercel → Environment Variables → `VITE_CLOUD_ENABLED=false` → Redeploy — облако полностью скрыто.

## 4. Ротация ключей

1. Supabase → Project Settings → API → **Rotate anon key** (JWT secret).
2. Обновить `VITE_SUPABASE_ANON_KEY` в Vercel (Production/Preview) и secret `SUPABASE_ANON_KEY` в GitHub.
3. Redeploy. Пользователям придётся войти заново (сессии со старым секретом недействительны).
4. Если ключ утёк в репозиторий — gitleaks покажет это в CI; после ротации удалить из истории не требуется (старый ключ уже недействителен).

## 5. Релиз сдачи

```bash
git tag -a v1.0.0-submission -m "Сдача Narxoz Incubator 2026"
git push origin v1.0.0-submission
gh release create v1.0.0-submission --title "Asyk Atu — submission" --notes-file docs/RELEASE_NOTES.md
```

После релиза включить Dependabot: переименовать `.github/dependabot.yml.after-submission` → `dependabot.yml` (инструкция внутри).

## 6. Защита `main`

GitHub → Settings → Branches → **Add rule** для `main`: _Require status checks to pass_ → `verify`. Если правило недоступно на тарифе, действует договорённость: в `main` вливаем только при зелёном CI (см. README).
