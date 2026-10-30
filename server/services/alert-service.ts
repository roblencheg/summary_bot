import type { DeliveryRepository } from '~server/repositories/delivery-repository';
import type { IncidentRepository } from '~server/repositories/incident-repository';
import type { Incident } from '~server/models/incident';
import type { Chat } from '~server/models/chat';
import type { DeliveryJob } from '~server/models/delivery';
import type { BotKeyboard } from '~server/domain/keyboard';
import { REPEAT_TYPE_LABELS, SEVERITY_LABELS } from '~shared/domain';
import { escapeHtml, link, truncate } from '~server/domain/html';
import { maskIdentifiers } from '~server/domain/masking';
import { formatLocal, formatLocalShort } from '~server/domain/periods';
import { SEVERITY_ICON, plural, primaryCategoryLabel } from '~server/domain/situation';
import type { ChatService } from './chat-service';
import type { RuntimeState } from './runtime-state';
import type { SubscriptionService } from './subscription-service';


export interface AlertTrigger {
  sentAt: string | null;
  receivedAt: string | null;
  analyzedAt: string | null;
}

/** Постановка алертов в доставку и рендер текста (в момент отправки — из актуального состояния). */
export class AlertService {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly incidents: IncidentRepository,
    private readonly subscriptions: SubscriptionService,
    private readonly runtime: RuntimeState,
    private readonly chats: ChatService,
  ) {}

  /** Возвращает число поставленных заданий. */
  async enqueue(incident: Incident, kind: 'alert' | 'incident_update', reason: string, trigger: AlertTrigger): Promise<number> {
    const recipients = await this.subscriptions.alertRecipients(incident);
    const chat = await this.chats.get(incident.chatId);
    const channel = chat?.channel ?? 'telegram';
    let n = 0;
    for (const r of recipients) {
      // получатель ещё не видел этот инцидент (подписался позже / фильтр) — шлём как первый алерт
      const asKind = kind === 'incident_update' && !(await this.deliveries.hasAlertForIncident(incident.id, r.id)) ? 'alert' : kind;
      const dedupKey =
        asKind === 'alert' ? `alert:${incident.id}:${r.id}` : `update:${incident.id}:${r.id}:${incident.messageCount}:${incident.severity}:${Date.now()}`;
      const created = await this.deliveries.enqueue({
        dedupKey,
        recipientId: r.id,
        channel,
        kind: asKind,
        incidentId: incident.id,
        chatId: incident.chatId,
        payload: { updateReason: reason },
        triggerAt: trigger.receivedAt,
        sourceSentAt: trigger.sentAt,
        sourceReceivedAt: trigger.receivedAt,
        analyzedAt: trigger.analyzedAt,
      });
      if (created) n++;
    }
    if (n) this.runtime.wake('delivery');
    return n;
  }

  async render(incident: Incident, chat: Chat | null, job: DeliveryJob, tz: string): Promise<{ text: string; keyboard: BotKeyboard }> {
    const chatTitle = escapeHtml(chat?.title ?? `чат ${incident.chatId}`);
    const lines: string[] = [];
    const isUpdate = job.kind === 'incident_update';

    if (job.uncertain) lines.push('♻️ <i>Повторная отправка: возможен дубль предыдущего сообщения</i>');
    if (isUpdate) lines.push(`🔁 <b>Инцидент #${incident.id}</b>${job.payload?.updateReason ? ` — ${escapeHtml(job.payload.updateReason)}` : ''}`);

    // Формат для руководителя: «что за уровень» → «кто · где» → «что случилось» → слова клиента → состояние
    if (incident.kind === 'spike' && incident.spikeData) {
      const s = incident.spikeData;
      lines.push(`📈 <b>Всплеск</b> · 💬 <b>${chatTitle}</b>`);
      lines.push(
        `${s.count} сообщений от ${s.authors} участников за ${s.windowMin} мин (${formatLocalShort(s.windowStart, tz)}–${formatLocal(s.windowEnd, tz, false)})`,
      );
      lines.push(
        s.historyLimited
          ? '⚠️ Ограниченная база сравнения: история чата меньше заданного периода'
          : `Обычно ≈ ${s.baselinePerWindow.toFixed(1)} за ${s.windowMin} мин${s.ratio ? `, рост ×${s.ratio.toFixed(1)}` : ''}`,
      );
      if (s.topics.length) lines.push(`Темы: ${escapeHtml(s.topics.map((t) => `${t.topic} (${t.count})`).join(', '))}`);
    } else {
      const category = primaryCategoryLabel(incident.categories);
      lines.push(`${SEVERITY_ICON[incident.severity]} <b>${escapeHtml(SEVERITY_LABELS[incident.severity])}</b>${category ? ` · ${escapeHtml(category)}` : ''}`);
      const others = incident.affectedAuthors > 1 ? ` и ещё ${incident.affectedAuthors - 1}` : '';
      lines.push(`👤 <b>${escapeHtml(incident.authorName ?? 'автор неизвестен')}</b>${others} · 💬 <b>${chatTitle}</b>`);
      if (incident.title) lines.push(`❗ ${escapeHtml(maskIdentifiers(truncate(incident.title, 200)))}`);

      const [first] = await this.incidents.messages(incident.id, 1, 0);
      const [latest] = incident.messageCount > 1 ? await this.incidents.messages(incident.id, 1, incident.messageCount - 1) : [first];
      const quote = (t: string) => escapeHtml(maskIdentifiers(truncate(t, 300)));
      // цитата — самое свежее сообщение; в обновлении дополнительно исходная формулировка проблемы
      if (latest?.text) lines.push(`<blockquote>${quote(latest.text)}</blockquote>`);
      if (isUpdate && first?.text && first.id !== latest?.id) lines.push(`Изначально: «${quote(first.text)}»`);

      const span =
        incident.firstMessageAt === incident.lastMessageAt
          ? formatLocalShort(incident.firstMessageAt, tz)
          : `${formatLocalShort(incident.firstMessageAt, tz)} – ${formatLocalShort(incident.lastMessageAt, tz)}`;
      const staff = (await this.chats.staffConfigured(incident.chatId))
        ? (await this.incidents.facts(incident.id))?.staffReplied
          ? '💬 поддержка отвечала'
          : '⏳ ответа поддержки нет'
        : 'ответы не отслеживаются';
      lines.push(
        `${incident.messageCount} ${plural(incident.messageCount, 'сообщение', 'сообщения', 'сообщений')} · ${escapeHtml(span)}${
          incident.repeatType !== 'single' ? ` · ${escapeHtml(REPEAT_TYPE_LABELS[incident.repeatType])}` : ''
        } · ${staff}`,
      );

      const sources = [first, ...(incident.messageCount > 1 ? await this.incidents.messages(incident.id, 2, Math.max(1, incident.messageCount - 2)) : [])]
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);
      if (sources.length) {
        lines.push(
          `Источник: ${sources
            .map((m) => (m.link ? link(m.link, `сообщение ${m.messageId}`) : `«${chatTitle}», сообщение #${m.messageId}`))
            .join(', ')}`,
        );
      } else if (incident.sourcesDeleted) {
        lines.push('<i>Источник удалён по сроку хранения</i>');
      }
    }
    const delayMs = job.sourceReceivedAt ? Date.now() - new Date(job.sourceReceivedAt).getTime() : 0;
    if (job.kind === 'alert' && delayMs > 2 * 60_000) lines.push(`⏱ <i>Доставлено с задержкой: ${Math.round(delayMs / 60_000)} мин</i>`);
    if (!isUpdate) lines.push(`Инцидент #${incident.id}`);

    const keyboard: BotKeyboard = [
      [
        { text: '👍 Полезный сигнал', data: `fb:${incident.id}:u` },
        { text: '👎 Ложное срабатывание', data: `fb:${incident.id}:f` },
      ],
    ];
    return { text: lines.join('\n'), keyboard };
  }
}
