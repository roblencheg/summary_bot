import type { Db } from '~server/platform';
import type { DeliveryAttempt, DeliveryJob, DeliveryPayload, NewDeliveryJob } from '~server/models/delivery';
import type { Channel, DeliveryKind, DeliveryStatus } from '~shared/domain';
import { isoPlus, newLeaseToken, nowIso, parseJson } from './sql-utils';

interface JobRow {
  id: number;
  dedup_key: string;
  recipient_id: number;
  kind: string;
  channel: string;
  incident_id: number | null;
  report_id: number | null;
  chat_id: number | null;
  payload: string | null;
  status: string;
  status_reason: string | null;
  attempts: number;
  parts_sent: number;
  uncertain: number;
  manual_retry: number;
  next_attempt_at: string;
  last_error: string | null;
  trigger_at: string | null;
  source_sent_at: string | null;
  source_received_at: string | null;
  analyzed_at: string | null;
  created_at: string;
  sent_at: string | null;
}

const rowToJob = (r: JobRow): DeliveryJob => ({
  id: r.id,
  dedupKey: r.dedup_key,
  recipientId: r.recipient_id,
  kind: r.kind as DeliveryKind,
  channel: r.channel as Channel,
  incidentId: r.incident_id,
  reportId: r.report_id,
  chatId: r.chat_id,
  payload: parseJson<DeliveryPayload | null>(r.payload, null),
  status: r.status as DeliveryStatus,
  statusReason: r.status_reason,
  attempts: r.attempts,
  partsSent: r.parts_sent,
  uncertain: r.uncertain === 1,
  manualRetry: r.manual_retry === 1,
  nextAttemptAt: r.next_attempt_at,
  lastError: r.last_error,
  triggerAt: r.trigger_at,
  sourceSentAt: r.source_sent_at,
  sourceReceivedAt: r.source_received_at,
  analyzedAt: r.analyzed_at,
  createdAt: r.created_at,
  sentAt: r.sent_at,
});

export interface DeliveryFilter {
  recipientId?: number;
  kind?: DeliveryKind;
  status?: DeliveryStatus;
  incidentId?: number;
  reportId?: number;
  limit: number;
  offset: number;
}

export class DeliveryRepository {
  constructor(private readonly db: Db) {}

  /** Идемпотентно по dedup_key. Возвращает true, если задание создано. */
  async enqueue(j: NewDeliveryJob): Promise<boolean> {
    const r = await this.db.exec(
      `INSERT INTO delivery_jobs (dedup_key, recipient_id, kind, channel, incident_id, report_id, chat_id, payload, manual_retry,
         next_attempt_at, trigger_at, source_sent_at, source_received_at, analyzed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(dedup_key) DO NOTHING`,
      [
        j.dedupKey,
        j.recipientId,
        j.kind,
        j.channel,
        j.incidentId ?? null,
        j.reportId ?? null,
        j.chatId ?? null,
        j.payload ? JSON.stringify(j.payload) : null,
        j.manualRetry ? 1 : 0,
        j.nextAttemptAt ?? nowIso(),
        j.triggerAt ?? null,
        j.sourceSentAt ?? null,
        j.sourceReceivedAt ?? null,
        j.analyzedAt ?? null,
        nowIso(),
      ],
    );
    return r.changes > 0;
  }

  async claim(limit: number, leaseMs: number): Promise<DeliveryJob[]> {
    const token = newLeaseToken();
    const now = nowIso();
    await this.db.exec(
      `UPDATE delivery_jobs SET lease_token = ?, lease_until = ?, status = 'sending'
       WHERE id IN (
         SELECT id FROM delivery_jobs
         WHERE (status IN ('pending', 'retry') AND next_attempt_at <= ?)
            OR (status = 'sending' AND lease_until < ?)
         ORDER BY next_attempt_at, id LIMIT ?
       )`,
      [token, isoPlus(leaseMs), now, now, limit],
    );
    const rows = await this.db.query<JobRow>('SELECT * FROM delivery_jobs WHERE lease_token = ? ORDER BY next_attempt_at, id', [token]);
    return rows.map(rowToJob);
  }

  async get(id: number): Promise<DeliveryJob | null> {
    const r = await this.db.first<JobRow>('SELECT * FROM delivery_jobs WHERE id = ?', [id]);
    return r ? rowToJob(r) : null;
  }

  async finish(id: number, status: DeliveryStatus, reason: string | null): Promise<void> {
    await this.db.exec(
      `UPDATE delivery_jobs SET status = ?, status_reason = ?, lease_token = NULL, lease_until = NULL,
         sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END WHERE id = ?`,
      [status, reason, status, nowIso(), id],
    );
  }

  async partSent(id: number, partsSent: number): Promise<void> {
    await this.db.exec('UPDATE delivery_jobs SET parts_sent = ? WHERE id = ?', [partsSent, id]);
  }

  async scheduleRetry(id: number, retryAt: string, error: string, uncertain: boolean): Promise<void> {
    await this.db.exec(
      `UPDATE delivery_jobs SET status = 'retry', attempts = attempts + 1, next_attempt_at = ?, last_error = ?,
         uncertain = CASE WHEN ? = 1 THEN 1 ELSE uncertain END, lease_token = NULL, lease_until = NULL WHERE id = ?`,
      [retryAt, error.slice(0, 500), uncertain ? 1 : 0, id],
    );
  }

  async fail(id: number, status: DeliveryStatus, error: string): Promise<void> {
    await this.db.exec(
      `UPDATE delivery_jobs SET status = ?, attempts = attempts + 1, last_error = ?, status_reason = ?, lease_token = NULL, lease_until = NULL
       WHERE id = ?`,
      [status, error.slice(0, 500), error.slice(0, 200), id],
    );
  }

  async setPayload(id: number, payload: DeliveryPayload): Promise<void> {
    await this.db.exec('UPDATE delivery_jobs SET payload = ? WHERE id = ?', [JSON.stringify(payload), id]);
  }

  async logAttempt(a: Omit<DeliveryAttempt, 'id' | 'at'>): Promise<void> {
    await this.db.exec(
      `INSERT INTO delivery_attempts (job_id, at, part, ok, uncertain, http_status, error_code, error, telegram_message_id, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.jobId, nowIso(), a.part, a.ok ? 1 : 0, a.uncertain ? 1 : 0, a.httpStatus, a.errorCode, a.error?.slice(0, 500) ?? null, a.telegramMessageId, a.durationMs],
    );
  }

  async attempts(jobId: number): Promise<DeliveryAttempt[]> {
    const rows = await this.db.query<{
      id: number;
      job_id: number;
      at: string;
      part: number;
      ok: number;
      uncertain: number;
      http_status: number | null;
      error_code: string | null;
      error: string | null;
      telegram_message_id: number | null;
      duration_ms: number | null;
    }>('SELECT * FROM delivery_attempts WHERE job_id = ? ORDER BY id LIMIT 100', [jobId]);
    return rows.map((r) => ({
      id: r.id,
      jobId: r.job_id,
      at: r.at,
      part: r.part,
      ok: r.ok === 1,
      uncertain: r.uncertain === 1,
      httpStatus: r.http_status,
      errorCode: r.error_code,
      error: r.error,
      telegramMessageId: r.telegram_message_id,
      durationMs: r.duration_ms,
    }));
  }

  async list(f: DeliveryFilter): Promise<{ items: DeliveryJob[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      where.push(sql);
      params.push(v);
    };
    if (f.recipientId) add('recipient_id = ?', f.recipientId);
    if (f.kind) add('kind = ?', f.kind);
    if (f.status) add('status = ?', f.status);
    if (f.incidentId) add('incident_id = ?', f.incidentId);
    if (f.reportId) add('report_id = ?', f.reportId);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.db.query<JobRow>(`SELECT * FROM delivery_jobs ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, [
      ...params,
      Math.min(f.limit, 100),
      f.offset,
    ]);
    const total = await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM delivery_jobs ${w}`, params);
    return { items: rows.map(rowToJob), total: total?.n ?? 0 };
  }

  /** Получил ли получатель уведомление по инциденту (для проверки callback-оценки). */
  async wasSentToRecipient(incidentId: number, recipientId: number): Promise<boolean> {
    const r = await this.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM delivery_jobs WHERE incident_id = ? AND recipient_id = ? AND status = 'sent'
         AND kind IN ('alert', 'incident_update')`,
      [incidentId, recipientId],
    );
    return (r?.n ?? 0) > 0;
  }

  async hasAlertForIncident(incidentId: number, recipientId: number): Promise<boolean> {
    const r = await this.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM delivery_jobs WHERE incident_id = ? AND recipient_id = ? AND kind = 'alert'`,
      [incidentId, recipientId],
    );
    return (r?.n ?? 0) > 0;
  }

  async queueStats(): Promise<{ pending: number; failed: number; oldestPendingAt: string | null; uncertain: number }> {
    const r = await this.db.first<{ p: number | null; f: number | null; o: string | null; u: number | null }>(
      `SELECT SUM(CASE WHEN status IN ('pending', 'retry', 'sending') THEN 1 ELSE 0 END) AS p,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS f,
              MIN(CASE WHEN status IN ('pending', 'retry', 'sending') THEN created_at END) AS o,
              SUM(uncertain) AS u
       FROM delivery_jobs WHERE status IN ('pending', 'retry', 'sending', 'failed') OR uncertain = 1`,
    );
    return { pending: r?.p ?? 0, failed: r?.f ?? 0, oldestPendingAt: r?.o ?? null, uncertain: r?.u ?? 0 };
  }

  /** Задержки доставки алертов за окно, секунды. */
  async latencySince(iso: string): Promise<{
    alerts: number;
    avgTelegramToReceive: number | null;
    avgReceiveToAnalyze: number | null;
    avgReceiveToSent: number | null;
    maxReceiveToSent: number | null;
  }> {
    const r = await this.db.first<{ n: number; a: number | null; b: number | null; c: number | null; d: number | null }>(
      `SELECT COUNT(*) AS n,
              AVG((julianday(source_received_at) - julianday(source_sent_at)) * 86400) AS a,
              AVG((julianday(analyzed_at) - julianday(source_received_at)) * 86400) AS b,
              AVG((julianday(sent_at) - julianday(source_received_at)) * 86400) AS c,
              MAX((julianday(sent_at) - julianday(source_received_at)) * 86400) AS d
       FROM delivery_jobs WHERE kind = 'alert' AND status = 'sent' AND sent_at >= ? AND source_received_at IS NOT NULL`,
      [iso],
    );
    const round = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
    return {
      alerts: r?.n ?? 0,
      avgTelegramToReceive: round(r?.a ?? null),
      avgReceiveToAnalyze: round(r?.b ?? null),
      avgReceiveToSent: round(r?.c ?? null),
      maxReceiveToSent: round(r?.d ?? null),
    };
  }

  async summaryLatencySince(iso: string): Promise<{ reports: number; avgAfterBoundary: number | null; maxAfterBoundary: number | null }> {
    const r = await this.db.first<{ n: number; a: number | null; m: number | null }>(
      `SELECT COUNT(*) AS n, AVG((julianday(sent_at) - julianday(trigger_at)) * 86400) AS a,
              MAX((julianday(sent_at) - julianday(trigger_at)) * 86400) AS m
       FROM delivery_jobs WHERE kind = 'summary' AND status = 'sent' AND manual_retry = 0 AND sent_at >= ? AND trigger_at IS NOT NULL`,
      [iso],
    );
    return {
      reports: r?.n ?? 0,
      avgAfterBoundary: r?.a === null || r?.a === undefined ? null : Math.round(r.a),
      maxAfterBoundary: r?.m === null || r?.m === undefined ? null : Math.round(r.m),
    };
  }

  async countByStatusSince(iso: string): Promise<Array<{ status: string; n: number }>> {
    const rows = await this.db.query<{ status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM delivery_jobs WHERE created_at >= ? GROUP BY status',
      [iso],
    );
    return rows;
  }

  async cancelPendingForRecipient(recipientId: number, reason: string): Promise<number> {
    const r = await this.db.exec(
      `UPDATE delivery_jobs SET status = 'cancelled', status_reason = ?, lease_token = NULL, lease_until = NULL
       WHERE recipient_id = ? AND status IN ('pending', 'retry')`,
      [reason, recipientId],
    );
    return r.changes;
  }

  async deleteOlderThan(iso: string): Promise<number> {
    await this.db.exec(
      'DELETE FROM delivery_attempts WHERE id IN (SELECT a.id FROM delivery_attempts a JOIN delivery_jobs j ON j.id = a.job_id WHERE j.created_at < ? LIMIT 500)',
      [iso],
    );
    const r = await this.db.exec(
      `DELETE FROM delivery_jobs WHERE id IN (SELECT id FROM delivery_jobs WHERE created_at < ?
         AND status NOT IN ('pending', 'retry', 'sending') AND id NOT IN (SELECT job_id FROM delivery_attempts) LIMIT 500)`,
      [iso],
    );
    return r.changes;
  }
}
