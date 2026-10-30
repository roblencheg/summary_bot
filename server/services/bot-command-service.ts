import type { TgMessage } from '~server/integrations/telegram-client';
import { CATEGORY_LABELS, SEVERITY_LABELS } from '~shared/domain';
import { escapeHtml } from '~server/domain/html';
import type { BotService } from './bot-service';
import type { ChatService } from './chat-service';
import type { RecipientService } from './recipient-service';
import type { SettingsService } from './settings-service';
import type { SubscriptionService } from './subscription-service';
import type { OnDemandService } from './on-demand-service';
import type { DirectorateService } from './directorate-service';

const HELP = [
  '<b>Бот мониторинга чатов поддержки</b>',
  '',
  'Бот присылает саммари по чатам поддержки (утром и вечером) и оперативные алерты о проблемах — только по чатам, которые вам назначил администратор.',
  '',
  '📍 «Что сейчас происходит» — кнопка в закреплённом меню: сводка по вашим чатам на текущий момент',
  '/status — ваши подписки',
  '/help — эта справка',
  '',
  'Доступ выдаёт администратор: он создаёт вашу запись и передаёт ссылку с одноразовым кодом.',
].join('\n');

/**
 * Команды в ЛИЧНОМ диалоге с ботом. В группах бот отвечает только на подключение по коду
 * (`/start <код>` из ссылки `?startgroup=` и `/connect <код>`), остальные команды там игнорирует.
 * Сам по себе /start не даёт доступа к данным — нужен действующий код привязки.
 */
export class BotCommandService {
  constructor(
    private readonly bot: BotService,
    private readonly recipients: RecipientService,
    private readonly subscriptions: SubscriptionService,
    private readonly chats: ChatService,
    private readonly settings: SettingsService,
    private readonly onDemand: OnDemandService,
    private readonly directorates: DirectorateService,
  ) {}

  /** Подключение группы к дирекции по коду. true — сообщение было командой подключения и обработано. */
  async handleGroup(msg: TgMessage): Promise<boolean> {
    const from = msg.from;
    const text = (msg.text ?? '').trim();
    if (!from || from.is_bot || !text.startsWith('/')) return false;
    const [rawCmd, code] = text.split(/\s+/);
    const [cmd, mention] = rawCmd.toLowerCase().split('@');
    if ((cmd !== '/start' && cmd !== '/connect') || !code) return false;
    const me = (await this.bot.username())?.toLowerCase();
    if (mention && me && mention !== me) return false; // команда другому боту
    const res = await this.directorates.claimChat(msg.chat.id, code, from.id, 'telegram');
    if (res.ok) {
      await this.reply(msg.chat.id, `✅ Чат подключён к дирекции «${escapeHtml(res.directorate.name)}», сбор сообщений начат.`);
    } else if (res.reason === 'mine') {
      await this.reply(msg.chat.id, 'Чат уже подключён к вашей дирекции.');
    } else if (res.reason === 'taken') {
      await this.reply(msg.chat.id, 'Чат уже подключён. Сменить дирекцию может только суперадмин.');
    } else {
      await this.reply(msg.chat.id, 'Код подключения недействителен или просрочен. Получите новую ссылку в разделе «Чаты».');
    }
    return true;
  }

  async handlePrivate(msg: TgMessage): Promise<void> {
    const from = msg.from;
    const text = (msg.text ?? '').trim();
    if (!from || from.is_bot || !text.startsWith('/')) return;
    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd.split('@')[0].toLowerCase();

    if (cmd === '/start') {
      const code = args[0];
      if (code) {
        const res = await this.start(code, from.id, from.username ?? null);
        await this.reply(msg.chat.id, res.text);
        // вслед за подтверждением привязки — закрепляемое меню с кнопкой «Что сейчас происходит»
        if (res.recipientId) {
          await this.onDemand.sendMenu(res.recipientId, null, 'telegram').catch((err) => console.error('[bot] menu after bind:', (err as Error).message));
        }
        return;
      }
      const r = await this.recipients.findByTelegramId(from.id);
      if (r && r.status === 'active') return this.reply(msg.chat.id, `Вы уже подключены.\n\n${await this.status(from.id)}`);
      return this.reply(
        msg.chat.id,
        'Чтобы получать отчёты, нужна ссылка с одноразовым кодом от администратора. Сам запуск бота доступа к данным не даёт.\n\n/help — справка',
      );
    }
    if (cmd === '/status') return this.reply(msg.chat.id, await this.status(from.id));
    return this.reply(msg.chat.id, HELP);
  }

  private async start(code: string, telegramId: number, username: string | null): Promise<{ text: string; recipientId?: number }> {
    const res = await this.recipients.bindByCode(code, 'telegram', { id: telegramId, username });
    if (res.ok) return { text: `Готово, ${escapeHtml(res.recipient.name)}! Бот подключён.\n\n${await this.status(telegramId)}`, recipientId: res.recipient.id };
    if (res.reason === 'mismatch') return { text: 'Этот код выдан другому пользователю Telegram. Обратитесь к администратору.' };
    if (res.reason === 'taken') return { text: 'Ваш Telegram уже привязан к другой записи. Обратитесь к администратору.' };
    return { text: 'Код недействителен или просрочен. Попросите администратора выдать новую ссылку.' };
  }

  private async status(telegramId: number): Promise<string> {
    const r = await this.recipients.findByTelegramId(telegramId);
    if (!r || r.status !== 'active') return 'У вас нет активного доступа. Обратитесь к администратору.';
    const summaryIds = await this.subscriptions.chatIds('summary', r.id);
    const alertIds = await this.subscriptions.chatIds('alert', r.id);
    const chats = await this.chats.getMany([...new Set([...summaryIds, ...alertIds])]);
    const title = (id: number) => escapeHtml(chats.find((c) => c.id === id)?.title ?? `чат ${id}`);
    const g = await this.settings.global();
    const periods = [r.summaryNight ? `утром в ${g.dayStart}` : null, r.summaryDay ? `вечером в ${g.nightStart}` : null].filter(Boolean);
    const lines = [`<b>Подписки: ${escapeHtml(r.name)}</b>`, ''];
    lines.push('<b>Саммари</b>');
    if (!summaryIds.length || !periods.length) lines.push('— не назначены');
    else {
      lines.push(`Отправка ${periods.join(' и ')} (${escapeHtml(g.timezone)})`);
      for (const id of summaryIds) lines.push(`• ${title(id)}`);
    }
    lines.push('', '<b>Алерты</b>');
    if (!alertIds.length) lines.push('— не назначены');
    else {
      for (const id of alertIds) lines.push(`• ${title(id)}`);
      lines.push(`Категории: ${r.alertCategories.map((c) => CATEGORY_LABELS[c]).join(', ')}`);
      lines.push(`Минимальная серьёзность: ${SEVERITY_LABELS[r.alertMinSeverity]}`);
    }
    return lines.join('\n');
  }

  private async reply(chatId: number, text: string): Promise<void> {
    try {
      await this.bot.requireClient().sendMessage(chatId, text);
    } catch (err) {
      console.error('[bot] reply failed:', (err as Error).message);
    }
  }
}
