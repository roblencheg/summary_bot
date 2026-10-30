import type { MaxUser } from '~server/integrations/max-client';
import { CATEGORY_LABELS, SEVERITY_LABELS } from '~shared/domain';
import type { ChatService } from './chat-service';
import type { DirectorateService } from './directorate-service';
import type { MaxBotService } from './max-bot-service';
import type { OnDemandService } from './on-demand-service';
import type { RecipientService } from './recipient-service';
import type { SettingsService } from './settings-service';
import type { SubscriptionService } from './subscription-service';

const HELP = [
  'Бот мониторинга чатов поддержки',
  '',
  'Бот присылает саммари по чатам поддержки (утром и вечером) и оперативные алерты о проблемах — только по чатам, которые вам назначил администратор.',
  '',
  '📍 «Что сейчас происходит» — кнопка в закреплённом меню: сводка по вашим чатам на текущий момент',
  '/status — ваши подписки',
  '/help — эта справка',
  '',
  'Доступ выдаёт администратор: он создаёт вашу запись и передаёт код привязки.',
].join('\n');

/**
 * Команды MAX — аналог BotCommandService для Telegram. Отдельный файл: у MAX привязка через
 * deep-link приходит как `bot_started.payload` (отдельное поле события, не текст), а не через
 * `bot_started`-текст команды; код также можно ввести как `/start <код>` текстом (handlePrivate) —
 * оба пути ведут в общий `bind()`. Подключение группы — всё равно через текстовую `/connect <код>`.
 */
export class MaxCommandService {
  constructor(
    private readonly bot: MaxBotService,
    private readonly recipients: RecipientService,
    private readonly subscriptions: SubscriptionService,
    private readonly chats: ChatService,
    private readonly settings: SettingsService,
    private readonly onDemand: OnDemandService,
    private readonly directorates: DirectorateService,
  ) {}

  /**
   * `bot_started` в личном диалоге: payload — код привязки из deep-link (`https://max.ru/<bot>?start=<код>`,
   * см. AICODE-NOTE в recipient-service.ts), либо пусто при обычном нажатии «Старт». Код также можно
   * ввести текстом — см. handlePrivate. Отвечаем в диалог по user_id, не по chat_id события
   * (см. AICODE-NOTE в max-client.ts).
   */
  async handleStarted(user: MaxUser, payload: string | null): Promise<void> {
    if (payload) return this.bind(payload, user);
    const r = await this.recipients.findByChannelId('max', user.user_id);
    if (r && r.maxStatus === 'active') return this.replyUser(user.user_id, `Вы уже подключены.\n\n${await this.status(user.user_id)}`);
    return this.replyUser(user.user_id, 'Чтобы получать отчёты, нужен код привязки от администратора. Сам запуск бота доступа к данным не даёт.\n\n/help — справка');
  }

  /** Текстовые команды в личном диалоге MAX: `/start <код>` — привязка по коду, введённому текстом (аналог Telegram). */
  async handlePrivate(userId: number, user: MaxUser, text: string): Promise<void> {
    const [rawCmd, code] = text.trim().split(/\s+/);
    const cmd = rawCmd?.toLowerCase();
    if (cmd === '/start' && code) return this.bind(code, user);
    if (cmd === '/start' || cmd === '/status') return this.replyUser(userId, await this.status(user.user_id));
    return this.replyUser(userId, HELP);
  }

  private async bind(code: string, user: MaxUser): Promise<void> {
    const res = await this.recipients.bindByCode(code, 'max', { id: user.user_id, username: user.username ?? null });
    if (res.ok) {
      await this.replyUser(user.user_id, `Готово, ${res.recipient.name}! Бот подключён.\n\n${await this.status(user.user_id)}`);
      await this.onDemand.sendMenu(res.recipient.id, null, 'max').catch((err) => console.error('[max-bot] menu after bind:', (err as Error).message));
      return;
    }
    if (res.reason === 'mismatch') return this.replyUser(user.user_id, 'Этот код выдан другому пользователю MAX. Обратитесь к администратору.');
    if (res.reason === 'taken') return this.replyUser(user.user_id, 'Ваш MAX уже привязан к другой записи. Обратитесь к администратору.');
    return this.replyUser(user.user_id, 'Код недействителен или просрочен. Попросите администратора выдать новый.');
  }

  /** Подключение MAX-группы к дирекции по коду. true — сообщение было командой подключения и обработано. */
  async handleGroup(chatId: number, text: string, fromId: number): Promise<boolean> {
    const trimmed = text.trim();
    const [cmd, code] = trimmed.split(/\s+/);
    if ((cmd?.toLowerCase() !== '/start' && cmd?.toLowerCase() !== '/connect') || !code) return false;
    const res = await this.directorates.claimChat(chatId, code, fromId, 'max');
    if (res.ok) await this.replyChat(chatId, `✅ Чат подключён к дирекции «${res.directorate.name}», сбор сообщений начат.`);
    else if (res.reason === 'mine') await this.replyChat(chatId, 'Чат уже подключён к вашей дирекции.');
    else if (res.reason === 'taken') await this.replyChat(chatId, 'Чат уже подключён. Сменить дирекцию может только суперадмин.');
    else await this.replyChat(chatId, 'Код подключения недействителен, просрочен или выдан для другого канала. Получите новую ссылку в разделе «Чаты».');
    return true;
  }

  private async status(maxUserId: number): Promise<string> {
    const r = await this.recipients.findByChannelId('max', maxUserId);
    if (!r || r.maxStatus !== 'active') return 'У вас нет активного доступа. Обратитесь к администратору.';
    const summaryIds = await this.subscriptions.chatIds('summary', r.id);
    const alertIds = await this.subscriptions.chatIds('alert', r.id);
    const chats = await this.chats.getMany([...new Set([...summaryIds, ...alertIds])]);
    const title = (id: number) => chats.find((c) => c.id === id)?.title ?? `чат ${id}`;
    const g = await this.settings.global();
    const periods = [r.summaryNight ? `утром в ${g.dayStart}` : null, r.summaryDay ? `вечером в ${g.nightStart}` : null].filter(Boolean);
    const lines = [`Подписки: ${r.name}`, '', 'Саммари'];
    if (!summaryIds.length || !periods.length) lines.push('— не назначены');
    else {
      lines.push(`Отправка ${periods.join(' и ')} (${g.timezone})`);
      for (const id of summaryIds) lines.push(`• ${title(id)}`);
    }
    lines.push('', 'Алерты');
    if (!alertIds.length) lines.push('— не назначены');
    else {
      for (const id of alertIds) lines.push(`• ${title(id)}`);
      lines.push(`Категории: ${r.alertCategories.map((c) => CATEGORY_LABELS[c]).join(', ')}`);
      lines.push(`Минимальная серьёзность: ${SEVERITY_LABELS[r.alertMinSeverity]}`);
    }
    return lines.join('\n');
  }

  private async replyUser(userId: number, text: string): Promise<void> {
    try {
      await this.bot.requireClient().sendMessage(userId, text);
    } catch (err) {
      console.error('[max-bot] reply failed:', (err as Error).message);
    }
  }

  private async replyChat(chatId: number, text: string): Promise<void> {
    try {
      await this.bot.requireClient().sendToChat(chatId, text);
    } catch (err) {
      console.error('[max-bot] reply failed:', (err as Error).message);
    }
  }
}
