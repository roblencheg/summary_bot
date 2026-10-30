## 1. Данные

- [x] 1.1 Колонки `chat_directorates.importance`, `directorates.quiet_chats` (`ALTER TABLE ADD COLUMN` с проверкой)
- [x] 1.2 `DirectorateRepository`: установка важности и режима, чтение для получателя
- [x] 1.3 `DirectorateService`: `setImportance`, `setQuietChats` (аудит), `summaryPrefs(recipientId)`

## 2. Рендер

- [x] 2.1 `ReportService.render`: порядок по важности, «★», тихие чаты по режиму, общий цвет и «Требует решения» по всем чатам
- [x] 2.2 `assemble` и `assembleOnDemand` с предпочтениями получателя

## 3. API и интерфейс

- [x] 3.1 Эндпоинты `PUT /api/chats/:id/importance`, `PUT /api/directorate-settings/:id`; поля в `ChatSchema`, `MeSchema`, `DirectoratesOverviewSchema`
- [x] 3.2 Карточка чата: важность; «Чаты»: режим тихих чатов дирекции; «Дирекции»: важность и режим для суперадмина

## 4. Проверка и документация

- [x] 4.1 `pnpm typecheck`, `pnpm build`, `openspec validate --all --strict`
- [x] 4.2 Проверка на dev: порядок по важности, три режима тихих чатов, все чаты пустые, права (чужой чат — 404)
- [x] 4.3 `docs/admin-guide.md`, `docs/project.md`
