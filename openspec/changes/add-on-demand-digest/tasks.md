## 1. Схема и контракты

- [x] 1.1 В `applySchema()`: `ALTER TABLE recipients ADD COLUMN menu_message_id INTEGER` под проверкой `pragma_table_info`, таблица `on_demand_requests (id, recipient_id, requested_at, status, chat_ids, from_at, to_at)` с индексом по `(recipient_id, requested_at)`
- [x] 1.2 Типы доставки `menu` и `on_demand` с подписями в `shared/domain.ts`; zod-схемы `SendMenuResponseSchema` (`queued`) в `shared/schemas.ts`

## 2. Telegram и обработка нажатий

- [x] 2.1 `TelegramClient.pinChatMessage(chatId, messageId)` с `disable_notification: true`
- [x] 2.2 `CallbackRouter` в `ingestion-service`: `fb:*` → `IncidentService`, `menu:*` → `OnDemandService`; неизвестное — «Неизвестное действие»

## 3. Дайджест по запросу

- [x] 3.1 `DigestService.buildAdHoc(chatId, from, to)` на тех же SQL-агрегатах и AI-вызове без записи в `chat_period_digests`; кэш в памяти на 2 минуты по чату и интервалу
- [x] 3.2 Выделить из `ReportService.render` рендер для произвольного интервала; заголовок «📍 Что сейчас происходит · на HH:MM», пометка о незакрытом периоде, разбиение на части
- [x] 3.3 `OnDemandRepository` (запись нажатия, последнее нажатие получателя) и `OnDemandService`: проверка получателя по Telegram ID, лимит 1 раз в 2 минуты, интервал `[начало текущего периода, сейчас)`, чаты = подписки саммари ∪ алертов, `answerCallbackQuery`, постановка задания `on_demand`
- [x] 3.4 `DeliveryService`: сборка `on_demand` при отправке с повторной проверкой прав; `menu` — текст меню, inline-кнопка `menu:now`, после отправки `pinChatMessage` и сохранение `menu_message_id` (ошибка закрепления — в попытках, отправка успешна)

- [x] 3.5 После успешной привязки в `BotCommandService` ставить задание `menu` получателю (вслед за ответом о привязке)

## 4. API и интерфейс

- [x] 4.1 `POST /api/recipients/:id/menu` (ошибка 422 для неактивного) и `POST /api/recipients/menu` (всем активным, ответ — число заданий); регистрация, аудит
- [x] 4.2 Кнопка «Отправить меню бота» в `user-details.tsx`, «Отправить меню всем активным» в `users.tsx`; подписи новых типов в журнале отправок

## 5. Проверка и документация

- [x] 5.1 Прогнать сценарии на dev синтетикой: интервал днём и ночью, лимит частоты, отзыв доступа, кэш дайджеста; `pnpm typecheck`, `pnpm build`
- [x] 5.2 Обновить `docs/project.md` (эндпоинты, таблица, сервис), `docs/admin-guide.md` (меню бота), README (кнопка в боте)
