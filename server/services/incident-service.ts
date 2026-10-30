import type { IncidentRepository, IncidentFilter } from '~server/repositories/incident-repository';
import type { DeliveryRepository } from '~server/repositories/delivery-repository';
import type { Incident, IncidentEvent } from '~server/models/incident';
import type { Message } from '~server/models/message';
import type { ChatRules } from '~server/models/settings';
import type { AnalysisItem } from '~server/integrations/ai-schemas';
import { decide, type Decision } from '~server/domain/incident-policy';
import { truncate } from '~server/domain/html';
import { severityRank, type Category, type IncidentStatus, type Severity } from '~shared/domain';
import type { AlertService, AlertTrigger } from './alert-service';
import type { AuditService } from './audit-service';
import type { BotCallback, FeedbackHandler } from './bot-callback';
import type { ChannelBots } from './channel-bots';
import type { RecipientService } from './recipient-service';
import type { SettingsService } from './settings-service';
import { NotFoundError } from './errors';

export interface AnalyzedMessage {
  message: Message;
  item: AnalysisItem;
  requestKey: string | null;
  analyzedAt: string;
}

/** Идентификаторы вида «007-6294283» → цифры, для проверки «разные заказы». */
function orderIds(entities: string[]): Set<string> {
  return new Set(entities.map((e) => e.replace(/\D/g, '')).filter((d) => d.length >= 5));
}

function entitiesConflict(a: string[], b: string[]): boolean {
  const x = orderIds(a);
  const y = orderIds(b);
  if (!x.size || !y.size) return false;
  for (const v of x) if (y.has(v)) return false;
  return true;
}

const maxSeverity = (a: Severity, b: Severity): Severity => (severityRank(a) >= severityRank(b) ? a : b);

export class IncidentService implements FeedbackHandler {
  constructor(
    private readonly repo: IncidentRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly alerts: AlertService,
    private readonly settings: SettingsService,
    private readonly recipients: RecipientService,
    private readonly bots: ChannelBots,
    private readonly audit: AuditService,
  ) {}

  openForChat(chatId: number, sinceIso: string, limit: number): Promise<Incident[]> {
    return this.repo.openForChat(chatId, sinceIso, limit);
  }

  /** Результаты анализа пакета → инциденты → решение об уведомлениях. */
  async handleAnalyzed(chatId: number, rules: ChatRules, analysisVersion: string, openIncidents: Incident[], batch: AnalyzedMessage[]): Promise<void> {
    const openById = new Map(openIncidents.map((i) => [i.id, i]));
    const byRequest = new Map<string, number>();
    const touched = new Map<number, { material: boolean; trigger: AnalyzedMessage; markers: boolean }>();

    for (const a of batch) {
      const { message: m, item } = a;
      if (m.isStaff) continue;

      const refId = /^\d+$/.test(item.incident_ref) ? Number(item.incident_ref) : null;
      let target: Incident | null = null;
      if (a.requestKey && byRequest.has(a.requestKey)) target = await this.repo.get(byRequest.get(a.requestKey)!);
      if (!target && refId !== null && openById.has(refId)) target = openById.get(refId)!;
      if (!target && a.requestKey) target = await this.repo.openForRequestKey(chatId, a.requestKey);

      // явное подтверждение решения — отмечаем, статус меняет только администратор
      if (item.resolution_confirmed && target && (target.authorKey === m.authorKey || target.affectedAuthors > 1)) {
        await this.repo.update(target.id, { resolutionConfirmed: true });
        await this.repo.addEvent(target.id, 'resolution_confirmed', { messageId: m.messageId }, null);
      }

      const hasSignal = item.categories.length > 0 && item.severity !== 'none';
      if (!hasSignal) continue;

      let related: number | null = null;
      if (target && entitiesConflict(target.entities, item.entities)) {
        related = target.id;
        target = null;
      }

      const severity = item.severity as Severity;
      const categories = item.categories as Category[];
      let incidentId: number;
      if (target) {
        incidentId = target.id;
        const raised = severityRank(severity) > severityRank(target.severity);
        await this.repo.update(target.id, {
          categories: [...new Set([...target.categories, ...categories])],
          severity: maxSeverity(target.severity, severity),
          severityReason: raised ? item.severity_reason : target.severityReason,
          confidence: Math.max(target.confidence, item.confidence),
          entities: [...new Set([...target.entities, ...item.entities])].slice(0, 30),
          topic: target.topic ?? item.topic,
          analysisVersion,
        });
      } else {
        incidentId = await this.repo.create({
          chatId,
          kind: 'problem',
          title: truncate(item.summary || m.text, 120),
          summary: item.summary || truncate(m.text, 300),
          topic: item.topic,
          categories,
          severity,
          severityReason: item.severity_reason,
          confidence: item.confidence,
          entities: item.entities.slice(0, 30),
          authorKey: m.authorKey,
          authorName: m.identityLimited ? `${m.authorName} (идентификация ограничена)` : m.authorName,
          firstMessageAt: m.sentAt,
          lastMessageAt: m.sentAt,
          relatedIncidentId: related,
          analysisVersion,
          spikeData: null,
        });
        await this.repo.addEvent(incidentId, 'created', { messageId: m.messageId, related }, null);
      }
      await this.repo.addMessages(incidentId, [m.id]);
      if (target) await this.repo.addEvent(incidentId, 'message', { messageId: m.messageId, summary: item.summary }, null);
      if (a.requestKey) byRequest.set(a.requestKey, incidentId);
      const prev = touched.get(incidentId);
      touched.set(incidentId, {
        material: (prev?.material ?? false) || (Boolean(target) && item.material_update),
        trigger: a,
        markers: (prev?.markers ?? false) || item.repeat_markers.length > 0,
      });
    }

    for (const [id, t] of touched) {
      await this.repo.recomputeCounters(id);
      await this.applyRepeatRules(id, t.trigger, rules, t.markers);
      const incident = await this.repo.get(id);
      if (!incident) continue;
      await this.evaluateAndDispatch(incident, rules, t.material, {
        sentAt: t.trigger.message.sentAt,
        receivedAt: t.trigger.message.receivedAt,
        analyzedAt: t.trigger.analyzedAt,
      });
    }
  }

  /** Повторяемость считается кодом по БД, а не моделью. */
  private async applyRepeatRules(id: number, trigger: AnalyzedMessage, rules: ChatRules, markers: boolean): Promise<void> {
    const incident = await this.repo.get(id);
    if (!incident) return;
    const at = new Date(trigger.message.sentAt);
    const upTo = new Date(at.getTime() + 1).toISOString();
    const cats = new Set(incident.categories);
    let severity = incident.severity;
    let authorRepeat = false;

    const w = await this.repo.windowCounts(id, new Date(at.getTime() - rules.repeatWindowMin * 60_000).toISOString(), upTo);
    if (w.messages >= rules.repeatCount) cats.add('repeat');
    if (markers) {
      cats.add('repeat');
      cats.add('prolonged');
    }
    if (trigger.message.authorKey) {
      authorRepeat = await this.repo.authorHadEarlierRequest(
        id,
        trigger.message.authorKey,
        new Date(at.getTime() - rules.authorRepeatHours * 3600_000).toISOString(),
        trigger.message.sentAt,
        trigger.requestKey,
      );
      if (authorRepeat) cats.add('repeat');
    }
    const mass = await this.repo.windowCounts(id, new Date(at.getTime() - rules.massWindowMin * 60_000).toISOString(), upTo);
    const isMass = mass.authors >= rules.massAuthors;
    if (isMass) {
      cats.add('repeat');
      severity = maxSeverity(severity, 'high');
    }
    const repeatType: Incident['repeatType'] = isMass
      ? 'mass'
      : incident.affectedAuthors > 1
        ? 'multi'
        : incident.messageCount > 1 && (cats.has('repeat') || authorRepeat)
          ? 'author_repeat'
          : 'single';
    await this.repo.update(id, {
      categories: [...cats],
      severity,
      severityReason: severity !== incident.severity ? `Массовая проблема: ${mass.authors} участников за ${rules.massWindowMin} мин` : undefined,
      repeatType,
    });
  }

  /** Решение по политике cooldown/эскалации и постановка уведомлений. */
  async evaluateAndDispatch(incident: Incident, rules: ChatRules, material: boolean, trigger: AlertTrigger): Promise<Decision> {
    const d = decide(
      {
        status: incident.status,
        severity: incident.severity,
        confidence: incident.confidence,
        categories: incident.categories,
        affectedAuthors: incident.affectedAuthors,
        messageCount: incident.messageCount,
        lastAlertAt: incident.lastAlertAt,
        lastAlertSeverity: incident.lastAlertSeverity,
        lastAlertCategories: incident.lastAlertCategories,
        lastAlertAuthors: incident.lastAlertAuthors,
        lastAlertMessageCount: incident.lastAlertMessageCount,
      },
      rules,
      new Date(),
      material,
    );
    if (d.action === 'none') {
      if (d.borderline !== incident.borderline && !incident.lastAlertAt) await this.repo.update(incident.id, { borderline: d.borderline });
      return d;
    }
    if (d.action === 'defer') {
      if (!incident.pendingUpdate) await this.repo.update(incident.id, { pendingUpdate: true });
      return d;
    }
    const kind = d.action === 'alert' ? 'alert' : 'incident_update';
    if (incident.borderline) await this.repo.update(incident.id, { borderline: false });
    const queued = await this.alerts.enqueue(incident, kind, d.reason, trigger);
    await this.repo.markAlerted(incident);
    await this.repo.addEvent(incident.id, kind === 'alert' ? 'alert' : 'update', { reason: d.reason, recipients: queued }, null);
    return d;
  }

  /** Отложенные в cooldown обновления — одним сводным сообщением после его окончания. */
  async flushPending(): Promise<void> {
    for (const i of await this.repo.listPendingUpdates()) {
      const rules = await this.settings.rulesFor(i.chatId);
      if (!i.lastAlertAt || Date.now() < new Date(i.lastAlertAt).getTime() + rules.cooldownMin * 60_000) continue;
      await this.evaluateAndDispatch(i, rules, false, { sentAt: null, receivedAt: null, analyzedAt: null });
    }
  }

  // --- админка ---

  list(f: IncidentFilter) {
    return this.repo.list(f);
  }

  topics(): Promise<string[]> {
    return this.repo.topics();
  }

  async details(id: number): Promise<{
    incident: Incident;
    messages: Message[];
    events: IncidentEvent[];
    feedback: Array<{ recipientId: number; verdict: string; analysisVersion: string | null; createdAt: string }>;
  }> {
    const incident = await this.repo.get(id);
    if (!incident) throw new NotFoundError('Инцидент не найден');
    return {
      incident,
      messages: await this.repo.messages(id, 100, 0),
      events: await this.repo.events(id),
      feedback: await this.repo.feedbackFor(id),
    };
  }

  async setStatus(id: number, status: IncidentStatus, actor: string): Promise<Incident> {
    const incident = await this.repo.get(id);
    if (!incident) throw new NotFoundError('Инцидент не найден');
    if (incident.status !== status) {
      await this.repo.setStatus(id, status, actor);
      await this.repo.addEvent(id, 'status', { from: incident.status, to: status }, actor);
      await this.audit.record(actor, 'incident.status', 'incident', String(id), { status: incident.status }, { status });
    }
    return (await this.repo.get(id))!;
  }

  get(id: number): Promise<Incident | null> {
    return this.repo.get(id);
  }

  getMany(ids: number[]): Promise<Incident[]> {
    return this.repo.getMany(ids);
  }

  // --- обратная связь из кнопок ---

  async handleCallback(cb: BotCallback): Promise<void> {
    const reply = this.bots.replyFor(cb.channel);
    const answer = async (text: string) => {
      try {
        await reply.answerCallback(cb.id, text);
      } catch (err) {
        console.error('[feedback] answerCallback failed:', (err as Error).message);
      }
    };
    const m = /^fb:(\d+):([uf])$/.exec(cb.data);
    if (!m) return answer('Неизвестное действие');
    const incidentId = Number(m[1]);
    const verdict = m[2] === 'u' ? 'useful' : 'false';
    const recipient = await this.recipients.findByChannelId(cb.channel, cb.fromId);
    const active = recipient && (cb.channel === 'telegram' ? recipient.status === 'active' : recipient.maxStatus === 'active');
    if (!recipient || !active) return answer('Оценка недоступна');
    if (!(await this.deliveries.wasSentToRecipient(incidentId, recipient.id))) return answer('Оценка недоступна');
    const incident = await this.repo.get(incidentId);
    if (!incident) return answer('Инцидент не найден');
    await this.repo.saveFeedback(incidentId, recipient.id, verdict, incident.analysisVersion);
    await this.repo.addEvent(incidentId, 'feedback', { recipientId: recipient.id, verdict }, `recipient:${recipient.id}`);
    return answer(verdict === 'useful' ? 'Спасибо! Отмечено как полезный сигнал' : 'Спасибо! Отмечено как ложное срабатывание');
  }

  // --- всплески ---

  async createSpike(n: Parameters<IncidentRepository['create']>[0]): Promise<Incident> {
    const id = await this.repo.create(n);
    await this.repo.addEvent(id, 'created', { spike: n.spikeData }, null);
    return (await this.repo.get(id))!;
  }

  recentSpike(chatId: number, sinceIso: string): Promise<Incident | null> {
    return this.repo.recentSpike(chatId, sinceIso);
  }

  async updateSpike(i: Incident, spike: NonNullable<Incident['spikeData']>): Promise<Incident> {
    await this.repo.update(i.id, { spikeData: spike });
    await this.repo.setSpikeWindow(i.id, spike.windowEnd, Math.max(i.messageCount, spike.count), Math.max(i.affectedAuthors, spike.authors));
    return (await this.repo.get(i.id))!;
  }

  activeInPeriod(chatId: number, from: string, to: string): Promise<Incident[]> {
    return this.repo.activeInPeriod(chatId, from, to);
  }

  facts(incidentId: number) {
    return this.repo.facts(incidentId);
  }
}
