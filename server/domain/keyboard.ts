/**
 * Нейтральное представление инлайн-кнопок бота: конкретный провод (inline_keyboard у Telegram,
 * attachments[type=inline_keyboard] у MAX) собирают клиенты в integrations/*-client.ts.
 */
export interface BotButton {
  text: string;
  data: string;
}

export type BotKeyboard = BotButton[][];
