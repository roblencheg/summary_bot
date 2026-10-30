## Контекст

Саммари и «Что сейчас происходит» рендерит `ReportService.render`; цвет чата — `chatSituation` (`server/domain/situation.ts`). После этапа Б доступ дирекций к чатам хранится в `chat_directorates`, состав дирекций получателя — в `recipient_directorates`.

## Решения

1. **Хранение.** `chat_directorates.importance TEXT NOT NULL DEFAULT 'normal'` — важность у каждой дирекции своя (дирекция с доступом на чтение тоже ранжирует чат для своих получателей). `directorates.quiet_chats TEXT NOT NULL DEFAULT 'line'`. Обе колонки — `ALTER TABLE ADD COLUMN` с проверкой.
2. **Предпочтения получателя** — `DirectorateService.summaryPrefs(recipientId)`: по его дирекциям и строкам доступа → `{ importance: Map<chatId, rank>, quiet: 'full'|'line'|'hide' }`; важность — максимум, режим — самый подробный (`full` > `line` > `hide`). Два SQL-запроса на отчёт.
3. **Рендер.** Сортировка `importance desc → levelRank desc → title`. «Без событий» = цвет ⚪ (нет сообщений) и нет длинных пробелов сбора. Режим `line`: такие чаты убираются из светофора и разделов, после светофора строка «⚪ Без событий: …»; `hide` — убираются полностью; `full` — как раньше. Общий цвет, итоги и «Требует решения» считаются по всем чатам (на них тихие чаты не влияют).
4. **«Что сейчас происходит»** — `assembleOnDemand(recipientId, chatIds, from, to)` с теми же предпочтениями.
5. **API.** `PUT /api/chats/:id/importance` `{ directorateId?, importance }`: руководитель — только свои дирекции с доступом к чату (по умолчанию первая такая), суперадмин — `directorateId` обязателен. `PUT /api/directorate-settings/:id` `{ quietChats }`: руководитель своей дирекции или суперадмин. Текущие значения: в `MeSchema.directorates[].quietChats`, в `ChatSchema.importance` (для своей дирекции), в `DirectoratesOverviewSchema` (для суперадмина).

## Риски / Компромиссы

- [Режим «скрывать» прячет и чаты, где бот перестал получать сообщения из-за прав] → Такие чаты красятся в светофоре причинами из обзора/карточки, а долгие пробелы сбора не считаются «без событий».
- [Разные руководители ставят чату разную важность] → Важность хранится по дирекциям, получателю — максимум.
