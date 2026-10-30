import { MaxClient, type MaxBotInfo } from '~server/integrations/max-client';
import type { BotKeyboard } from '~server/domain/keyboard';
import type { ChannelReply } from './bot-callback';
import type { RuntimeState } from './runtime-state';

/** Доступ к боту MAX: клиент (если задан токен), режим приёма, кэш getMe. Аналог BotService для Telegram. */
export class MaxBotService implements ChannelReply {
  readonly client: MaxClient | null;
  private me: { info: MaxBotInfo; at: number } | null = null;

  constructor(
    token: string | undefined,
    readonly mode: 'webhook' | 'polling' | 'off',
    private readonly state: RuntimeState,
  ) {
    this.client = token ? new MaxClient(token) : null;
    state.maxIntake.mode = token ? mode : 'off';
  }

  get configured(): boolean {
    return this.client !== null;
  }

  requireClient(): MaxClient {
    if (!this.client) throw new Error('MAX_BOT_TOKEN не задан');
    return this.client;
  }

  async getMe(force = false): Promise<MaxBotInfo | null> {
    if (!this.client) return null;
    if (!force && this.me && Date.now() - this.me.at < 5 * 60_000) return this.me.info;
    try {
      const info = await this.client.getMe();
      this.me = { info, at: Date.now() };
      this.state.maxBot = { lastGetMeOkAt: new Date().toISOString(), username: info.username ?? null, error: null };
      return info;
    } catch (err) {
      this.state.maxBot.error = (err as Error).message;
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
    return this.requireClient().editMessage(messageId, text, opts);
  }

  answerCallback(id: string, text: string): Promise<void> {
    return this.requireClient().answerCallback(id, text);
  }
}
