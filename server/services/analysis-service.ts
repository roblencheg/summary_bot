import { randomUUID } from 'node:crypto';
import type { MessageRepository } from '~server/repositories/message-repository';
import type { AnalysisRepository } from '~server/repositories/analysis-repository';
import type { Message } from '~server/models/message';
import type { Incident } from '~server/models/incident';
import { AiError, type AiClient, type AiUsage } from '~server/integrations/ai-client';
import { AnalysisResponseSchema, analysisJsonSchema, type AnalysisItem } from '~server/integrations/ai-schemas';
import { ANALYSIS_PROMPT_VERSION, analysisSystemPrompt } from '~server/integrations/prompts';
import { OTHER_TOPIC, type Category, type Severity } from '~shared/domain';
import type { ChatService } from './chat-service';
import type { IncidentService, AnalyzedMessage } from './incident-service';
import type { RuntimeState } from './runtime-state';
import type { SettingsService } from './settings-service';
import type { SpikeService } from './spike-service';
import { TECH } from './settings-defaults';
import { analysisPayload, authorRef } from '~server/domain/analysis-payload';

export class AnalysisService {
  constructor(
    private readonly messages: MessageRepository,
    private readonly results: AnalysisRepository,
    private readonly ai: AiClient,
    private readonly chats: ChatService,
    private readonly incidents: IncidentService,
    private readonly spikes: SpikeService,
    private readonly settings: SettingsService,
    private readonly state: RuntimeState,
  ) {}

  /** Чаты, где есть готовый к анализу пакет (debounce истёк или набран полный пакет). */
  async readyChats(now = Date.now()): Promise<number[]> {
    const pending = await this.messages.pendingChats();
    return pending
      .filter((p) => p.n >= TECH.analysisBatchSize || now - new Date(p.oldestReceivedAt).getTime() >= TECH.analysisDebounceMs)
      .map((p) => p.chatId);
  }

  /** Анализ одного пакета чата. Возвращает false, если AI недоступен. */
  async processChat(chatId: number): Promise<boolean> {
    if (!this.ai.configured) return false;
    const batch = await this.messages.claimForAnalysis(chatId, TECH.analysisBatchSize, 120_000);
    if (!batch.length) return true;
    const ids = batch.map((m) => m.id);
    const g = await this.settings.global();
    const rules = await this.settings.rulesFor(chatId);
    const rulesVersion = await this.settings.rulesVersion(chatId);
    const topics = [...g.topics, OTHER_TOPIC];

    const since = new Date(new Date(batch[0].sentAt).getTime() - g.contextWindowHours * 3600_000).toISOString();
    const context = await this.messages.contextBefore(chatId, batch[0].sentAt, since, TECH.contextMessages);
    const known = new Set([...context, ...batch].map((m) => m.messageId));
    const replyIds = batch.map((m) => m.replyToMessageId).filter((x): x is number => x !== null && !known.has(x));
    const replies = await this.messages.getByChatMessageIds(chatId, [...new Set(replyIds)]);
    const allContext = [...replies, ...context].sort((a, b) => a.sentAt.localeCompare(b.sentAt));

    const openSince = new Date(Date.now() - TECH.openIncidentWindowHours * 3600_000).toISOString();
    const open = await this.incidents.openForChat(chatId, openSince, TECH.openIncidentsInPrompt);

    const data = analysisPayload(topics, allContext, open, batch);

    const batchId = randomUUID();
    let items: AnalysisItem[];
    let usage: AiUsage;
    try {
      const res = await this.ai.structured({
        model: g.aiModel,
        system: analysisSystemPrompt(topics),
        user: JSON.stringify(data),
        schemaName: 'message_analysis',
        jsonSchema: analysisJsonSchema(topics),
        parse: (raw) => AnalysisResponseSchema.parse(raw),
        timeoutMs: 60_000,
      });
      items = res.data.messages;
      usage = res.usage;
      this.state.aiOk();
      await this.logCall(usage, true, null);
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError('unavailable', (err as Error).message);
      if (e.usage) await this.logCall(e.usage, false, e.message);
      if (e.kind === 'unavailable') {
        this.state.aiFailed(e.message);
        await this.messages.postpone(ids, e.message, 30_000 + Math.random() * 30_000);
        return false;
      }
      await this.messages.markAnalysisError(ids, e.message, TECH.analysisMaxAttempts, 10_000);
      return true;
    }

    const analysisVersion = `${g.aiModel}|${ANALYSIS_PROMPT_VERSION}|${rulesVersion}`;
    const analyzedAt = new Date().toISOString();
    const byMsgId = new Map(items.map((i) => [i.message_id, i]));
    const openIds = new Set(open.map((i) => String(i.id)));
    const analyzed: AnalyzedMessage[] = [];
    const missing: number[] = [];

    for (const m of batch) {
      const raw = byMsgId.get(m.messageId);
      if (!raw) {
        missing.push(m.id);
        continue;
      }
      const flags: string[] = [];
      const item: AnalysisItem = { ...raw };
      // ссылки только на переданные данные
      const ev = item.evidence_message_ids.filter((x) => known.has(x) || replies.some((r) => r.messageId === x));
      if (ev.length !== item.evidence_message_ids.length) flags.push('invalid_refs');
      item.evidence_message_ids = ev;
      const ans = item.answers_message_ids.filter((x) => known.has(x) || replies.some((r) => r.messageId === x));
      if (ans.length !== item.answers_message_ids.length) flags.push('invalid_refs');
      item.answers_message_ids = ans;
      if (!['none', 'new'].includes(item.incident_ref) && !openIds.has(item.incident_ref)) {
        flags.push('invalid_incident_ref');
        item.incident_ref = item.categories.length ? 'new' : 'none';
      }
      if (!topics.includes(item.topic)) {
        flags.push('unknown_topic');
        item.topic = OTHER_TOPIC;
      }
      if (m.isStaff) {
        // роль задаёт конфигурация, не модель: реплики сотрудников не бывают обращением или сигналом
        item.is_request = false;
        item.categories = [];
        item.severity = 'none';
        item.resolution_confirmed = false;
      }
      if (!item.categories.length) item.severity = 'none';
      if (item.severity === 'none') item.categories = [];

      const requestKey = this.requestKey(item, batchId, allContext, m);
      const analysisId = await this.results.insertResult({
        messagePk: m.id,
        chatId,
        batchId,
        model: g.aiModel,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        rulesVersion,
        result: item,
        flags: [...new Set(flags)],
      });
      await this.messages.saveAnalysis(m.id, {
        analysisId,
        isRequest: item.is_request,
        requestKey,
        topic: item.topic,
        tone: item.tone,
        categories: item.categories as Category[],
        severity: item.severity as Severity | 'none',
        confidence: item.confidence,
        summary: item.summary,
        resolutionConfirmed: item.resolution_confirmed,
        answersMessageIds: item.answers_message_ids,
      });
      analyzed.push({ message: { ...m, requestKey }, item, requestKey, analyzedAt });
    }
    if (missing.length) await this.messages.markAnalysisError(missing, 'Модель не вернула результат для сообщения', TECH.analysisMaxAttempts, 5_000);

    await this.incidents.handleAnalyzed(chatId, rules, analysisVersion, open, analyzed);
    const chat = await this.chats.get(chatId);
    if (chat) await this.spikes.check(chat);
    return true;
  }

  /**
   * Ключ обращения: существующий из контекста — только если это обращение того же автора;
   * иначе новый в рамках пакета с привязкой к автору (разные авторы — разные обращения).
   */
  private requestKey(item: AnalysisItem, batchId: string, context: Message[], m: Message): string | null {
    if (!item.is_request) return null;
    const ref = item.request_ref.trim();
    if (ref && context.some((c) => c.requestKey === ref && c.authorKey === m.authorKey)) return ref;
    const label = ref.replace(/^new:/, '').replace(/[^\w-]/g, '').slice(0, 40) || `m${item.message_id}`;
    const author = authorRef(m) ?? `m${m.messageId}`;
    return `${batchId.slice(0, 8)}:${label}:${author}`;
  }

  private logCall(u: AiUsage, ok: boolean, error: string | null): Promise<void> {
    return this.results.logCall({
      purpose: 'analysis',
      model: u.model,
      promptVersion: ANALYSIS_PROMPT_VERSION,
      startedAt: u.startedAt,
      durationMs: u.durationMs,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      ok,
      error,
    });
  }

  backlog() {
    return this.messages.backlog();
  }

  requeueFailed(chatId: number | null): Promise<number> {
    return this.messages.requeueFailed(chatId);
  }
}
