import { CATEGORIES, CATEGORY_LABELS, SEVERITIES, SEVERITY_LABELS, type Category, type Severity } from '~shared/domain';
import { escapeHtml } from '~server/domain/html';
import { SEVERITY_ICON } from '~server/domain/situation';
import type { BotKeyboard } from '~server/domain/keyboard';
import type { Recipient } from '~server/models/recipient';
import type { BotCallback, FeedbackHandler } from './bot-callback';
import type { ChannelBots } from './channel-bots';
import type { RecipientService } from './recipient-service';

export const SETTINGS_OPEN = 'set:open';

/**
 * «⚙️ Настройки инцидентов» — получатель сам выбирает категории алертов и минимальную серьёзность,
 * одинаково из Telegram и из MAX. Интерактивный ответ на нажатие (не очередь доставки): set:open —
 * новое сообщение, set:c:<категория> / set:s:<серьёзность> — изменение и перерисовка того же сообщения.
 * Изменения идут через RecipientService.update — та же валидация и аудит, что в веб-интерфейсе.
 */
export class IncidentSettingsService implements FeedbackHandler {
  constructor(
    private readonly recipients: RecipientService,
    private readonly bots: ChannelBots,
  ) {}

  async handleCallback(cb: BotCallback): Promise<void> {
    const reply = this.bots.replyFor(cb.channel);
    const answer = async (text: string, alert = false) => {
      try {
        await reply.answerCallback(cb.id, text, alert);
      } catch (err) {
        console.error('[incident-settings] answerCallback failed:', (err as Error).message);
      }
    };

    let r = await this.recipients.findByChannelId(cb.channel, cb.fromId);
    const active = r && (cb.channel === 'telegram' ? r.status === 'active' : r.maxStatus === 'active');
    if (!r || !active) return answer('Нет доступа. Обратитесь к администратору.', true);

    const [, action, value] = cb.data.split(':');
    let note = '';
    if (action === 'c' && (CATEGORIES as readonly string[]).includes(value)) {
      const cat = value as Category;
      const on = r.alertCategories.includes(cat);
      if (on && r.alertCategories.length === 1) return answer('Нужна хотя бы одна категория', true);
      const next = on ? r.alertCategories.filter((c) => c !== cat) : CATEGORIES.filter((c) => c === cat || r!.alertCategories.includes(c));
      r = await this.save(r, cb.channel, { alertCategories: next });
      note = `${CATEGORY_LABELS[cat]}: ${on ? 'выключено' : 'включено'}`;
    } else if (action === 's' && (SEVERITIES as readonly string[]).includes(value)) {
      r = await this.save(r, cb.channel, { alertMinSeverity: value as Severity });
      note = `Минимальная серьёзность: ${SEVERITY_LABELS[value as Severity]}`;
    } else if (action !== 'open') {
      return answer('Неизвестное действие');
    }

    const screen = settingsScreen(r);
    try {
      if (action === 'open' || !cb.messageId) await reply.sendMessage(cb.chatId, screen.text, { keyboard: screen.keyboard });
      else await reply.editMessageText(cb.chatId, cb.messageId, screen.text, { keyboard: screen.keyboard });
    } catch (err) {
      console.error('[incident-settings] render failed:', (err as Error).message);
      return answer(note ? `${note}. Не удалось обновить экран — откройте настройки ещё раз.` : 'Не удалось открыть настройки, попробуйте ещё раз.', true);
    }
    return answer(note || 'Настройки инцидентов');
  }

  private async save(r: Recipient, channel: BotCallback['channel'], patch: { alertCategories?: Category[]; alertMinSeverity?: Severity }): Promise<Recipient> {
    await this.recipients.update(r.id, patch, `${channel}:${r.id}`);
    return (await this.recipients.getRaw(r.id)) ?? r;
  }
}

function settingsScreen(r: Recipient): { text: string; keyboard: BotKeyboard } {
  const cats = CATEGORIES.map((c) => ({ text: `${r.alertCategories.includes(c) ? '✅' : '⬜'} ${CATEGORY_LABELS[c]}`, data: `set:c:${c}` }));
  const rows: BotKeyboard = [];
  for (let i = 0; i < cats.length; i += 2) rows.push(cats.slice(i, i + 2));
  const sev = SEVERITIES.map((s) => ({ text: `${s === r.alertMinSeverity ? '● ' : ''}${SEVERITY_ICON[s]} ${SEVERITY_LABELS[s]}`, data: `set:s:${s}` }));
  rows.push(sev.slice(0, 2), sev.slice(2));
  const text = [
    '⚙️ <b>Настройки инцидентов</b>',
    '',
    `Категории: ${escapeHtml(r.alertCategories.map((c) => CATEGORY_LABELS[c]).join(', '))}`,
    `Минимальная серьёзность: <b>${escapeHtml(SEVERITY_LABELS[r.alertMinSeverity])}</b> и выше`,
    '',
    '<i>Нажмите категорию, чтобы включить или выключить её, и уровень — чтобы выбрать минимальную серьёзность. Сохраняется сразу.</i>',
  ].join('\n');
  return { text, keyboard: rows };
}
