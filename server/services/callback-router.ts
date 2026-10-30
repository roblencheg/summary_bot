import type { BotCallback, FeedbackHandler } from './bot-callback';

/**
 * Нажатия инлайн-кнопок в любом канале: `menu:*` — меню бота, `set:*` — настройки инцидентов,
 * остальное (`fb:*`) — оценки алертов. Маршрутизация по префиксу data не зависит от канала —
 * канал несёт сам BotCallback, дальше его читают только конкретные хендлеры.
 */
export class CallbackRouter implements FeedbackHandler {
  constructor(
    private readonly menu: FeedbackHandler,
    private readonly settings: FeedbackHandler,
    private readonly feedback: FeedbackHandler,
  ) {}

  handleCallback(cb: BotCallback): Promise<void> {
    const data = cb.data;
    if (data.startsWith('menu:')) return this.menu.handleCallback(cb);
    if (data.startsWith('set:')) return this.settings.handleCallback(cb);
    return this.feedback.handleCallback(cb);
  }
}
