## 1. Рендер

- [x] 1.1 `summary-render.ts`: общая раскладка (`plan`, `totals`, `decisionRows`, `commonTopics`) и `renderRich`, `renderRichWithinLimits`
- [x] 1.2 `ReportService`: текстовый рендер на общей раскладке; `assemble`/`assembleOnDemand` возвращают `rich`

## 2. Данные и доставка

- [x] 2.1 Колонка `reports.rich_html` (`ALTER TABLE ADD COLUMN` с проверкой), `ReportSchema.richHtml`
- [x] 2.2 `TelegramClient.sendRichMessage`; `DeliveryService`: rich одним сообщением, при `bad_request` — текст частями (`rich_rejected`)

## 3. Интерфейс и документация

- [x] 3.1 Просмотр отчёта: rich-версия «как в Telegram»
- [x] 3.2 `docs/project.md`, `docs/admin-guide.md`

## 4. Проверка

- [x] 4.1 `pnpm typecheck`, `pnpm build`, `openspec validate --all --strict`
- [x] 4.2 Реальная отправка дневного саммари в rich-формате (Telegram принял)

## 5. Доработки

- [x] 5.1 Убрать часовой пояс из строки периода
- [x] 5.2 Спокойные (🟢) чаты: «Инцидентов нет» вместо фраз AI; промпт не пишет утверждений об отсутствии проблем
