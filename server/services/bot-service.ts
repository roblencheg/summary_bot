import { TelegramClient, deriveWebhookSecret, type TgBotInfo } from '~server/integrations/telegram-client';
import type { BotKeyboard } from '~server/domain/keyboard';
import type { ChannelReply } from './bot-callback';
import type { RuntimeState } from './runtime-state';

/** Доступ к боту: клиент (если задан токен), режим приёма, кэш getMe. Реализует ChannelReply для Telegram. */
export class BotService implements ChannelReply {
  readonly client: TelegramClient | null;
  readonly webhookSecret: string | null;
  private me: { info: TgBotInfo; at: number } | null = null;

  constructor(
    token: string | undefined,
    explicitSecret: string | undefined,
    readonly mode: 'webhook' | 'polling' | 'off',
    private readonly state: RuntimeState,
  ) {
    this.client = token ? new TelegramClient(token) : null;
    this.webhookSecret = token ? deriveWebhookSecret(token, explicitSecret) : null;
    state.intake.mode = token ? mode : 'off';
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /** Отправка ответов и уведомлений разрешена везде, где задан токен. */
  requireClient(): TelegramClient {
    if (!this.client) throw new Error('TELEGRAM_BOT_TOKEN не задан');
    return this.client;
  }

  async getMe(force = false): Promise<TgBotInfo | null> {
    if (!this.client) return null;
    if (!force && this.me && Date.now() - this.me.at < 5 * 60_000) return this.me.info;
    try {
      const info = await this.client.getMe();
      this.me = { info, at: Date.now() };
      this.state.bot = {
        lastGetMeOkAt: new Date().toISOString(),
        username: info.username ?? null,
        readsAll: info.can_read_all_group_messages ?? null,
        error: null,
      };
      return info;
    } catch (err) {
      this.state.bot.error = (err as Error).message;
      return this.me?.info ?? null;
    }
  }

  async username(): Promise<string | null> {
    return (await this.getMe())?.username ?? null;
  }

  async sendMessage(chatId: number, text: string, opts: { keyboard?: BotKeyboard } = {}): Promise<void> {
    await this.requireClient().sendMessage(chatId, text, opts);
  }

  editMessageText(chatId: number, messageId: number, text: string, opts: { keyboard?: BotKeyboard } = {}): Promise<void> {
    return this.requireClient().editMessageText(chatId, messageId, text, opts);
  }

  answerCallback(id: string, text: string, showAlert = false): Promise<void> {
    return this.requireClient().answerCallbackQuery(id, text, showAlert) as unknown as Promise<void>;
  }
}
