import type { ReportRepository } from '~server/repositories/report-repository';
import type { AnalysisRepository } from '~server/repositories/analysis-repository';
import type { ChatPeriodDigest, DigestContent, DigestIncident, DigestRequest, DigestStatement, ReportPeriod } from '~server/models/report';
import { isActiveIncident } from '~server/domain/situation';
import { AiError, type AiClient } from '~server/integrations/ai-client';
import { DigestResponseSchema, digestJsonSchema } from '~server/integrations/ai-schemas';
import { DIGEST_PROMPT_VERSION, digestSystemPrompt } from '~server/integrations/prompts';
import { severityRank, type Severity } from '~shared/domain';
import type { ChatService } from './chat-service';
import type { GapService } from './gap-service';
import type { IncidentService } from './incident-service';
import type { RuntimeState } from './runtime-state';
import type { SettingsService } from './settings-service';
import { TECH } from './settings-defaults';

/**
 * Разбор одного чата за период — общий для всех получателей.
 * Числа считает SQL; модель пишет только краткую картину со ссылками на сообщения-основания.
 * Иерархия: сообщение (анализ) → обращение (summary) → чат за период (этот дайджест) → отчёт получателя.
 */
export class DigestService {
  constructor(
    private readonly repo: ReportRepository,
    private readonly analysis: AnalysisRepository,
    private readonly ai: AiClient,
    private readonly chats: ChatService,
    private readonly incidents: IncidentService,
    private readonly gaps: GapService,
    private readonly settings: SettingsService,
    private readonly state: RuntimeState,
  ) {}

  async ensure(chatId: number, period: ReportPeriod): Promise<ChatPeriodDigest> {
    return (await this.repo.latestDigest(chatId, period.id)) ?? this.build(chatId, period, 1);
  }

  async rebuild(chatId: number, period: ReportPeriod): Promise<ChatPeriodDigest> {
    const last = await this.repo.latestDigest(chatId, period.id);
    return this.build(chatId, period, (last?.version ?? 0) + 1);
  }

  private async build(chatId: number, period: ReportPeriod, version: number): Promise<ChatPeriodDigest> {
    const { stats, content } = await this.compute(chatId, period.startsAt, period.endsAt);
    await this.repo.saveDigest(chatId, period.id, version, stats, content);
    return (await this.repo.latestDigest(chatId, period.id))!;
  }

  /**
   * Дайджест за произвольный интервал без записи периода — для «Что сейчас происходит».
   * AICODE-NOTE: кэш в памяти (процесс один) на 2 минуты по чату и интервалу, округлённому
   * до минуты: несколько получателей одного чата не вызывают AI повторно.
   */
  async buildAdHoc(chatId: number, from: string, to: string): Promise<ChatPeriodDigest> {
    const key = `${chatId}|${from}|${to.slice(0, 16)}`;
    const now = Date.now();
    for (const [k, v] of this.adHocCache) if (now - v.at > TECH.onDemandCacheMs) this.adHocCache.delete(k);
    const cached = this.adHocCache.get(key);
    if (cached) return cached.digest;
    const { stats, content } = await this.compute(chatId, from, to);
    const digest: ChatPeriodDigest = { id: 0, chatId, periodId: 0, version: 0, stats, content, createdAt: new Date().toISOString() };
    this.adHocCache.set(key, { at: now, digest });
    return digest;
  }

  private adHocCache = new Map<string, { at: number; digest: ChatPeriodDigest }>();

  private async compute(chatId: number, from: string, to: string): Promise<{ stats: ChatPeriodDigest['stats']; content: DigestContent }> {
    const rules = await this.settings.rulesFor(chatId);
    const staffConfigured = await this.chats.staffConfigured(chatId);
    const stats = await this.repo.chatPeriodStats(chatId, from, to);

    const rows = [];
    for (let offset = 0; offset < TECH.digestMaxRequests; offset += 100) {
      const page = await this.repo.chatPeriodRequests(chatId, from, to, rules.noReplyWindowMin, offset);
      rows.push(...page);
      if (page.length < 100) break;
    }
    const periodEnd = new Date(to).getTime();
    const requests: DigestRequest[] = rows.map((r) => {
      const waitedEnough = new Date(r.sent_at).getTime() + rules.noReplyWindowMin * 60_000 <= periodEnd;
      const status: DigestRequest['status'] = r.resolved
        ? 'resolved'
        : !staffConfigured
          ? 'unknown'
          : r.answered
            ? 'answered'
            : waitedEnough
              ? 'no_reply'
              : 'unknown';
      const sev = (r.severity ?? 'info') as Severity;
      return {
        requestKey: r.request_key,
        authorName: r.author_name,
        identityLimited: r.identity_limited === 1,
        summary: r.summary ?? '',
        topic: r.topic ?? '',
        severity: r.severity ?? 'none',
        messages: r.n,
        repeats: Math.max(0, r.n - 1),
        status,
        firstMessageId: r.first_message_id,
        firstMessagePk: r.first_pk,
        link: r.link,
        sentAt: r.sent_at,
        score: (r.severity ? severityRank(sev) + 1 : 0) * 10 + Math.min(r.n, 10) * 2 + (status === 'no_reply' ? 5 : 0),
      };
    });
    requests.sort((a, b) => b.score - a.score || a.sentAt.localeCompare(b.sentAt));

    const active = await this.incidents.activeInPeriod(chatId, from, to);
    const spikes = active
      .filter((i) => i.kind === 'spike' && i.spikeData)
      .map((i) => ({
        incidentId: i.id,
        at: i.spikeData!.windowEnd,
        count: i.spikeData!.count,
        baseline: Math.round(i.spikeData!.baselinePerWindow * 10) / 10,
        authors: i.spikeData!.authors,
        topics: i.spikeData!.topics.map((t) => t.topic),
        historyLimited: i.spikeData!.historyLimited,
      }));
    const problems: DigestIncident[] = [];
    for (const i of active.filter((x) => x.kind === 'problem')) {
      // источник и ответ поддержки — для строки «кто · где · что» в блоке «Требует решения»
      const facts = isActiveIncident(i) ? await this.incidents.facts(i.id) : null;
      problems.push({
        id: i.id,
        title: i.title,
        severity: i.severity,
        categories: i.categories,
        messageCount: i.messageCount,
        affectedAuthors: i.affectedAuthors,
        status: i.status,
        prolonged: i.categories.includes('prolonged') || i.categories.includes('repeat'),
        authorName: i.authorName,
        link: facts?.link ?? null,
        firstMessageAt: i.firstMessageAt,
        staffReplied: staffConfigured && facts ? facts.staffReplied : null,
      });
    }
    const gaps = (await this.gaps.overlapping(chatId, from, to)).map((g) => ({ startedAt: g.startedAt, endedAt: g.endedAt, reason: g.reason }));

    const content: DigestContent = {
      overview: [],
      toneReasons: [],
      attention: [],
      requests,
      spikes,
      incidents: problems,
      gaps,
      staffConfigured,
      aiAvailable: true,
      keyLinks: [],
    };

    if (stats.messages > 0 && requests.length + problems.length > 0) {
      const ai = await this.aiOverview(chatId, { startsAt: from, endsAt: to }, stats, content);
      if (ai) {
        content.headline = ai.headline;
        content.overview = ai.overview;
        content.toneReasons = ai.toneReasons;
        content.attention = ai.attention;
      } else {
        content.aiAvailable = false;
      }
    }
    const evidence = [...(content.headline ? [content.headline] : []), ...content.overview, ...content.attention].flatMap((s) => s.evidence);
    const keyIds = [...new Set([...evidence, ...requests.slice(0, 5).map((r) => r.firstMessageId)])].slice(0, 8);
    const links = await this.repo.linksFor(chatId, keyIds);
    content.keyLinks = keyIds.map((id) => ({ messageId: id, link: links.get(id) ?? null }));

    return { stats, content };
  }

  private async aiOverview(
    chatId: number,
    period: { startsAt: string; endsAt: string },
    stats: ChatPeriodDigest['stats'],
    c: DigestContent,
  ): Promise<{ headline: DigestStatement | null; overview: DigestStatement[]; toneReasons: DigestStatement[]; attention: DigestStatement[] } | null> {
    if (!this.ai.configured) return null;
    const g = await this.settings.global();
    const payload = {
      data: {
        stats,
        requests: c.requests.slice(0, 80).map((r) => ({
          message_id: r.firstMessageId,
          author: r.authorName,
          summary: r.summary,
          topic: r.topic,
          severity: r.severity,
          messages: r.messages,
          status: r.status,
        })),
        incidents: c.incidents,
        spikes: c.spikes,
        support_staff_configured: c.staffConfigured,
      },
    };
    try {
      const res = await this.ai.structured({
        model: g.aiModel,
        system: digestSystemPrompt(),
        user: JSON.stringify(payload),
        schemaName: 'chat_digest',
        jsonSchema: digestJsonSchema(),
        parse: (raw) => DigestResponseSchema.parse(raw),
        timeoutMs: 90_000,
      });
      this.state.aiOk();
      await this.logCall(res.usage, true, null);
      // основания должны быть сообщениями этого чата за этот период
      const allIds = [res.data.headline, ...res.data.overview, ...res.data.tone_reasons, ...res.data.attention].flatMap((s) => s.evidence_message_ids);
      const valid = await this.repo.periodMessageIds(chatId, period.startsAt, period.endsAt, [...new Set(allIds)]);
      const keep = (arr: Array<{ text: string; evidence_message_ids: number[] }>): DigestStatement[] =>
        arr
          .map((s) => ({ text: s.text, evidence: s.evidence_message_ids.filter((id) => valid.has(id)) }))
          .filter((s) => s.evidence.length > 0);
      const [headline] = keep([res.data.headline]);
      return { headline: headline ?? null, overview: keep(res.data.overview), toneReasons: keep(res.data.tone_reasons), attention: keep(res.data.attention) };
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError('unavailable', (err as Error).message);
      if (e.usage) await this.logCall(e.usage, false, e.message);
      if (e.kind === 'unavailable') this.state.aiFailed(e.message);
      console.error('[digest] AI overview failed:', e.message);
      return null;
    }
  }

  private logCall(u: { model: string; startedAt: string; durationMs: number; inputTokens: number; outputTokens: number }, ok: boolean, error: string | null) {
    return this.analysis.logCall({ purpose: 'digest', promptVersion: DIGEST_PROMPT_VERSION, ...u, ok, error });
  }
}
