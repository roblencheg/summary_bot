## 1. Снятие подписок при архивации

- [x] 1.1 `SubscriptionRepository.removeChatEverywhere(chatId)`: вернуть затронутых получателей по summary и alert, затем удалить строки по `chat_id` из обеих таблиц
- [x] 1.2 `SubscriptionService.purgeChat(chatId, actor)`: вызов репозитория + аудит `subscription.chat_archived` со старым списком получателей

## 2. Вызов из обработки membership

- [x] 2.1 `container.ts`: собрать `subscriptions` раньше `chats`, передать в конструктор `ChatService`
- [x] 2.2 `ChatService.botMembershipChanged`: вызвать `subscriptions.purgeChat(chatId, 'telegram')` при переходе в `removed` (после `setStatus`, рядом с `gaps.openBotRemoved`)

## 3. Веб-интерфейс

- [x] 3.1 `src/routes/chats.tsx`: вкладки «Активные» / «Архив» по статусу, счётчик чатов на вкладке
- [x] 3.2 `chat-details.tsx`: уведомление для архивного чата — «Бот удалён, чат в архиве, подписки сняты, история сохранена»

## 4. Проверка и документация

- [x] 4.1 `pnpm typecheck` и `pnpm build`
- [x] 4.2 Проверка на dev синтетикой: удаление бота у подписанного чата → подписки у всех получателей исчезли, чат во вкладке «Архив», история (сообщения/инциденты) доступна; возврат бота → статус восстановлен, подписок нет
- [x] 4.3 Обновить `docs/project.md` (раздел «Чаты» в UI, `purgeChat`) и `docs/admin-guide.md`
