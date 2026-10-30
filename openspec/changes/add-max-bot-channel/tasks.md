## 1. Конфиг и клиент MAX

- [x] 1.1 `server/config.ts`: добавить `MAX_BOT_TOKEN` (optional), `MAX_MODE` (`webhook`/`polling`/`off`, по умолчанию `polling` в prod и `off` в dev — по аналогии с `TELEGRAM_MODE`), `MAX_WEBHOOK_SECRET` (optional, аналог `deriveWebhookSecret`)
- [x] 1.2 `server/integrations/max-client.ts`: класс `MaxClient(token)` — `call<T>(method, params)` на базовый URL `https://platform-api2.max.ru`, токен в заголовке `Authorization`; методы `getMe`/эквивалент, `getUpdates(marker, timeout)`, `sendMessage(chatOrUserId, text, {keyboard})`, `editMessage(messageId, text)`, `answerCallback(callbackId, text)`, `subscribe(url, updateTypes)`/`unsubscribe`/`listSubscriptions`; классификация ошибок `MaxError`/`MaxErrorKind` (`blocked`/`rate_limit`/`bad_request`/`server`/`network`/`uncertain`) по аналогии с `TelegramError`
- [x] 1.3 Типы апдейтов MAX (`MaxUpdate`, `MaxMessage`, `MaxChat`, `MaxUser`, `MaxCallback`) в том же файле или `server/integrations/max-types.ts`

## 2. Схема данных

- [x] 2.1 `server/migrations.ts`: колонка `chats.channel TEXT NOT NULL DEFAULT 'telegram'` (под проверкой существования колонки, `ALTER TABLE ADD COLUMN`)
- [x] 2.2 `server/migrations.ts`: колонки `recipients.max_user_id INTEGER UNIQUE`, `max_username TEXT`, `max_status TEXT NOT NULL DEFAULT 'pending'`, `max_activated_at TEXT`, `max_blocked_at TEXT`, `max_menu_message_id INTEGER`
- [x] 2.3 `server/migrations.ts`: колонка `channel TEXT NOT NULL DEFAULT 'telegram'` у `binding_codes`, `chat_claim_codes`, `delivery_jobs`, `delivery_attempts`
- [x] 2.4 `server/migrations.ts`: таблица `max_updates` (аналог `telegram_updates`: `update_id`/порядковый маркер, сырой JSON, статус, попытки, lease)
- [x] 2.5 `server/migrations.ts`: колонка `settings` — `max.marker` (аналог `telegram.offset`) в существующей таблице настроек

## 3. Контракты и модели

- [x] 3.1 `shared/schemas.ts`: `MaxUpdateSchema` (минимальная валидация, по аналогии с `TelegramUpdateSchema`)
- [x] 3.2 `shared/schemas.ts`: расширить `RecipientSchema` полями `maxUserId`, `maxUsername`, `maxStatus`, `maxActivatedAt`, `maxBlockedAt`
- [x] 3.3 `shared/schemas.ts`: параметризовать `BindingCodeSchema`/выдачу кода и `ClaimLinkSchema`/выдачу ссылки дирекции полем `channel: 'telegram' | 'max'`
- [x] 3.4 `shared/schemas.ts`: добавить `channel` в `ChatSchema`, `DeliveryJobSchema`, `DeliveryDetailsSchema`
- [x] 3.5 `server/models/recipient.ts`: добавить MAX-поля в модель `Recipient`/`RecipientWithSubscriptions`
- [x] 3.6 `server/models/chat.ts` (или аналогичный): добавить поле `channel`

## 4. Репозитории

- [x] 4.1 `recipient-repository.ts`: методы `bindMax`, `resetBindingMax`, `markBlockedMax`, `setMaxMenuMessageId`, `findByMaxId`, параметризовать `createCode`/`findCode`/`useCode` полем `channel`
- [x] 4.2 `chat-repository.ts`: учитывать `channel` при создании чата (из события конкретного бота) и при выдаче/проверке `chat_claim_codes`
- [x] 4.3 `server/repositories/max-update-repository.ts`: CRUD очереди `max_updates` (аналог `update-repository.ts`) — `store`, `claim`, `markDone`, `markError`
- [x] 4.4 `delivery-repository.ts`: писать и фильтровать по `channel` в `delivery_jobs`/`delivery_attempts`

## 5. Приём событий MAX

- [x] 5.1 `server/services/max-ingestion-service.ts`: `store(update)` — пишет в `max_updates`, идемпотентно по update-маркеру, будит воркер `wake('max-intake')`; `claim(limit)`/`process(stored)` — диспетчеризация по типу (`message_created` → `onMessage`, `message_edited` → `onEdit`, `bot_added`/`bot_removed` → `onMembership`, `bot_started` → команда привязки/статус, `message_callback` → делегирование в `CallbackRouter`)
- [x] 5.2 Переиспользовать существующую бизнес-логику `onMessage`/`onEdit`/`onMembership` из `ingestion-service.ts` там, где она уже оперирует абстрактными `chat_id`/`message_id`/текстом — выделить общие функции, если это не усложняет чтение каждого файла (см. design.md: не обобщать транспорт целиком)
- [x] 5.3 `server/services/max-intake-service.ts`: `prepare()` (подписка на webhook либо отказ от неё для polling), `pollOnce()` — `getUpdates(marker, timeout)`, сохранение через `max-ingestion-service`, сдвиг `settings.max.marker`
- [x] 5.4 `routes/max.ts`: `POST /api/max/webhook` — публичный, проверка подлинности запроса (секрет/подпись — по фактическому механизму MAX, уточнить при реализации), вход `MaxUpdateSchema`, вызов `maxIngestion.store(update)`, ответ `OkSchema`; зарегистрировать в `routes/index.ts`

## 6. Привязка и команды бота MAX

- [x] 6.1 `recipient-service.ts`: `issueCode(id, channel, actor)` — код/ссылка на нужный канал; `bindByCode(code, channel, identity)` — привязка/слияние в рамках канала, не трогая другой канал получателя
- [x] 6.2 `bot-command-service.ts` (или новый `max-command-service.ts`, если ветвление по каналу усложняет файл — решить при реализации по факту объёма): обработка `bot_started` с `payload` как аналога `/start <код>` в личном диалоге MAX, `/connect <код>` в группе MAX для подключения чата к дирекции
- [x] 6.3 `callback-router.ts`: принимать callback MAX (`message_callback`) наравне с Telegram `callback_query`, передавать канал обработчикам (`OnDemandService`, настройки инцидентов, оценки алертов)
- [x] 6.4 Настройки алертов из меню (`set:*`) и аудит изменения — писать канал, из которого пришло изменение (`max:<id>` по аналогии с `telegram:<id>`)

## 7. Доставка

- [x] 7.1 `delivery-service.ts`: при постановке задания определять `channel` (чат/инцидент → канал чата; `summary` → отдельное задание на каждый канал с подписанными чатами; `menu`/`test`/`tech` → по заданию на каждый активный канал получателя)
- [x] 7.2 `delivery-service.ts`: `process(job)` — выбор клиента (`TelegramClient`/`MaxClient`) и идентификатора получателя по `job.channel`; для `channel === 'max'` не использовать `sendRichMessage`, всегда `content.parts` обычным текстом
- [x] 7.3 `delivery-service.ts`: `onError` — классификация ошибок MAX (`blocked` → `recipients.markBlockedMax`, аналогично остальным)
- [x] 7.4 `rate-limiter.ts`: отдельный лимит на канал MAX, не делящий бюджет с Telegram

## 8. Отчёты и дайджест по каналам

- [x] 8.1 `report-service.ts`/`digest-service.ts`: собирать отчёт получателя за период отдельно по каждому каналу — выборка `chat_period_digests` только по чатам своего канала, `reports` получает колонку `channel`, уникальность — (recipient_id, period_id, channel)
- [x] 8.2 `summary-scheduler-service.ts`: ставить задание доставки на каждый (получатель, канал) с непустым набором чатов за период, а не одно на получателя
- [x] 8.3 `on-demand-service.ts`: `handleCallback`/`currentInterval`/сборка дайджеста — принимать канал вызова и ограничивать выборку чатов этим каналом; троттлинг (`on_demand_requests`) — по паре (получатель, канал)
- [x] 8.4 `summary-render.ts`: убедиться, что путь без rich-HTML (обычный текст) используется для `channel === 'max'` всегда, не только как fallback при отказе Telegram

## 9. Воркеры

- [x] 9.1 `server/workers/runner.ts`: воркер `max-polling` (аналог `polling`) — активен при `MAX_MODE==='polling'`, крутит `maxIntake.pollOnce()`
- [x] 9.2 `server/workers/runner.ts`: воркер `max-intake` (аналог `intake`) — разбирает `max_updates` через `maxIngestion.claim/process`
- [x] 9.3 `server/workers/runner.ts`: воркер `monitor` — добавить проверку `maxBot.getMe()`/аналог, отдельный от Telegram индикатор готовности `max`
- [x] 9.4 `server/index.ts`/`workers/runner.ts`: старт — `maxBot.getMe(true)` и `maxIntake.prepare()`, если `maxBot.configured && maxMode !== 'off'`, независимо от состояния Telegram

## 10. Composition root и роуты

- [x] 10.1 `server/container.ts`: собрать `MaxClient`, `MaxIngestionService`, `MaxIntakeService`, прокинуть зависимости в `DeliveryService`, `RecipientService`, `CallbackRouter`, `OnDemandService`
- [x] 10.2 `routes/index.ts`: зарегистрировать `routes/max.ts`
- [x] 10.3 `routes/recipients.ts`: эндпоинты выдачи кода/отправки меню/тестового уведомления принимают `channel` параметром

## 11. Фронтенд

- [x] 11.1 `src/lib/api.ts`: добавить параметр `channel` в `recipients.issueCode`/`sendMenu`, обновить типы ответа
- [x] 11.2 `src/routes/users.tsx`: колонки/значки статуса по обоим каналам в списке получателей
- [x] 11.3 `src/routes/user-details.tsx`: отдельные блоки Telegram и MAX — идентификатор, статус, выдача кода/ссылки, кнопки «Отправить меню»/«Тестовое уведомление» на каждый канал
- [x] 11.4 `src/routes/chats.tsx`/`chat-details.tsx`: показать канал чата (значок/подпись Telegram или MAX)
- [x] 11.5 `src/hooks/use-recipients.ts`: обновить инвалидацию/типы под новые поля запроса

## 12. Документация

- [x] 12.1 `docs/project.md`: добавить MAX в стек, таблицы (`max_updates`, новые колонки), эндпоинт `/api/max/webhook`, воркеры `max-polling`/`max-intake`, переменные окружения `MAX_*`, запись в «Симптом → причина» про webhook MAX (секрет не подтверждён документацией — по умолчанию polling)
- [x] 12.2 Якорь `AICODE-NOTE:` у места, где формат deep-link/проверка подписи webhook MAX принята по аналогии с Telegram без подтверждения официальной документацией (`max-client.ts` и/или `routes/max.ts`)
