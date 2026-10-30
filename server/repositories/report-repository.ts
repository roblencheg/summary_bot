import type { Db } from '~server/platform';
import type { ChatPeriodDigest, ChatPeriodStats, DigestContent, Report, ReportPeriod } from '~server/models/report';
import type { PeriodType } from '~shared/domain';
import { OTHER_TOPIC } from '~shared/domain';
import { isoPlus, newLeaseToken, nowIso, parseJson, placeholders } from './sql-utils';

interface PeriodRow {
  id: number;
  period_type: string;
  starts_at: string;
  ends_at: string;
  status: string;
  error: string | null;
  created_at: string;
}

const rowToPeriod = (r: PeriodRow): ReportPeriod => ({
  id: r.id,
  periodType: r.period_type as PeriodType,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  status: r.status as ReportPeriod['status'],
  error: r.error,
  createdAt: r.created_at,
});

interface ReportRow {
  id: number;
  recipient_id: number;
  period_id: number;
  period_type: string;
  starts_at: string;
  ends_at: string;
  version: number;
  manual: number;
  status: string;
  chat_ids: string | null;
  parts: string | null;
  full_text: string | null;
  rich_html?: string | null;
  delayed: number;
  created_at: string;
  built_at: string | null;
  sent_at: string | null;
  max_status: string;
  max_chat_ids: string | null;
  max_parts: string | null;
  max_full_text: string | null;
  max_built_at: string | null;
  max_sent_at: string | null;
}

const rowToReport = (r: ReportRow): Report => ({
  id: r.id,
  recipientId: r.recipient_id,
  periodId: r.period_id,
  periodType: r.period_type as PeriodType,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  version: r.version,
  manual: r.manual === 1,
  status: r.status as Report['status'],
  chatIds: parseJson<number[]>(r.chat_ids, []),
  parts: parseJson<string[]>(r.parts, []),
  fullText: r.full_text,
  richHtml: r.rich_html ?? null,
  delayed: r.delayed === 1,
  createdAt: r.created_at,
  builtAt: r.built_at,
  sentAt: r.sent_at,
  maxStatus: r.max_status as Report['status'],
  maxChatIds: parseJson<number[]>(r.max_chat_ids, []),
  maxParts: parseJson<string[]>(r.max_parts, []),
  maxFullText: r.max_full_text,
  maxBuiltAt: r.max_built_at,
  maxSentAt: r.max_sent_at,
});

export interface RequestRow {
  request_key: string;
  author_name: string;
  identity_limited: number;
  summary: string | null;
  topic: string | null;
  severity: string | null;
  n: number;
  first_message_id: number;
  first_pk: number;
  link: string | null;
  sent_at: string;
  resolved: number;
  answered: number;
}

export class ReportRepository {
  constructor(private readonly db: Db) {}

  // --- периоды ---

  /** Идемпотентно: UNIQUE(period_type, starts_at). */
  async ensurePeriod(type: PeriodType, startsAt: string, endsAt: string): Promise<ReportPeriod> {
    await this.db.exec(
      `INSERT INTO report_periods (period_type, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(period_type, starts_at) DO NOTHING`,
      [type, startsAt, endsAt, nowIso()],
    );
    const r = await this.db.first<PeriodRow>('SELECT * FROM report_periods WHERE period_type = ? AND starts_at = ?', [type, startsAt]);
    if (!r) throw new Error('ensurePeriod: not found');
    return rowToPeriod(r);
  }

  async getPeriod(id: number): Promise<ReportPeriod | null> {
    const r = await this.db.first<PeriodRow>('SELECT * FROM report_periods WHERE id = ?', [id]);
    return r ? rowToPeriod(r) : null;
  }

  async latestPeriodEnd(): Promise<string | null> {
    const r = await this.db.first<{ e: string | null }>('SELECT MAX(ends_at) AS e FROM report_periods');
    return r?.e ?? null;
  }

  async countPeriodsEndingBetween(afterIso: string, untilIso: string): Promise<number> {
    const r = await this.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM report_periods WHERE ends_at > ? AND ends_at <= ?', [
      afterIso,
      untilIso,
    ]);
    return r?.n ?? 0;
  }

  async listPeriods(limit: number, offset: number): Promise<ReportPeriod[]> {
    const rows = await this.db.query<PeriodRow>('SELECT * FROM report_periods ORDER BY ends_at DESC LIMIT ? OFFSET ?', [
      Math.min(limit, 100),
      offset,
    ]);
    return rows.map(rowToPeriod);
  }

  async claimCollectingPeriod(leaseMs: number): Promise<ReportPeriod | null> {
    const token = newLeaseToken();
    await this.db.exec(
      `UPDATE report_periods SET lease_token = ?, lease_until = ? WHERE id = (
         SELECT id FROM report_periods WHERE status = 'collecting' AND ends_at <= ? AND (lease_until IS NULL OR lease_until < ?)
         ORDER BY ends_at LIMIT 1)`,
      [token, isoPlus(leaseMs), nowIso(), nowIso()],
    );
    const r = await this.db.first<PeriodRow>('SELECT * FROM report_periods WHERE lease_token = ?', [token]);
    return r ? rowToPeriod(r) : null;
  }

  async setPeriodStatus(id: number, status: ReportPeriod['status'], error: string | null): Promise<void> {
    await this.db.exec('UPDATE report_periods SET status = ?, error = ?, lease_token = NULL, lease_until = NULL WHERE id = ?', [
      status,
      error,
      id,
    ]);
  }

  async postponePeriod(id: number, retryInMs: number, error: string | null): Promise<void> {
    await this.db.exec('UPDATE report_periods SET lease_token = NULL, lease_until = ?, error = ? WHERE id = ?', [
      isoPlus(retryInMs),
      error,
      id,
    ]);
  }

  // --- статистика периода (SQL) ---

  async chatPeriodStats(chatId: number, from: string, to: string): Promise<ChatPeriodStats> {
    const base = await this.db.first<{
      n: number;
      authors: number;
      unident: number | null;
      no_text: number | null;
      unanalyzed: number | null;
    }>(
      `SELECT COUNT(*) AS n,
              COUNT(DISTINCT CASE WHEN identity_limited = 0 AND author_key IS NOT NULL THEN author_key END) AS authors,
              SUM(CASE WHEN identity_limited = 1 OR author_key IS NULL THEN 1 ELSE 0 END) AS unident,
              SUM(CASE WHEN has_text = 0 THEN 1 ELSE 0 END) AS no_text,
              SUM(CASE WHEN analysis_status IN ('pending', 'failed') THEN 1 ELSE 0 END) AS unanalyzed
       FROM messages WHERE chat_id = ? AND sent_at >= ? AND sent_at < ?`,
      [chatId, from, to],
    );
    // обращение = уникальный request_key среди не-сотрудников; повторное — ключ с >1 сообщением автора
    // в разные моменты (≥ 10 мин между первым и последним) либо с маркером повтора от модели
    const req = await this.db.first<{ requests: number; repeated: number | null; classified: number | null }>(
      `SELECT COUNT(*) AS requests,
              SUM(CASE WHEN (julianday(last_at) - julianday(first_at)) * 1440 >= 10 OR has_repeat = 1 THEN 1 ELSE 0 END) AS repeated,
              SUM(CASE WHEN topic IS NOT NULL AND topic <> ? THEN 1 ELSE 0 END) AS classified
       FROM (
         SELECT request_key, MIN(sent_at) AS first_at, MAX(sent_at) AS last_at, MAX(topic) AS topic,
                MAX(CASE WHEN categories LIKE '%"repeat"%' OR categories LIKE '%"prolonged"%' THEN 1 ELSE 0 END) AS has_repeat
         FROM messages WHERE chat_id = ? AND sent_at >= ? AND sent_at < ? AND is_request = 1 AND is_staff = 0
           AND request_key IS NOT NULL
         GROUP BY request_key
       )`,
      [OTHER_TOPIC, chatId, from, to],
    );
    const risk = await this.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND sent_at >= ? AND sent_at < ? AND is_staff = 0
         AND categories IS NOT NULL AND categories <> '[]'`,
      [chatId, from, to],
    );
    const topics = await this.db.query<{ topic: string; n: number }>(
      `SELECT COALESCE(topic, ?) AS topic, COUNT(*) AS n FROM (
         SELECT request_key, MAX(topic) AS topic FROM messages
         WHERE chat_id = ? AND sent_at >= ? AND sent_at < ? AND is_request = 1 AND is_staff = 0 AND request_key IS NOT NULL
         GROUP BY request_key)
       GROUP BY COALESCE(topic, ?) ORDER BY n DESC LIMIT 20`,
      [OTHER_TOPIC, chatId, from, to, OTHER_TOPIC],
    );
    const tones = await this.db.query<{ tone: string; n: number }>(
      `SELECT tone, COUNT(*) AS n FROM messages WHERE chat_id = ? AND sent_at >= ? AND sent_at < ? AND tone IS NOT NULL AND is_staff = 0
       GROUP BY tone ORDER BY n DESC`,
      [chatId, from, to],
    );
    return {
      messages: base?.n ?? 0,
      authors: base?.authors ?? 0,
      unidentified: base?.unident ?? 0,
      attachmentsNoText: base?.no_text ?? 0,
      unanalyzed: base?.unanalyzed ?? 0,
      requests: req?.requests ?? 0,
      repeatedRequests: req?.repeated ?? 0,
      classifiedRequests: req?.classified ?? 0,
      riskSignals: risk?.n ?? 0,
      topics: topics.map((t) => ({ topic: t.topic, count: t.n })),
      tones: tones.map((t) => ({ tone: t.tone, count: t.n })),
    };
  }

  /**
   * Обращения периода с признаками ответа. «Ответ» — сообщение сотрудника в ответ (reply) на
   * сообщение обращения или следующее после первого сообщения обращения в пределах окна ожидания.
   */
  async chatPeriodRequests(chatId: number, from: string, to: string, noReplyWindowMin: number, offset: number): Promise<RequestRow[]> {
    return this.db.query<RequestRow>(
      `SELECT g.request_key, g.author_name, g.identity_limited, g.summary, g.topic, g.severity, g.n, g.first_message_id, g.first_pk,
              g.link, g.sent_at, g.resolved,
              CASE WHEN EXISTS (
                SELECT 1 FROM messages s WHERE s.chat_id = ? AND s.is_staff = 1 AND (
                  s.reply_to_message_id IN (SELECT message_id FROM messages r WHERE r.chat_id = ? AND r.request_key = g.request_key)
                  OR (s.sent_at > g.sent_at AND s.sent_at < strftime('%Y-%m-%dT%H:%M:%fZ', g.sent_at, '+' || ? || ' minutes'))
                )
              ) THEN 1 ELSE 0 END AS answered
       FROM (
         SELECT m.request_key, MIN(m.author_name) AS author_name, MAX(m.identity_limited) AS identity_limited,
                (SELECT x.summary FROM messages x WHERE x.chat_id = m.chat_id AND x.request_key = m.request_key AND x.summary IS NOT NULL
                   ORDER BY x.sent_at LIMIT 1) AS summary,
                MAX(m.topic) AS topic,
                MAX(CASE m.severity WHEN 'critical' THEN 'critical' WHEN 'high' THEN 'high' WHEN 'attention' THEN 'attention'
                    WHEN 'info' THEN 'info' ELSE NULL END) AS severity,
                COUNT(*) AS n, MIN(m.message_id) AS first_message_id, MIN(m.id) AS first_pk,
                (SELECT y.link FROM messages y WHERE y.chat_id = m.chat_id AND y.request_key = m.request_key ORDER BY y.sent_at LIMIT 1) AS link,
                MIN(m.sent_at) AS sent_at,
                MAX(m.resolution_confirmed) AS resolved
         FROM messages m
         WHERE m.chat_id = ? AND m.sent_at >= ? AND m.sent_at < ? AND m.is_request = 1 AND m.is_staff = 0 AND m.request_key IS NOT NULL
         GROUP BY m.request_key
       ) g
       ORDER BY g.sent_at LIMIT 100 OFFSET ?`,
      [chatId, chatId, noReplyWindowMin, chatId, from, to, offset],
    );
  }

  async periodMessageIds(chatId: number, from: string, to: string, messageIds: number[]): Promise<Set<number>> {
    if (!messageIds.length) return new Set();
    const ids = messageIds.slice(0, 99);
    const rows = await this.db.query<{ message_id: number }>(
      `SELECT message_id FROM messages WHERE chat_id = ? AND sent_at >= ? AND sent_at < ? AND message_id IN (${placeholders(ids.length)})`,
      [chatId, from, to, ...ids],
    );
    return new Set(rows.map((r) => r.message_id));
  }

  async linksFor(chatId: number, messageIds: number[]): Promise<Map<number, string | null>> {
    if (!messageIds.length) return new Map();
    const ids = messageIds.slice(0, 99);
    const rows = await this.db.query<{ message_id: number; link: string | null }>(
      `SELECT message_id, link FROM messages WHERE chat_id = ? AND message_id IN (${placeholders(ids.length)})`,
      [chatId, ...ids],
    );
    return new Map(rows.map((r) => [r.message_id, r.link]));
  }

  // --- дайджесты чатов ---

  async saveDigest(chatId: number, periodId: number, version: number, stats: ChatPeriodStats, content: DigestContent): Promise<void> {
    await this.db.exec(
      `INSERT INTO chat_period_digests (chat_id, period_id, version, stats, content, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, period_id, version) DO UPDATE SET stats = excluded.stats, content = excluded.content, created_at = excluded.created_at`,
      [chatId, periodId, version, JSON.stringify(stats), JSON.stringify(content), nowIso()],
    );
  }

  async latestDigest(chatId: number, periodId: number): Promise<ChatPeriodDigest | null> {
    const r = await this.db.first<{ id: number; chat_id: number; period_id: number; version: number; stats: string; content: string; created_at: string }>(
      'SELECT * FROM chat_period_digests WHERE chat_id = ? AND period_id = ? ORDER BY version DESC LIMIT 1',
      [chatId, periodId],
    );
    if (!r) return null;
    return {
      id: r.id,
      chatId: r.chat_id,
      periodId: r.period_id,
      version: r.version,
      stats: JSON.parse(r.stats),
      content: JSON.parse(r.content),
      createdAt: r.created_at,
    };
  }

  async digestChatIds(periodId: number): Promise<number[]> {
    const rows = await this.db.query<{ chat_id: number }>('SELECT DISTINCT chat_id FROM chat_period_digests WHERE period_id = ? LIMIT 100', [
      periodId,
    ]);
    return rows.map((r) => r.chat_id);
  }

  // --- персональные отчёты ---

  /** Идемпотентно по ключу (получатель, тип, начало, конец, версия). Возвращает id. */
  async ensureReport(r: {
    recipientId: number;
    periodId: number;
    periodType: PeriodType;
    startsAt: string;
    endsAt: string;
    version: number;
    manual: boolean;
    status: Report['status'];
  }): Promise<{ id: number; created: boolean }> {
    const res = await this.db.exec(
      `INSERT INTO reports (recipient_id, period_id, period_type, starts_at, ends_at, version, manual, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(recipient_id, period_type, starts_at, ends_at, version) DO NOTHING`,
      [r.recipientId, r.periodId, r.periodType, r.startsAt, r.endsAt, r.version, r.manual ? 1 : 0, r.status, nowIso()],
    );
    const row = await this.db.first<{ id: number }>(
      'SELECT id FROM reports WHERE recipient_id = ? AND period_type = ? AND starts_at = ? AND ends_at = ? AND version = ?',
      [r.recipientId, r.periodType, r.startsAt, r.endsAt, r.version],
    );
    if (!row) throw new Error('ensureReport: not found');
    return { id: row.id, created: res.changes > 0 };
  }

  async maxVersion(recipientId: number, periodType: PeriodType, startsAt: string, endsAt: string): Promise<number> {
    const r = await this.db.first<{ v: number | null }>(
      'SELECT MAX(version) AS v FROM reports WHERE recipient_id = ? AND period_type = ? AND starts_at = ? AND ends_at = ?',
      [recipientId, periodType, startsAt, endsAt],
    );
    return r?.v ?? 0;
  }

  async getReport(id: number): Promise<Report | null> {
    const r = await this.db.first<ReportRow>('SELECT * FROM reports WHERE id = ?', [id]);
    return r ? rowToReport(r) : null;
  }

  async clearRich(id: number): Promise<void> {
    await this.db.exec('UPDATE reports SET rich_html = NULL WHERE id = ?', [id]);
  }

  async saveBuilt(id: number, chatIds: number[], parts: string[], fullText: string, richHtml: string | null, delayed: boolean, status: Report['status']): Promise<void> {
    await this.db.exec(
      'UPDATE reports SET chat_ids = ?, parts = ?, full_text = ?, rich_html = ?, delayed = ?, status = ?, built_at = ? WHERE id = ?',
      [JSON.stringify(chatIds), JSON.stringify(parts), fullText, richHtml, delayed ? 1 : 0, status, nowIso(), id],
    );
  }

  /** То же самое, но для MAX-набора колонок той же строки (без rich — MAX всегда текст, без delayed — отдельно не считаем). */
  async saveBuiltMax(id: number, chatIds: number[], parts: string[], fullText: string, status: Report['status']): Promise<void> {
    await this.db.exec('UPDATE reports SET max_chat_ids = ?, max_parts = ?, max_full_text = ?, max_status = ?, max_built_at = ? WHERE id = ?', [
      JSON.stringify(chatIds),
      JSON.stringify(parts),
      fullText,
      status,
      nowIso(),
      id,
    ]);
  }

  async setReportStatus(id: number, status: Report['status']): Promise<void> {
    await this.db.exec(`UPDATE reports SET status = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END WHERE id = ?`, [
      status,
      status,
      nowIso(),
      id,
    ]);
  }

  async setReportStatusMax(id: number, status: Report['status']): Promise<void> {
    await this.db.exec(`UPDATE reports SET max_status = ?, max_sent_at = CASE WHEN ? = 'sent' THEN ? ELSE max_sent_at END WHERE id = ?`, [
      status,
      status,
      nowIso(),
      id,
    ]);
  }

  async listReports(f: { recipientId?: number; recipientIds?: number[]; periodId?: number; limit: number; offset: number }): Promise<{ items: Report[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.recipientIds) {
      where.push(f.recipientIds.length ? `recipient_id IN (${f.recipientIds.map(() => '?').join(', ')})` : '0');
      params.push(...f.recipientIds);
    }
    if (f.recipientId) {
      where.push('recipient_id = ?');
      params.push(f.recipientId);
    }
    if (f.periodId) {
      where.push('period_id = ?');
      params.push(f.periodId);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.db.query<ReportRow>(
      `SELECT id, recipient_id, period_id, period_type, starts_at, ends_at, version, manual, status, chat_ids, NULL AS parts,
              NULL AS full_text, delayed, created_at, built_at, sent_at, max_status, max_chat_ids, NULL AS max_parts,
              NULL AS max_full_text, max_built_at, max_sent_at
       FROM reports ${w} ORDER BY ends_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, Math.min(f.limit, 100), f.offset],
    );
    const total = await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM reports ${w}`, params);
    return { items: rows.map(rowToReport), total: total?.n ?? 0 };
  }

  // --- хранение ---
  async deleteOlderThan(iso: string): Promise<number> {
    await this.db.exec(
      'DELETE FROM chat_period_digests WHERE id IN (SELECT d.id FROM chat_period_digests d JOIN report_periods p ON p.id = d.period_id WHERE p.ends_at < ? LIMIT 500)',
      [iso],
    );
    const r = await this.db.exec('DELETE FROM reports WHERE id IN (SELECT id FROM reports WHERE ends_at < ? LIMIT 500)', [iso]);
    await this.db.exec(
      `DELETE FROM report_periods WHERE id IN (SELECT id FROM report_periods WHERE ends_at < ?
         AND id NOT IN (SELECT period_id FROM reports) AND id NOT IN (SELECT period_id FROM chat_period_digests) LIMIT 500)`,
      [iso],
    );
    return r.changes;
  }
}
