import type { ReportRepository } from '~server/repositories/report-repository';
import type { DeliveryRepository } from '~server/repositories/delivery-repository';
import type { Chat } from '~server/models/chat';
import type { ChatPeriodDigest, DigestStatement, Report, ReportPeriod } from '~server/models/report';
import type { Recipient } from '~server/models/recipient';
import type { DirectorateService } from './directorate-service';
import { CATEGORY_LABELS, INCIDENT_STATUS_LABELS, TONE_LABELS, type Category, type Channel, type IncidentStatus, type PeriodType, type Severity, type Tone } from '~shared/domain';
import { LEVEL_ICON, LEVEL_LABEL, REQUEST_STATUS_ICON, SEVERITY_ICON, isActiveIncident, type ChatSituation } from '~server/domain/situation';
import { escapeHtml, link, truncate } from '~server/domain/html';
import { maskIdentifiers } from '~server/domain/masking';
import { formatLocal, formatLocalShort, periodContaining } from '~server/domain/periods';
import { splitMessage } from '~server/domain/splitter';
import {
  CALM,
  DECISIONS_LIMIT,
  LEGEND,
  commonTopics,
  decisionRows,
  longGaps,
  pct,
  picture,
  plan,
  renderRichWithinLimits,
  situationWhy,
  statement,
  totals,
  type Item,
  type RenderView,
} from './summary-render';
import type { AuditService } from './audit-service';
import type { ChatService } from './chat-service';
import type { DigestService } from './digest-service';
import type { RecipientService } from './recipient-service';
import type { RuntimeState } from './runtime-state';
import type { SettingsService } from './settings-service';
import type { SubscriptionService } from './subscription-service';
import { GAP_REASON_LABELS } from './gap-service';
import { NotFoundError, ValidationError } from './errors';
import { TECH } from './settings-defaults';

/**
 * Персональные саммари. Отчёт собирается в момент отправки из дайджестов чатов,
 * разрешённых получателю СЕЙЧАС — отозванный доступ не попадёт в уже запланированный отчёт.
 */
export class ReportService {
  constructor(
    private readonly repo: ReportRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly digests: DigestService,
    private readonly subscriptions: SubscriptionService,
    private readonly recipients: RecipientService,
    private readonly chats: ChatService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly runtime: RuntimeState,
    private readonly directorates: DirectorateService,
  ) {}

  /** Каналы, в которых у получателя есть хотя бы один подключённый чат саммари. */
  private async channelsFor(recipientId: number): Promise<Channel[]> {
    const chatIds = await this.subscriptions.chatIds('summary', recipientId);
    if (!chatIds.length) return [];
    const chats = await this.chats.getMany(chatIds);
    return [...new Set(chats.map((c) => c.channel))];
  }

  /**
   * Отчёты периода для всех подписанных получателей; deliver=false — догоняющий лимит превышен.
   * Строка reports — одна на (получатель, период), доставка — отдельным заданием на каждый канал,
   * где у получателя есть чаты (см. design.md: MAX-артефакт лежит параллельным набором колонок
   * той же строки, а не второй строкой — UNIQUE-констрейнт не ослабить без пересборки таблицы).
   */
  async createForPeriod(period: ReportPeriod, deliver: boolean): Promise<void> {
    for (const { recipient } of await this.subscriptions.summaryRecipients(period.periodType)) {
      const { id, created } = await this.repo.ensureReport({
        recipientId: recipient.id,
        periodId: period.id,
        periodType: period.periodType,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        version: 1,
        manual: false,
        status: 'pending',
      });
      if (!created) continue;
      const channels = await this.channelsFor(recipient.id);
      if (!channels.length) continue;
      if (deliver) {
        for (const channel of channels) {
          await this.deliveries.enqueue({ dedupKey: `summary:${id}:${channel}`, recipientId: recipient.id, channel, kind: 'summary', reportId: id, triggerAt: period.endsAt });
        }
      } else {
        const report = (await this.repo.getReport(id))!;
        for (const channel of channels) {
          const built = await this.assemble(report, recipient, channel);
          if (channel === 'telegram') await this.repo.saveBuilt(id, built.chatIds, built.parts, built.fullText, built.rich, built.delayed, 'skipped_catchup');
          else await this.repo.saveBuiltMax(id, built.chatIds, built.parts, built.fullText, 'skipped_catchup');
        }
      }
    }
    this.runtime.wake('delivery');
  }

  /** Сборка отчёта для получателя по его ТЕКУЩИМ подпискам этого канала. */
  /** parts/fullText — текстовый формат (запасной и для веб-интерфейса), rich — rich message Telegram (всегда null для MAX). */
  async assemble(report: Report, recipient: Recipient, channel: Channel): Promise<{ chatIds: number[]; parts: string[]; fullText: string; rich: string | null; delayed: boolean }> {
    const period = await this.repo.getPeriod(report.periodId);
    if (!period) throw new NotFoundError('Период отчёта не найден');
    const chatIds = await this.subscriptions.chatIds('summary', recipient.id);
    const chats = (await this.chats.getMany(chatIds)).filter((c) => c.channel === channel).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    const digests: Array<{ chat: Chat; digest: ChatPeriodDigest }> = [];
    for (const chat of chats) digests.push({ chat, digest: await this.digests.ensure(chat.id, period) });
    const g = await this.settings.global();
    const delayed = Date.now() - new Date(report.endsAt).getTime() > g.delayedThresholdMin * 60_000;
    const view: RenderView = {
      icon: report.periodType === 'night' ? '🌙' : '☀️',
      name: `${report.periodType === 'night' ? 'Ночное' : 'Дневное'} саммари`,
      tail: report.manual ? ' (сформировано вручную)' : '',
      startsAt: report.startsAt,
      endsAt: report.endsAt,
      notes: delayed ? ['⏱ <i>Отправлено с задержкой</i>'] : [],
      meta: true,
      prefs: await this.directorates.summaryPrefs(recipient.id),
    };
    const masked = this.render(view, digests, g.timezone, true);
    const full = this.render(view, digests, g.timezone, false);
    const rich = channel === 'telegram' ? renderRichWithinLimits(view, digests, g.timezone, true) : null;
    return { chatIds: chats.map((c) => c.id), parts: splitMessage(masked), fullText: full, rich, delayed };
  }

  /**
   * Промежуточная сводка «Что сейчас происходит» за [from, to) по указанным чатам.
   * Дайджесты строятся без записи периода (DigestService.buildAdHoc).
   */
  async assembleOnDemand(recipientId: number, chatIds: number[], from: string, to: string): Promise<{ chatIds: number[]; parts: string[]; rich: string | null }> {
    const chats = (await this.chats.getMany(chatIds)).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    const digests: Array<{ chat: Chat; digest: ChatPeriodDigest }> = [];
    for (const chat of chats) digests.push({ chat, digest: await this.digests.buildAdHoc(chat.id, from, to) });
    const g = await this.settings.global();
    const view: RenderView = {
      icon: '📍',
      name: 'Что сейчас происходит',
      tail: ` · на ${formatLocal(to, g.timezone, false)}`,
      startsAt: from,
      endsAt: to,
      notes: [],
      meta: false,
      prefs: await this.directorates.summaryPrefs(recipientId),
    };
    return {
      chatIds: chats.map((c) => c.id),
      parts: splitMessage(this.render(view, digests, g.timezone, true)),
      rich: renderRichWithinLimits(view, digests, g.timezone, true),
    };
  }

  /** Текстовый формат (Telegram HTML, части по 4096): запасной вариант и полный текст для веб-интерфейса. */
  private render(view: RenderView, items: Item[], tz: string, mask: boolean): string {
    const out: string[] = [];
    const p = plan(view, items);
    const head = [
      `${view.icon} <b>${escapeHtml(view.name)}</b>${escapeHtml(view.tail)}`,
      ...(view.meta
        ? [
            `Период: ${formatLocal(view.startsAt, tz)} – ${formatLocal(view.endsAt, tz)}`,
            ...(p.incomplete.length ? [`Полнота данных: ⚠️ неполные (${p.incomplete.map(escapeHtml).join(', ')})`] : []),
          ]
        : []),
      ...view.notes,
    ];
    out.push(head.join('\n'));
    if (!items.length) {
      out.push('Нет назначенных чатов.');
      return out.join('\n\n');
    }

    const t = totals(p.all);
    const lights = [`🚦 <b>Обстановка: ${LEVEL_ICON[t.overall]} ${LEVEL_LABEL[t.overall]}</b>`, t.line];
    for (const { chat, sit } of p.shown) {
      const title = sit.level === 'red' ? `<b>${escapeHtml(chat.title)}</b>` : escapeHtml(chat.title);
      lights.push(`${LEVEL_ICON[sit.level]} ${p.star(chat.id)}${title} — ${escapeHtml(situationWhy(sit))}`);
    }
    if (p.quiet.length) lights.push(`⚪ Без событий: ${p.quiet.map(escapeHtml).join(', ')}`);
    if (!p.shown.length && !p.quiet.length) lights.push('За период событий не было.');
    out.push(lights.join('\n'));

    const rows = decisionRows(items, mask);
    if (!rows.length) out.push('🔥 <b>Требует решения</b>\nВопросов, требующих решения, нет.');
    else {
      const lines = ['🔥 <b>Требует решения</b>'];
      for (const r of rows.slice(0, DECISIONS_LIMIT)) {
        lines.push(
          [`${r.icon} <b>${escapeHtml(r.who)}</b> · ${escapeHtml(r.where)} — ${escapeHtml(r.what)}`, r.status, r.link ? link(r.link, r.ref) : escapeHtml(r.ref)]
            .filter(Boolean)
            .join(' · '),
        );
      }
      if (rows.length > DECISIONS_LIMIT) lines.push(`<i>…и ещё ${rows.length - DECISIONS_LIMIT} — в разделах чатов ниже и в веб-интерфейсе</i>`);
      out.push(lines.join('\n'));
    }

    const { overview, calm } = picture(p.all);
    const attention = items.flatMap((i) => i.digest.content.attention.slice(0, 3).map((s) => ({ s, i })));
    const pic = ['📋 <b>Краткая картина</b>'];
    for (const { s, i } of overview) pic.push(`• [${escapeHtml(i.chat.title)}] ${statement(s, i.digest, mask)}`);
    if (calm.length) pic.push(`🟢 ${CALM}: ${calm.map(escapeHtml).join(', ')}`);
    if (!overview.length && !calm.length) {
      if (items.some((i) => !i.digest.content.aiAvailable)) pic.push('• Текстовая картина недоступна: AI-анализ не выполнен. Обстановка выше — по данным БД.');
      else pic.push('• Существенных событий нет.');
    }
    if (attention.length) {
      pic.push('<b>Отмечено анализом</b>');
      for (const { s, i } of attention) pic.push(`• [${escapeHtml(i.chat.title)}] ${statement(s, i.digest, mask)}`);
    }
    out.push(pic.join('\n'));

    const m = (x: string) => (mask ? maskIdentifiers(x) : x);
    for (const { chat, digest, sit } of p.shown) out.push(this.chatSection(chat, digest, sit, view.endsAt, tz, m, mask, p.star(chat.id)));

    const common = commonTopics(items);
    if (common.length) {
      out.push(
        ['<b>Общие темы между вашими чатами</b>', ...common.map(([topic, v]) => `• ${escapeHtml(topic)}: ${v.map((x) => `${escapeHtml(x.title)} (${x.n})`).join(', ')}`)].join(
          '\n',
        ),
      );
    }
    out.push(`<i>${LEGEND}</i>`);
    return out.join('\n\n');
  }

  private chatSection(chat: Chat, d: ChatPeriodDigest, sit: ChatSituation, endsAt: string, tz: string, m: (x: string) => string, mask: boolean, star = ''): string {
    const st = d.stats;
    const c = d.content;
    const lines = [`━━ ${LEVEL_ICON[sit.level]} ${star}<b>${escapeHtml(chat.title)}</b>`];
    if (sit.level === 'green') lines.push(`<i>${CALM}</i>`);
    else if (c.headline) lines.push(`<i>${statement(c.headline, d, mask)}</i>`);
    const gaps = longGaps(d, endsAt);
    for (const g of gaps) {
      lines.push(
        `⚠️ Данные неполные: ${formatLocalShort(g.startedAt, tz)} – ${g.endedAt ? formatLocalShort(g.endedAt, tz) : 'по сей момент'} (${escapeHtml(GAP_REASON_LABELS[g.reason] ?? g.reason)})`,
      );
    }
    if (st.messages === 0) {
      lines.push(gaps.length ? 'Сообщений не получено.' : 'Сообщений не было.');
      return lines.join('\n');
    }
    // технические счётчики (сообщения, авторы, вложения, сигналы риска) — только в веб-интерфейсе
    const classified = st.topics.reduce((a, t) => a + t.count, 0);
    if (st.topics.length) lines.push(`Темы: ${st.topics.slice(0, 6).map((t) => `${escapeHtml(t.topic)} — ${t.count} (${pct(t.count, classified)})`).join(', ')}`);
    if (st.tones.length) {
      const tones = st.tones.map((t) => `${TONE_LABELS[t.tone as Tone] ?? t.tone} ${t.count}`).join(', ');
      const reasons = c.toneReasons.map((s) => statement(s, d, mask)).join(' ');
      lines.push(`Тон: ${escapeHtml(tones)}${reasons ? `. ${reasons}` : ''}`);
    }

    if (c.incidents.length) {
      lines.push('<b>Инциденты и затянувшиеся проблемы:</b>');
      for (const i of c.incidents) {
        const who = i.authorName ? `${escapeHtml(i.authorName)}${i.affectedAuthors > 1 ? ` и ещё ${i.affectedAuthors - 1}` : ''} — ` : '';
        lines.push(
          `${SEVERITY_ICON[i.severity as Severity] ?? '•'} #${i.id} ${who}${escapeHtml(m(truncate(i.title, 140)))} · ${i.categories
            .map((x) => CATEGORY_LABELS[x as Category] ?? x)
            .join(', ')} · сообщений ${i.messageCount}${isActiveIncident(i) ? '' : ` · ${escapeHtml((INCIDENT_STATUS_LABELS[i.status as IncidentStatus] ?? i.status).toLowerCase())}`}`,
        );
      }
    }
    for (const s of c.spikes) {
      lines.push(
        `📈 Всплеск ${formatLocalShort(s.at, tz)}: ${s.count} сообщ., ${s.authors} участников${
          s.historyLimited ? ' (база сравнения ограничена)' : `, обычно ≈ ${s.baseline}`
        }${s.topics.length ? `, темы: ${escapeHtml(s.topics.join(', '))}` : ''}`,
      );
    }

    if (c.requests.length) {
      const shown = c.requests.slice(0, TECH.summaryPreviewRequests);
      lines.push(
        shown.length < c.requests.length
          ? `<b>Кто с чем обращался</b> (выборка: ${shown.length} из ${c.requests.length}, полный список — в веб-интерфейсе):`
          : '<b>Кто с чем обращался:</b>',
      );
      shown.forEach((r, i) => {
        const who = `<b>${escapeHtml(r.authorName)}</b>` + (r.identityLimited ? ' (идентификация ограничена)' : '');
        const src = r.link ? link(r.link, 'ссылка') : `сообщение #${r.firstMessageId}`;
        lines.push(
          `${i + 1}. ${REQUEST_STATUS_ICON[r.status]} ${who} — ${escapeHtml(m(truncate(r.summary || 'суть не определена', 180)))}${
            r.repeats ? ` · повторов: ${r.repeats}` : ''
          } · ${src}`,
        );
      });
    }
    if (c.staffConfigured) {
      const answered = c.requests.filter((r) => r.status === 'answered').length;
      const noReply = c.requests.filter((r) => r.status === 'no_reply').length;
      lines.push(`Ответы поддержки: 💬 есть ответ — ${answered}, ⏳ возможно без ответа — ${noReply}`);
    } else {
      lines.push('Ответы поддержки не определяются: не задан список сотрудников');
    }
    return lines.join('\n');
  }

  // --- ручной запуск и просмотр ---

  async manualRun(recipientId: number, periodType: PeriodType, anchor: string, actor: string): Promise<Report> {
    const recipient = await this.recipients.getRaw(recipientId);
    if (!recipient) throw new NotFoundError('Получатель не найден');
    const g = await this.settings.global();
    const at = new Date(anchor);
    if (Number.isNaN(at.getTime())) throw new ValidationError('Некорректная дата');
    const p = periodContaining(at, { timezone: g.timezone, dayStart: g.dayStart, nightStart: g.nightStart });
    const per = p.type === periodType ? p : periodContaining(new Date(p.start.getTime() - 1), { timezone: g.timezone, dayStart: g.dayStart, nightStart: g.nightStart });
    if (per.type !== periodType) throw new ValidationError('Не удалось определить период');
    if (per.end.getTime() > Date.now()) throw new ValidationError('Период ещё не закончился');
    const period = await this.repo.ensurePeriod(periodType, per.start.toISOString(), per.end.toISOString());
    const version = (await this.repo.maxVersion(recipientId, periodType, period.startsAt, period.endsAt)) + 1;
    const { id } = await this.repo.ensureReport({
      recipientId,
      periodId: period.id,
      periodType,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      version,
      manual: true,
      status: 'pending',
    });
    const channels = await this.channelsFor(recipientId);
    for (const channel of channels) {
      await this.deliveries.enqueue({ dedupKey: `summary:${id}:${channel}:manual:${Date.now()}`, recipientId, channel, kind: 'summary', reportId: id, manualRetry: true, triggerAt: null });
    }
    await this.audit.record(actor, 'report.manual', 'report', String(id), null, { recipientId, periodType, startsAt: period.startsAt, version, channels });
    this.runtime.wake('delivery');
    return (await this.repo.getReport(id))!;
  }

  /** Пересобрать дайджесты периода (новая версия) — после восстановления AI или правки правил. */
  async rebuildDigests(periodId: number, actor: string): Promise<void> {
    const period = await this.repo.getPeriod(periodId);
    if (!period) throw new NotFoundError('Период не найден');
    for (const chatId of await this.repo.digestChatIds(periodId)) await this.digests.rebuild(chatId, period);
    await this.audit.record(actor, 'report.digests.rebuild', 'period', String(periodId), null, null);
  }

  list(f: { recipientId?: number; recipientIds?: number[]; periodId?: number; limit: number; offset: number }) {
    return this.repo.listReports(f);
  }

  async details(id: number): Promise<{ report: Report; digests: Array<{ chat: Chat; digest: ChatPeriodDigest }> }> {
    const report = await this.repo.getReport(id);
    if (!report) throw new NotFoundError('Отчёт не найден');
    const period = await this.repo.getPeriod(report.periodId);
    const chats = await this.chats.getMany([...new Set([...report.chatIds, ...report.maxChatIds])]);
    const digests: Array<{ chat: Chat; digest: ChatPeriodDigest }> = [];
    if (period) {
      for (const chat of chats) {
        const d = await this.repo.latestDigest(chat.id, period.id);
        if (d) digests.push({ chat, digest: d });
      }
    }
    return { report, digests };
  }

  getReport(id: number): Promise<Report | null> {
    return this.repo.getReport(id);
  }

  saveBuilt(id: number, chatIds: number[], parts: string[], fullText: string, richHtml: string | null, delayed: boolean, status: Report['status']) {
    return this.repo.saveBuilt(id, chatIds, parts, fullText, richHtml, delayed, status);
  }

  saveBuiltMax(id: number, chatIds: number[], parts: string[], fullText: string, status: Report['status']) {
    return this.repo.saveBuiltMax(id, chatIds, parts, fullText, status);
  }

  /** Rich message отклонён Telegram — в интерфейсе показываем ушедший текстовый формат. */
  clearRich(id: number) {
    return this.repo.clearRich(id);
  }

  setStatus(id: number, channel: Channel, status: Report['status']) {
    return channel === 'telegram' ? this.repo.setReportStatus(id, status) : this.repo.setReportStatusMax(id, status);
  }

  listPeriods(limit: number, offset: number) {
    return this.repo.listPeriods(limit, offset);
  }
}
