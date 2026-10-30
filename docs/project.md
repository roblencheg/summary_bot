# Самостоятельное развёртывание

Актуальная эксплуатационная инструкция — в README.md. Node.js 24, Docker Compose, постоянный volume `/app/data`.
`server/platform.ts` реализует SQLite через node:sqlite (WAL, один процесс) и файловое хранилище; RUNTIME_BASE_URL/TOKEN и managed S3 больше не нужны.
Схема автоматически применяется при старте; на чистой БД создаётся только настроенный суперадминистратор, бизнес-данные отсутствуют.
Один экземпляр platform передаётся контейнеру сервисов и закрывается вместе с HTTP-сервером.
`ADMIN_INITIAL_*`, токены каналов, AI endpoint/key, origin и начальные timezone/model задаются окружением (см. .env.example).
Настройки timezone/model из окружения служат умолчаниями: сохранённые через UI значения имеют приоритет.
Cookie Secure определяется HTTPS origin; CORS и CSRF используют PUBLIC_BASE_URL.
API, сущности и слои приложения сохранены. Историческое описание исходной системы приведено ниже; упоминания managed-сервисов относятся к исходнику.

---

# Карта проекта

Указатель: что где лежит и куда идти за чем. Правила работы — в `AGENTS.md`.
**Держи карту в актуальном состоянии**: появилась сущность, эндпоинт, таблица, слой или managed-зависимость — добавь строку.

**Продукт**: мониторинг Telegram-чатов поддержки — сбор сообщений ботом, AI-анализ, инциденты и алерты, саммари 08:00/22:00, админка. Обзор и эксплуатация — `README.md`, настройка — `docs/admin-guide.md`.

**Стек**: React 19 + React Router v7 + @tanstack/react-query + Tailwind v4 + Rsbuild · Fastify 5 (ESM, tsx) + `@fastify/cookie` · zod в `shared/` как единый источник контрактов · managed SQLite/S3/LLM через SDK · Telegram Bot API и MAX Bot API через `fetch`.

## Куда идти за чем

- Контракты API (zod) — `shared/schemas.ts`
- Схема БД, создание таблиц — `server/migrations.ts`, функция `applySchema()`
- SQL любой сущности — `server/repositories/<x>-repository.ts`
- Бизнес-правила — `server/services/<x>-service.ts`
- HTTP-эндпоинты — `server/routes/<x>.ts`, регистрация в `server/routes/index.ts`
- Domain-типы бэка — `server/models/<x>.ts`
- Доступ к managed DB/S3/LLM — `server/platform.ts`
- Валидация env — `server/config.ts`
- Сборка Fastify (CORS, статика) — `server/app.ts`
- Клиент API — `src/lib/api.ts`
- Загрузка данных на фронте — `src/hooks/use-<x>.ts`
- Страницы — `src/routes/*.tsx`, маршруты в `src/router.tsx`
- UI-примитивы — `src/components/ui/`
- Тема и глобальные стили — `src/index.css` (Tailwind v4 настраивается здесь через `@theme`, файла `tailwind.config` нет и заводить не надо)
- Точка входа фронта и провайдеры — `src/main.tsx`
- Мёрж классов `cn()` — `src/lib/utils.ts`
- Настройки кэша react-query — `src/lib/query-client.ts`
- Dev-сервер, порт и проксирование `/api` — `rsbuild.config.ts`
- Фоновые воркеры — `server/workers/`, сборка зависимостей — `server/container.ts`
- Внешние API (Telegram, MAX, AI), промпты — `server/integrations/`
- Чистые функции (периоды, маскирование, разбиение, всплески, политика уведомлений, светофор обстановки `situation.ts`) — `server/domain/`
- Перечисления и подписи (категории, серьёзность, статусы) — `shared/domain.ts`
- Если в корне есть `openspec/`: процесс — `openspec/PROCESS.md`, текущее поведение — `openspec/specs/`, незакрытые предложения — `openspec/changes/`

## Слои бэкенда

```
route ─┐
       ├→ service → repository → platform(db|storage)
worker ┘     │  └→ integrations (Telegram Bot API, AI) — внешние API, без БД
             ├→ domain (чистые функции: периоды, маскирование, разбиение, всплески, политика уведомлений)
             └→ model (тип)
```

- **Route** — разбор запроса, zod-валидация входа и ответа. Доменные ошибки маппит общий обработчик `routes/http.ts`. Нельзя: SQL и бизнес-правила.
- **Worker** (`server/workers/`) — фоновый «транспорт» наравне с route: циклы `WorkerLoop` с таймером и сигналом `wake`. Только вызывает сервисы.
- **Service** — бизнес-логика. Нельзя: знать про HTTP, Fastify и zod-схемы API.
- **Repository** — SQL и операции со storage, маппинг строки в модель. Агрегаты — тоже здесь.
- **Integrations** (`server/integrations/`) — `telegram-client.ts`, `max-client.ts`, `ai-client.ts`, промпты и схемы ответа модели. Схемы ответа модели — это не HTTP-контракт, поэтому они не в `shared/`. Нейтральная клавиатура кнопок (`BotKeyboard` в `server/domain/keyboard.ts`) собирается в проводной формат каждым клиентом отдельно.
- **Domain** (`server/domain/`) — чистые функции без I/O.
- **Model** — форма данных.

**Composition root** — `server/container.ts`: собирает репозитории и сервисы один раз на процесс; его используют роуты и воркеры. Воркеры стартуют в `server/index.ts` после `listen` (`workers/runner.ts`).

**Model против shared-схемы**: `server/models/*` — внутреннее представление, `shared/schemas.ts` — публичный контракт. Лишние поля модели срезает `Schema.parse()` в роуте. Общие перечисления и подписи (категории, серьёзность, статусы) — `shared/domain.ts`.

## Сущности и таблицы

| Сущность | Таблицы | Код |
| --- | --- | --- |
| Администраторы и сессии | `admins` (`role`: `superadmin` / `manager`), `admin_sessions`, `login_attempts` | `admin-repository`, `admin-service`, `routes/auth.ts` |
| Дирекции и права | `directorates`, `admin_directorates` (руководители), `chat_directorates` (`owner` / `reader`, `importance` — важность чата в саммари для дирекции), `directorates.quiet_chats` (режим чатов без событий), `recipient_directorates`, `chat_claim_codes` (`channel` — код подключения чата выдаётся на конкретный канал), `_data_migrations` (маркер переноса `directorates_v1`) | `directorate-repository`, `directorate-service`, `access-service` (scope запроса), `routes/directorates.ts` |
| Настройки | `settings` (`global`, `heartbeat_at`, `scheduler.last_boundary`, `telegram.offset`, `maintenance.last_date`), `chat_rules` | `settings-repository`, `settings-service`, `settings-defaults` |
| Аудит | `audit_log` | `audit-repository`, `audit-service` |
| Сырые апдейты Telegram (очередь приёма) | `telegram_updates` | `update-repository`, `ingestion-service`, `intake-service` |
| Сырые апдейты MAX (очередь приёма) | `max_updates` | `max-update-repository`, `max-ingestion-service`, `max-intake-service` |
| Чаты | `chats` (`channel`: `telegram` / `max`, фиксируется один раз при первом событии), `chat_staff` | `chat-repository`, `chat-service` |
| Участники, сообщения, редакции (очередь анализа) | `participants`, `messages`, `message_revisions` | `message-repository`, `message-service`, `ingestion-service` |
| Пробелы сбора | `collection_gaps` | `gap-repository`, `gap-service` |
| Получатели и привязка | `recipients` (`telegram_*` и параллельные `max_*` колонки — получатель может быть привязан к обоим каналам одновременно), `binding_codes` (`channel`) | `recipient-repository`, `recipient-service`, `bot-command-service`, `max-command-service` |
| Подписки | `summary_subscriptions`, `alert_subscriptions` (категории и мин. серьёзность алертов — колонки `recipients`, общие для обоих каналов) | `subscription-repository`, `subscription-service` |
| Анализ | `analysis_results`, `ai_calls` | `analysis-repository`, `analysis-service` |
| Инциденты | `incidents`, `incident_messages`, `incident_events`, `feedback` | `incident-repository`, `incident-service`, `alert-service`, `spike-service` |
| Периоды и отчёты | `report_periods`, `chat_period_digests`, `reports` (`rich_html` — rich-версия для Telegram; параллельные `max_*`-колонки той же строки — артефакт для MAX, без rich) | `report-repository`, `digest-service`, `report-service` (`assemble(report, recipient, channel)` строит срез по чатам своего канала), `summary-render` (общая раскладка + rich-HTML), `summary-scheduler-service` |
| Доставка | `delivery_jobs` (`channel`), `delivery_attempts` | `delivery-repository`, `delivery-service` (канал задания выбирает клиента и получателя; саммари и «Что сейчас происходит» в Telegram — одним `sendRichMessage`, при `bad_request` — текст частями; в MAX — всегда текст), `rate-limiter` (отдельный лимитер на каждый канал) |
| Меню бота и дайджест «Что сейчас происходит» | `on_demand_requests` (`channel`), `recipients.menu_message_id` / `recipients.max_menu_message_id` | `on-demand-repository`, `on-demand-service`, `callback-router` (нажатия `menu:*` / `fb:*`, канал — в `BotCallback`), `DigestService.buildAdHoc`, `ReportService.assembleOnDemand` |
| Технические уведомления | `tech_alert_state` | `tech-alert-service`, `monitor-service` |
| Обзор, метрики, бэкапы | — / managed S3 `backups/` | `metrics-repository`, `overview-service`, `backup-repository`, `maintenance-service` |

Шаблонная таблица `notes` осталась в БД (без `DROP`), кодом не используется.

## Эндпоинты

Все `/api/*`, кроме отмеченных «публичный», требуют сессию (cookie `sid`). Права — `AccessService`: суперадмин без ограничений; руководитель видит только чаты своих дирекций (владелец или чтение) и получателей своих дирекций — чужое → 404, разделы суперадмина (`settings`, `audit`, `deliveries` без `recipientId`, `periods`, `admins`, `directorates`, `analysis/requeue`, `messages/failed`, `recipients/menu`, `chats/:id/access`) → 403, менять сбор/сотрудников/правила чата с доступом на чтение → 403.

- `GET /api/health` — публичный, `HealthSchema`
- `GET /api/ready` — публичный, `ReadySchema` (503, если компонент не готов)
- `POST /api/telegram/webhook` — публичный, проверка `X-Telegram-Bot-Api-Secret-Token`, вход `TelegramUpdateSchema`, ответ `OkSchema`
- `POST /api/max/webhook` — публичный, вход `MaxUpdateSchema`, ответ `OkSchema`; активен только при `MAX_MODE=webhook` (по умолчанию везде — `polling`, см. «Симптом → причина»)
- `GET /api/auth/status` — публичный, `AuthStatusSchema`
- `POST /api/auth/login` — публичный, вход `LoginInputSchema`, ответ `LoginResponseSchema` (`MeSchema` + `firstLogin` — истина, если это первый вход этого админа; фронт показывает ролик «Как это устроено» сразу)
- `POST /api/auth/logout` — `OkSchema`
- `GET /api/auth/me` — `MeSchema` (роль и дирекции)
- `GET /api/context` — `AppContextSchema` (часовой пояс, расписание, бот, правила по умолчанию — для любой роли)
- `GET /api/directorates` — `DirectoratesOverviewSchema`; `POST /api/directorates`, `PATCH /api/directorates/:id` — `DirectorateNameInputSchema` → `OkSchema`; `POST /api/directorates/managers` — `CreateManagerInputSchema` → `OkSchema`; `PUT /api/directorates/managers/:id` — `DirectorateIdsInputSchema` → `OkSchema`; `PUT /api/chats/:id/access` — `ChatAccessInputSchema` → `OkSchema` (всё — суперадмин)
- `POST /api/chats/claim-link` — `ClaimLinkInputSchema` (`channel`) → `ClaimLinkSchema` (ссылка `?startgroup=<код>` для Telegram, код для `/connect <код>` для MAX)
- `PUT /api/recipients/:id/directorates` — `DirectorateIdsInputSchema` → `RecipientSchema` (суперадмин)
- `PUT /api/chats/:id/importance` — `ChatImportanceInputSchema` → `ChatDetailsSchema` (руководитель — своя дирекция, суперадмин — `directorateId`)
- `PUT /api/directorate-settings/:id` — `QuietChatsInputSchema` → `OkSchema` (режим чатов без событий; руководитель своей дирекции или суперадмин)
- `GET /api/admins` — `AdminsResponseSchema`; `POST /api/admins` — `CreateAdminInputSchema`; `POST /api/admins/:id/password` — `AdminPasswordInputSchema`; `POST /api/admins/:id/disabled` — `AdminDisabledInputSchema`
- `GET /api/overview?hours` — `OverviewQuerySchema` → `OverviewSchema`
- `GET /api/chats` — `ChatsResponseSchema`; `GET /api/chats/:id` — `ChatDetailsSchema`
- `POST /api/chats/:id/activate`, `/deactivate`, `/check-rights` — `ChatSchema`
- `PUT /api/chats/:id/staff` — `ChatStaffInputSchema` → `ChatDetailsSchema`
- `PUT /api/chats/:id/rules` — `ChatRulesOverrideSchema` → `ChatDetailsSchema`
- `GET /api/chats/:id/messages` — `MessagesQuerySchema` → `MessagesResponseSchema`
- `GET /api/messages/failed` — `MessagesResponseSchema`; `GET /api/messages/:id` — `MessageDetailsSchema`
- `POST /api/analysis/requeue` — `RequeueInputSchema` → `RequeueResponseSchema`
- `GET /api/recipients` — `RecipientsResponseSchema`; `POST /api/recipients` — `CreateRecipientInputSchema` → `RecipientSchema`
- `GET /api/recipients/:id`, `PATCH /api/recipients/:id` (`UpdateRecipientInputSchema`), `POST /api/recipients/:id/enabled` (`RecipientEnabledInputSchema`) — `RecipientSchema`
- `POST /api/recipients/:id/menu` — меню бота получателю в указанном канале (`ChannelInputSchema`), `SendMenuResponseSchema` (422, если не активирован в этом канале); `POST /api/recipients/menu` — всем активным в канале, `SendMenuResponseSchema`
- `POST /api/recipients/:id/code` — вход `ChannelInputSchema` → `BindingCodeSchema`; `POST /api/recipients/:id/reset-binding` — вход `ChannelInputSchema`; `DELETE /api/recipients/:id` — `OkSchema`
- `PUT /api/recipients/:id/subscriptions/summary`, `PUT /api/recipients/:id/subscriptions/alert` — `SubscriptionsInputSchema` → `RecipientSchema`
- `GET /api/incidents` — `IncidentQuerySchema` → `IncidentListSchema`; `GET /api/incidents/:id` — `IncidentDetailsSchema`; `POST /api/incidents/:id/status` — `IncidentStatusInputSchema` → `IncidentSchema`
- `GET /api/reports` — `ReportQuerySchema` → `ReportListSchema`; `GET /api/reports/:id` — `ReportDetailsSchema`; `POST /api/reports/manual` — `ManualReportInputSchema` → `ReportSchema`
- `GET /api/periods` — `PeriodsResponseSchema`; `POST /api/periods/:id/rebuild` — `OkSchema`
- `GET /api/deliveries` — `DeliveryQuerySchema` → `DeliveryListSchema`; `GET /api/deliveries/:id` — `DeliveryDetailsSchema`; `POST /api/deliveries/:id/retry` — `DeliveryJobSchema`; `POST /api/deliveries/test` — `TestDeliveryInputSchema` → `OkSchema`
- `GET /api/settings` — `SettingsResponseSchema`; `PUT /api/settings` — `GlobalSettingsSchema` → `SettingsResponseSchema`; `POST /api/settings/backup` — `BackupResponseSchema`
- `GET /api/audit` — `AuditQuerySchema` → `AuditListSchema`
- `GET /api/guide-video` — обучающий ролик руководителя байтами, с `Range` (перемотка); бинарный поток, не JSON — осознанно без zod-схемы ответа (`server/routes/guide.ts`)

## Фоновые воркеры (`server/workers/runner.ts`)

| Воркер | Интервал / сигнал | Что делает |
| --- | --- | --- |
| `intake` | 2 с / `wake('intake')` | Обрабатывает `telegram_updates` по порядку `update_id` |
| `polling` | непрерывно | Только `TELEGRAM_MODE=polling`: `getUpdates` → `telegram_updates` |
| `max-intake` | 2 с / `wake('max-intake')` | Обрабатывает `max_updates` по порядку, независимо от состояния Telegram |
| `max-polling` | непрерывно | Только `MAX_MODE=polling`: `getUpdates` → `max_updates` |
| `analysis` | 2 с / `wake('analysis')` | Пакеты по чатам (debounce 3 с, до 20 сообщений), до 3 чатов параллельно |
| `delivery` | 2 с / `wake('delivery')` | Отправка с повторной проверкой прав, rate limit, повторы; клиент и лимитер — по `job.channel` |
| `spikes` | 30 с | Всплески по активным чатам (работает и без AI) |
| `scheduler` | 15 с / `wake('reports')` | Heartbeat, периоды 08:00/22:00, дайджесты, отчёты (по каждому каналу получателя) |
| `monitor` | 60 с | `getMe` Telegram и MAX, `getWebhookInfo`, технические уведомления, отложенные обновления инцидентов |
| `maintenance` | 30 мин | Раз в сутки после 04:00: сроки хранения и резервная копия |

## Страницы

`src/routes/login.tsx` — вход · `directorates.tsx` — дирекции (суперадмин) · `overview.tsx` — обзор · `chats.tsx`, `chat-details.tsx` — чаты · `users.tsx`, `user-details.tsx` — пользователи · `summaries.tsx` — саммари · `alerts.tsx` — алерты · `incidents.tsx`, `incident-details.tsx` — инциденты · `deliveries.tsx` — журнал отправок · `settings.tsx` — настройки · `audit.tsx` — аудит · `guide.tsx` — обучающий ролик («Как это устроено»). Каркас — `src/components/layout/app-shell.tsx` (навигация по роли: у руководителя — Обзор, Чаты, Пользователи, Инциденты, Отчёты, Как это устроено), защита маршрутов — `Protected` в `src/router.tsx`. Роль — `useMe()`, общий контекст (часовой пояс, бот, правила по умолчанию) — `useAppContext()`; глобальные настройки (`useSettings`) — только у суперадмина.

При первом входе админа (`firstLogin` в ответе логина) `AppShell` сразу открывает модалку с тем же роликом (`src/components/guide-video.tsx`) — проверка одноразовая, через модульный флаг в `use-auth.ts` (`consumeFirstLoginFlag`), без доп. таблиц: признак первого входа — `admins.last_login_at IS NULL` на момент чтения в `AdminService.login()`, до `touchLogin()`.

## Скрипты

`scripts/restore.ts` — восстановление резервной копии · `scripts/eval-alerts.ts` + `scripts/eval/required.jsonl` — калибровка качества алертов.

`tutorial-video/` — обучающий ролик для руководителя (Remotion): демо-данные в dev-БД, снимки интерфейса, озвучка, монтаж. Как пересобрать — `tutorial-video/README.md`. Отдельный пакет со своим `package.json`, в сборку приложения не входит.

## Managed-сервисы (`server/platform.ts`)

```ts
import { createPlatform } from '~server/platform';
const platform = createPlatform(); // читает RUNTIME_BASE_URL / RUNTIME_TOKEN
```

- **DB (SQLite)** — `platform.db.query<Row>(sql, params)`, `.first<Row>()`, `.exec()` → `{changes, lastInsertRowid?}`, `.tables()`. `query()` отдаёт максимум 100 строк за вызов: страницу режет прокси, флаг `hasMore` SDK не пробрасывает — списки читай постранично, `LIMIT/OFFSET` прямо в SQL, страница ≤ 100 (`LIMIT 500` всё равно вернёт 100). Один statement на вызов: `;` внутри запроса → 400. Заблокированы `BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE`, `ATTACH/DETACH`, `LOAD_EXTENSION`, `writable_schema` — матч по слову в любом месте SQL, так что и колонка с именем `release` не пройдёт. Лимит файла БД — 1 ГиБ, при превышении запись отдаёт 400 `db_too_large`; dev-БД у каждого пользователя проекта своя, prod — общая.
- **Storage (S3)** — `.upload(key, body, contentType?)`, `.list({prefix, maxKeys, continuationToken, delimiter})`, `.download(key)`, `.delete(key)`, `.head(key)`, `.usage()` → `{totalBytes, objectCount, limitBytes}`. Лимит 50 МБ на файл; квоту окружения задаёт платформа — текущую смотри через `.usage()`, а не по цифре в этом файле. Превышение — 413 `file_too_large` / `quota_exceeded`. Используется бэкапом (`backup-repository.ts`) и обучающим роликом (`guide-repository.ts`, ключ `guide/intro-video.mp4`, ~41 МБ — близко к лимиту файла, сюда видео большего размера не влезет без сжатия).
- **LLM** — `openaiConfig()` и `geminiConfig()` отдают конфиг для `new OpenAI(...)`, baseURL уже с `/v1`. Нужен `pnpm add openai`.

**Миграции** — `server/migrations.ts`, функция `applySchema(platform)`, вызывается один раз при старте. Только `CREATE TABLE IF NOT EXISTS` и — под проверкой существования колонки — `ALTER TABLE ADD COLUMN`, транзакций нет. Внутри schema-guard: хэш исходника функции пишется в `_schema_done`, поэтому правка DDL внутри функции сама приводит к повторному накату — всего DDL целиком. `CREATE TABLE IF NOT EXISTS` это переживает, `ALTER TABLE ADD COLUMN` — нет: колонка уже есть, придёт `duplicate column name`, ошибка не глушится и старт сервера падает. Добавляй колонку под проверкой:

```ts
const cols = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('notes')");
if (!cols.some((c) => c.name === 'tag')) {
  await platform.db.exec(`ALTER TABLE notes ADD COLUMN tag TEXT`);
}
```

Именно `pragma_table_info(...)` внутри `SELECT`: голый `PRAGMA` прокси не пропустит. `IF NOT EXISTS` для колонок SQLite не поддерживает ни один билд. Колонки — `snake_case`, поля моделей — `camelCase`, маппинг делает `rowToX`. Даты — строка ISO-8601 с `Z`, иначе Safari отдаёт Invalid Date.

**Env** инжектит платформа, `.env` не создавай: `NODE_ENV`, `RUNTIME_BASE_URL`, `RUNTIME_TOKEN`, `OPENAI_*`, `GEMINI_*` плюс пользовательские из дашборда: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_MODE`, `TELEGRAM_WEBHOOK_SECRET`, `MAX_BOT_TOKEN`, `MAX_MODE`, `MAX_WEBHOOK_SECRET`, `ADMIN_INITIAL_LOGIN`, `ADMIN_INITIAL_PASSWORD`, `PUBLIC_BASE_URL`. Валидация — `server/config.ts`. `MAX_MODE` — те же значения и то же умолчание (`polling` в prod, `off` в dev), что у `TELEGRAM_MODE`, по той же причине (см. «Симптом → причина»).

## Команды

`pnpm dev` (через `.platform/dev-start.sh`: бэкенд на :3001, rsbuild на :3000) · `pnpm build` · `pnpm typecheck`.

Path-алиасы из `tsconfig.json`: `~shared/*`, `~server/*`, `~/*`.

**Зависимости — только через `pnpm add`**: старт и сборка идут `pnpm install --frozen-lockfile`, ручная правка `package.json` без обновления `pnpm-lock.yaml` ломает запуск.

**Backend в фоне — только `NODE_OPTIONS="--max-old-space-size=1024" pnpm exec tsx watch server/index.ts &`**: без `watch` правки в `server/*.ts` не подхватываются, пока процесс жив («исправил, а не меняется»). Не оборачивай `.platform/dev-start.sh` в `while true; do … done` — при краше на старте копии накопятся за секунды и получишь OOM.

## Симптом → причина

- **Эндпоинт отдаёт HTML вместо JSON** — путь объявлен без префикса `/api`: в prod его забирает SPA-fallback (`server/app.ts`), в dev его не проксирует rsbuild. Обратный случай, JSON-404 `Route GET:/api/... not found`, — файл роутов не подключён в `server/routes/index.ts`.
- **400 `Potentially unsafe SQL keywords are not allowed`** — в SQL попало `BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE/ATTACH/DETACH/LOAD_EXTENSION/writable_schema`, в том числе как имя колонки. Транзакций в managed-БД нет.
- **Список обрывается на 100 записях** — дефолтная страница managed-БД, а не баг фронта.
- **`duplicate column name`, сервер не стартует** — `ALTER TABLE ADD COLUMN` в `applySchema()` накатился повторно, см. «Миграции».
- **ZodError на клиенте** — сервер вернул не то, что обещает `shared/schemas.ts`. Чини сервер или схему, а не `as any`.
- **400 «Некорректные данные» на ответе с чатом внутри** — `ChatSchema` требует `access`/`ownerDirectorate`/`importance`, их добавляет `decorate` в `routes/chats.ts`. Во вложенных ответах (отчёт и т. п.) бери `ChatSchema.pick(...)` или декорируй чат.
- **Правка в `server/*.ts` не подхватилась** — бэкенд поднят без `tsx watch`.
- **Привязка не срабатывает, `/start` «теряется», `getWebhookInfo` — `Connection timed out`** — Telegram не достаёт до домена деплоя. Prod работает в режиме `polling` и при старте сам снимает webhook; не включай `TELEGRAM_MODE=webhook`, пока домен не станет доступен извне.
- **MAX: `/api/max/webhook` не включай** — та же недостижимость домена, что у Telegram, плюс подпись/секрет webhook-запроса MAX не задокументирована однозначно (см. `server/integrations/max-client.ts`) — `MAX_MODE=polling` везде, пока это не прояснится.
- **MAX: `getUpdates` падает с `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`** — `platform-api2.max.ru` отдаёт сертификат от российского национального УЦ (Минцифры), которого нет в дефолтном доверенном наборе Node. Исправлено подключением `NODE_EXTRA_CA_CERTS=/workspace/server/certs/russian-trusted-ca-bundle.pem` в `.platform/dev-start.sh`/`.platform/prod-start.sh` — применяется только при полном перезапуске контейнера (переменная окружения читается Node при старте процесса, `tsx watch` её не подхватит на лету).
- **MAX: бот в группе «молчит» (аналог Telegram privacy mode)** — по официальной схеме MAX `message_created` в группе бот получает только если он администратор с правом `read_all_messages`; без этого чат выглядит активным (`status: active`), но ни одно сообщение не доходит — тихо, без апдейта об ошибке. Проверяется `GET /chats/{chatId}/members/me` (`ChatService.checkRightsMax`, вызывается при `bot_added` и по кнопке «Проверить права»); `bot_added` не несёт название группы — его тоже подтягивает `checkRightsMax` через `GET /chats/{chatId}`.
- **MAX: название чата после первого сообщения снова превращается в «Чат `<id>`»** — у MAX `message_created`/`bot_added` не несут title чата (в отличие от Telegram, где он есть в каждом апдейте), а `ChatRepository.upsertSeen` безусловно перезаписывает `title` на каждый вызов (для Telegram это нужно — подхватывает переименования). `MaxIngestionService.onMessage`/`onMembership` раньше каждый раз генерировали плейсхолдер `Чат <id>` и этим затирали уже известное правильное название, полученное через `checkRightsMax`. Исправлено: `knownTitle()` подставляет уже сохранённый title вместо плейсхолдера. Пострадавший побочный эффект: уже отправленные алерты/саммари с этим багом навсегда остаются с текстом «Чат `<id>>»`» — текст сообщения не перерендеривается после отправки.
- **MAX: в алертах/саммари нет ссылки на сообщение (есть у Telegram)** — подтверждено официальной схемой MAX: `link` у `Message`/`NewMessageBody` — это ссылка на сообщение для reply/forward, не публичный URL; постоянного permalink на сообщение в MAX не существует. `Chat.link` — ссылка-приглашение в чат, но только для публичных чатов (`is_public: true`); у приватных групп (обычный случай для рабочих чатов) — `null`. Фоллбэк для MAX — тот же текстовый формат «название, сообщение #id», что у Telegram-групп без ссылки (не баг, а общий для обоих каналов случай «ссылки нет»).
- **MAX: привязка и любая доставка в личку отвечают `404 Chat not found`** — у MAX `POST /messages` различает адресацию: `chat_id` — только группа/канал, `user_id` — личный диалог; это разные id-пространства (в отличие от Telegram, где у приватного чата `chat_id == user_id`). Весь приватный обмен (привязка, саммари, алерты, меню, тест) должен идти через `user_id` — `MaxClient.sendMessage` в `max-client.ts`; `chat_id`/`sendToChat` — только для ответа в группу (подключение чата к дирекции, `max-command-service.ts`).
- **MAX: ответ в личку падает с `Invalid chatId: 0`** — в `Message.recipient.user_id` («если сообщение адресовано пользователю») для входящего от человека сообщения это получатель-бот, а не отправитель; при подстановке в `?? m.sender.user_id` значение не было `null`/`undefined`, поэтому запасной вариант не срабатывал. Адрес для ответа в диалоге MAX — всегда `m.sender.user_id` (`max-ingestion-service.ts`), не `recipient.user_id`.
- **`409 Conflict` от `getUpdates`** — у токена установлен webhook или работает другой потребитель (например, prod). В dev с prod-токеном держи `TELEGRAM_MODE=off`, для отладки приёма — отдельный тестовый бот.
- **`lastInsertRowid` есть, а строки нет** — managed `/db/exec` возвращает `lastInsertRowid` и при `changes = 0` (`ON CONFLICT DO NOTHING`). Решай по `changes`, id перечитывай `SELECT`-ом.
- **`RETURNING` в `exec` не возвращает строк**, а `/db/query` не пускает `UPDATE`. Захват очереди — `UPDATE … SET lease_token = ?` и затем `SELECT … WHERE lease_token = ?`.
- **Бот в группе «молчит»** — privacy mode: бот видит только команды. Отключи в @BotFather и добавь бота заново или сделай его администратором.
- **Cookie сессии не ставится в превью** — в dev cookie `SameSite=None; Secure`, нужен https-адрес превью. В prod — `Strict` на своём домене.
- **В саммари у чата нет итоговой фразы или «Требует решения» без имён у инцидентов** — дайджест построен до `digest-v3` (нет `headline`, `authorName`) или без AI. Пересобери период в «Периодах».
- **Чат пропал из «Чатов» и из подписок** — бота удалили из группы: чат во вкладке «Архив», подписки сняты `SubscriptionService.purgeChat` (вызывается из `ChatService.botMembershipChanged`). При возврате бота подписки не восстанавливаются — так задумано.
- **В Telegram-отчёте нет пробела сбора, а в веб-интерфейсе он есть** — пробелы короче `TECH.reportGapMinMs` (30 мин) скрываются в рендере отчёта намеренно.
- **Кнопка `set:*` «молчит»** — нажатия меню маршрутизирует `CallbackRouter`: `menu:*` → `OnDemandService`, `set:*` → `IncidentSettingsService`, остальное → оценки алертов.
- **`near "DO": syntax error` при `INSERT … SELECT … FROM t ON CONFLICT`** — без `WHERE` SQLite читает `ON` как условие JOIN. Пиши `… FROM t WHERE 1 ON CONFLICT DO NOTHING`.
- **Руководитель не видит чат, хотя бот в группе** — чат добавлен без ссылки руководителя и лежит в «Дирекции» → «Неразобранные»; назначить владельца может суперадмин.
- **В саммари нет строки «Без событий», хотя чат пустой** — в периоде был пробел сбора от 30 минут: такой чат не считается тихим и показывается с пометкой о неполных данных.
- **Руководитель получает 403 на `/api/settings`** — так задумано: ему доступен только `/api/context`.
- **`openspec validate` «ничего не проверил»** — без `--all` или имени изменения в неинтерактивном режиме это пустышка с кодом 0.
- **В журнале попыток `rich_rejected`, отчёт пришёл частями** — Telegram отклонил rich-HTML (`bad_request`): `rich_html` очищен, отправлен запасной текст. Проверь разметку `summary-render.ts` (в ячейках таблиц — только инлайн-теги).
- **Поле есть в модели/БД, но на фронте `undefined`** — zod-схема ответа (`shared/schemas.ts`) не содержит ключ: `z.object(...).parse()` молча отбрасывает всё, чего нет в схеме (не ошибка, а потеря поля). Так `reports.maxParts` не доходил до клиента, хотя был в `Report`/`report-repository.ts`. При добавлении канального поля в модель — сразу добавляй его и в DTO-схему, иначе компилятор не поймает.
- **Эндпоинт падает с ZodError на ровном месте** — ответ собран без одного из required-полей новой схемы (например, `AppContextSchema.maxBotUsername` после добавления канала). `.parse()` на объект без обязательного ключа — это ошибка, а не `undefined`; `.nullable()` ≠ `.optional()`.
- **Rich-версии у отчёта нет** — `renderRichWithinLimits` не уложился в лимиты (≤30 000 символов, ≤480 блоков) даже без списка обращений — отправляется текст.
- **Dev: `Module not found` на существующий файл, а `pnpm build` проходит** — устаревший кэш `rsbuild dev`. `pkill` в контейнере нет: найди PID через `/proc/*/cmdline` и `kill` процессы `rsbuild`/`tsx` (не PID 1), supervisor перезапустит.
