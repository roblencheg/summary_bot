import type { Db } from '~server/platform';
import type { Incident, IncidentEvent, NewIncident, SpikeData } from '~server/models/incident';
import type { Message } from '~server/models/message';
import type { Category, IncidentStatus, Severity } from '~shared/domain';
import { MESSAGE_COLUMNS, rowToMessage, type MessageRow } from './message-repository';
import { nowIso, parseJson, placeholders } from './sql-utils';

interface IncidentRow {
  id: number;
  chat_id: number;
  kind: string;
  status: string;
  title: string;
  summary: string;
  topic: string | null;
  categories: string;
  severity: string;
  severity_reason: string | null;
  confidence: number;
  entities: string;
  author_key: string | null;
  author_name: string | null;
  affected_authors: number;
  message_count: number;
  repeat_type: string;
  first_message_at: string;
  last_message_at: string;
  borderline: number;
  resolution_confirmed: number;
  related_incident_id: number | null;
  analysis_version: string | null;
  spike_data: string | null;
  sources_deleted: number;
  last_alert_at: string | null;
  last_alert_severity: string | null;
  last_alert_categories: string | null;
  last_alert_authors: number | null;
  last_alert_message_count: number | null;
  pending_update: number;
  status_changed_by: string | null;
  status_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

const rowToIncident = (r: IncidentRow): Incident => ({
  id: r.id,
  chatId: r.chat_id,
  kind: r.kind as Incident['kind'],
  status: r.status as IncidentStatus,
  title: r.title,
  summary: r.summary,
  topic: r.topic,
  categories: parseJson<Category[]>(r.categories, []),
  severity: r.severity as Severity,
  severityReason: r.severity_reason,
  confidence: r.confidence,
  entities: parseJson<string[]>(r.entities, []),
  authorKey: r.author_key,
  authorName: r.author_name,
  affectedAuthors: r.affected_authors,
  messageCount: r.message_count,
  repeatType: r.repeat_type as Incident['repeatType'],
  firstMessageAt: r.first_message_at,
  lastMessageAt: r.last_message_at,
  borderline: r.borderline === 1,
  resolutionConfirmed: r.resolution_confirmed === 1,
  relatedIncidentId: r.related_incident_id,
  analysisVersion: r.analysis_version,
  spikeData: parseJson<SpikeData | null>(r.spike_data, null),
  sourcesDeleted: r.sources_deleted === 1,
  lastAlertAt: r.last_alert_at,
  lastAlertSeverity: r.last_alert_severity as Severity | null,
  lastAlertCategories: parseJson<Category[]>(r.last_alert_categories, []),
  lastAlertAuthors: r.last_alert_authors,
  lastAlertMessageCount: r.last_alert_message_count,
  pendingUpdate: r.pending_update === 1,
  statusChangedBy: r.status_changed_by,
  statusChangedAt: r.status_changed_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface IncidentFilter {
  chatId?: number;
  /** Ограничение по дирекциям руководителя; undefined — без ограничения. */
  chatIds?: number[];
  status?: IncidentStatus;
  minSeverity?: Severity;
  topic?: string;
  from?: string;
  to?: string;
  borderline?: boolean;
  kind?: 'problem' | 'spike';
  limit: number;
  offset: number;
}

export interface IncidentPatch {
  title?: string;
  summary?: string;
  topic?: string | null;
  categories?: Category[];
  severity?: Severity;
  severityReason?: string | null;
  confidence?: number;
  entities?: string[];
  repeatType?: Incident['repeatType'];
  borderline?: boolean;
  resolutionConfirmed?: boolean;
  analysisVersion?: string | null;
  spikeData?: SpikeData | null;
  pendingUpdate?: boolean;
}

const SEVERITY_ORDER_SQL = `CASE severity WHEN 'info' THEN 0 WHEN 'attention' THEN 1 WHEN 'high' THEN 2 WHEN 'critical' THEN 3 ELSE -1 END`;

export class IncidentRepository {
  constructor(private readonly db: Db) {}

  async create(n: NewIncident): Promise<number> {
    const now = nowIso();
    const res = await this.db.exec(
      `INSERT INTO incidents (chat_id, kind, title, summary, topic, categories, severity, severity_reason, confidence, entities,
         author_key, author_name, first_message_at, last_message_at, related_incident_id, analysis_version, spike_data,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        n.chatId,
        n.kind,
        n.title,
        n.summary,
        n.topic,
        JSON.stringify(n.categories),
        n.severity,
        n.severityReason,
        n.confidence,
        JSON.stringify(n.entities),
        n.authorKey,
        n.authorName,
        n.firstMessageAt,
        n.lastMessageAt,
        n.relatedIncidentId,
        n.analysisVersion,
        n.spikeData ? JSON.stringify(n.spikeData) : null,
        now,
        now,
      ],
    );
    if (!res.changes || !res.lastInsertRowid) throw new Error('IncidentRepository.create: insert failed');
    return res.lastInsertRowid;
  }

  async get(id: number): Promise<Incident | null> {
    const r = await this.db.first<IncidentRow>('SELECT * FROM incidents WHERE id = ?', [id]);
    return r ? rowToIncident(r) : null;
  }

  async getMany(ids: number[]): Promise<Incident[]> {
    if (!ids.length) return [];
    const rows = await this.db.query<IncidentRow>(`SELECT * FROM incidents WHERE id IN (${placeholders(ids.length)})`, ids);
    return rows.map(rowToIncident);
  }

  /** Открытые проблемные инциденты чата — кандидаты на объединение. */
  async openForChat(chatId: number, sinceIso: string, limit: number): Promise<Incident[]> {
    const rows = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE chat_id = ? AND kind = 'problem' AND status IN ('new', 'seen') AND last_message_at >= ?
       ORDER BY last_message_at DESC LIMIT ?`,
      [chatId, sinceIso, limit],
    );
    return rows.map(rowToIncident);
  }

  async recentSpike(chatId: number, sinceIso: string): Promise<Incident | null> {
    const r = await this.db.first<IncidentRow>(
      `SELECT * FROM incidents WHERE chat_id = ? AND kind = 'spike' AND status IN ('new', 'seen') AND last_message_at >= ?
       ORDER BY id DESC LIMIT 1`,
      [chatId, sinceIso],
    );
    return r ? rowToIncident(r) : null;
  }

  /** Открытый инцидент, в который уже входит сообщение этого обращения. */
  async openForRequestKey(chatId: number, requestKey: string): Promise<Incident | null> {
    const r = await this.db.first<IncidentRow>(
      `SELECT i.* FROM incidents i JOIN incident_messages im ON im.incident_id = i.id JOIN messages m ON m.id = im.message_pk
       WHERE i.chat_id = ? AND i.kind = 'problem' AND i.status IN ('new', 'seen') AND m.chat_id = ? AND m.request_key = ?
       ORDER BY i.id DESC LIMIT 1`,
      [chatId, chatId, requestKey],
    );
    return r ? rowToIncident(r) : null;
  }

  async addMessages(incidentId: number, messagePks: number[]): Promise<number> {
    if (!messagePks.length) return 0;
    const now = nowIso();
    const r = await this.db.exec(
      `INSERT INTO incident_messages (incident_id, message_pk, added_at) VALUES ${messagePks.map(() => '(?, ?, ?)').join(', ')}
       ON CONFLICT DO NOTHING`,
      messagePks.flatMap((pk) => [incidentId, pk, now]),
    );
    return r.changes;
  }

  /** Счётчики инцидента — агрегатом по связанным сообщениям. */
  async recomputeCounters(incidentId: number): Promise<void> {
    await this.db.exec(
      `UPDATE incidents SET
         message_count = (SELECT COUNT(*) FROM incident_messages im WHERE im.incident_id = incidents.id),
         affected_authors = MAX(1, (SELECT COUNT(DISTINCT COALESCE(m.author_key, 'm' || m.id)) FROM incident_messages im
                              JOIN messages m ON m.id = im.message_pk WHERE im.incident_id = incidents.id AND m.is_staff = 0)),
         first_message_at = COALESCE((SELECT MIN(m.sent_at) FROM incident_messages im JOIN messages m ON m.id = im.message_pk
                              WHERE im.incident_id = incidents.id), first_message_at),
         last_message_at = COALESCE((SELECT MAX(m.sent_at) FROM incident_messages im JOIN messages m ON m.id = im.message_pk
                              WHERE im.incident_id = incidents.id), last_message_at),
         updated_at = ?
       WHERE id = ?`,
      [nowIso(), incidentId],
    );
  }

  /** Связанные сообщения и авторы инцидента в окне [from, to). */
  async windowCounts(incidentId: number, from: string, to: string): Promise<{ messages: number; authors: number }> {
    const r = await this.db.first<{ n: number; a: number }>(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT m.author_key) AS a FROM incident_messages im JOIN messages m ON m.id = im.message_pk
       WHERE im.incident_id = ? AND m.sent_at >= ? AND m.sent_at < ? AND m.is_staff = 0`,
      [incidentId, from, to],
    );
    return { messages: r?.n ?? 0, authors: r?.a ?? 0 };
  }

  /** Было ли у автора в этом инциденте ДРУГОЕ обращение за окно — повтор по нерешённой проблеме. */
  async authorHadEarlierRequest(incidentId: number, authorKey: string, sinceIso: string, beforeIso: string, requestKey: string | null): Promise<boolean> {
    const r = await this.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM incident_messages im JOIN messages m ON m.id = im.message_pk
       WHERE im.incident_id = ? AND m.author_key = ? AND m.sent_at >= ? AND m.sent_at < ?
         AND (? IS NULL OR m.request_key IS NULL OR m.request_key <> ?)`,
      [incidentId, authorKey, sinceIso, beforeIso, requestKey, requestKey],
    );
    return (r?.n ?? 0) > 0;
  }

  async update(id: number, p: IncidentPatch): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      sets.push(`${col} = ?`);
      params.push(v);
    };
    if (p.title !== undefined) add('title', p.title);
    if (p.summary !== undefined) add('summary', p.summary);
    if (p.topic !== undefined) add('topic', p.topic);
    if (p.categories !== undefined) add('categories', JSON.stringify(p.categories));
    if (p.severity !== undefined) add('severity', p.severity);
    if (p.severityReason !== undefined) add('severity_reason', p.severityReason);
    if (p.confidence !== undefined) add('confidence', p.confidence);
    if (p.entities !== undefined) add('entities', JSON.stringify(p.entities));
    if (p.repeatType !== undefined) add('repeat_type', p.repeatType);
    if (p.borderline !== undefined) add('borderline', p.borderline ? 1 : 0);
    if (p.resolutionConfirmed !== undefined) add('resolution_confirmed', p.resolutionConfirmed ? 1 : 0);
    if (p.analysisVersion !== undefined) add('analysis_version', p.analysisVersion);
    if (p.spikeData !== undefined) add('spike_data', p.spikeData ? JSON.stringify(p.spikeData) : null);
    if (p.pendingUpdate !== undefined) add('pending_update', p.pendingUpdate ? 1 : 0);
    if (!sets.length) return;
    add('updated_at', nowIso());
    await this.db.exec(`UPDATE incidents SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  async setSpikeWindow(id: number, lastMessageAt: string, messageCount: number, authors: number): Promise<void> {
    await this.db.exec('UPDATE incidents SET last_message_at = ?, message_count = ?, affected_authors = ?, updated_at = ? WHERE id = ?', [
      lastMessageAt,
      messageCount,
      authors,
      nowIso(),
      id,
    ]);
  }

  async markAlerted(i: Incident): Promise<void> {
    await this.db.exec(
      `UPDATE incidents SET last_alert_at = ?, last_alert_severity = ?, last_alert_categories = ?, last_alert_authors = ?,
         last_alert_message_count = ?, pending_update = 0, updated_at = ? WHERE id = ?`,
      [nowIso(), i.severity, JSON.stringify(i.categories), i.affectedAuthors, i.messageCount, nowIso(), i.id],
    );
  }

  async listPendingUpdates(): Promise<Incident[]> {
    const rows = await this.db.query<IncidentRow>(
      "SELECT * FROM incidents WHERE pending_update = 1 AND status IN ('new', 'seen') ORDER BY last_alert_at LIMIT 100",
    );
    return rows.map(rowToIncident);
  }

  async setStatus(id: number, status: IncidentStatus, actor: string): Promise<void> {
    await this.db.exec(
      'UPDATE incidents SET status = ?, status_changed_by = ?, status_changed_at = ?, pending_update = 0, updated_at = ? WHERE id = ?',
      [status, actor, nowIso(), nowIso(), id],
    );
  }

  private filterSql(f: IncidentFilter): { where: string; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.chatId !== undefined) {
      where.push('chat_id = ?');
      params.push(f.chatId);
    }
    if (f.chatIds) {
      where.push(f.chatIds.length ? `chat_id IN (${placeholders(f.chatIds.length)})` : '0');
      params.push(...f.chatIds);
    }
    if (f.status) {
      where.push('status = ?');
      params.push(f.status);
    }
    if (f.minSeverity) {
      where.push(`${SEVERITY_ORDER_SQL} >= ${SEVERITY_ORDER_SQL.replace('severity', '?')}`);
      params.push(f.minSeverity);
    }
    if (f.topic) {
      where.push('topic = ?');
      params.push(f.topic);
    }
    if (f.from) {
      where.push('last_message_at >= ?');
      params.push(f.from);
    }
    if (f.to) {
      where.push('first_message_at < ?');
      params.push(f.to);
    }
    if (f.borderline !== undefined) {
      where.push('borderline = ?');
      params.push(f.borderline ? 1 : 0);
    }
    if (f.kind) {
      where.push('kind = ?');
      params.push(f.kind);
    }
    return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  async list(f: IncidentFilter): Promise<{ items: Incident[]; total: number }> {
    const { where, params } = this.filterSql(f);
    const rows = await this.db.query<IncidentRow>(`SELECT * FROM incidents ${where} ORDER BY last_message_at DESC LIMIT ? OFFSET ?`, [
      ...params,
      Math.min(f.limit, 100),
      f.offset,
    ]);
    const total = await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM incidents ${where}`, params);
    return { items: rows.map(rowToIncident), total: total?.n ?? 0 };
  }

  async topics(): Promise<string[]> {
    const rows = await this.db.query<{ topic: string }>(
      'SELECT DISTINCT topic FROM incidents WHERE topic IS NOT NULL ORDER BY topic LIMIT 100',
    );
    return rows.map((r) => r.topic);
  }

  /** Инциденты чата, активные в периоде (для саммари). */
  async activeInPeriod(chatId: number, from: string, to: string): Promise<Incident[]> {
    const rows = await this.db.query<IncidentRow>(
      `SELECT * FROM incidents WHERE chat_id = ? AND status <> 'false_positive' AND borderline = 0
         AND last_message_at >= ? AND first_message_at < ?
       ORDER BY ${SEVERITY_ORDER_SQL} DESC, message_count DESC LIMIT 30`,
      [chatId, from, to],
    );
    return rows.map(rowToIncident);
  }

  async countActive(chatIds?: number[]): Promise<{ open: number; newCount: number; borderline: number }> {
    const w = chatIds ? (chatIds.length ? `WHERE chat_id IN (${placeholders(chatIds.length)})` : 'WHERE 0') : '';
    const r = await this.db.first<{ open: number | null; n: number | null; b: number | null }>(
      `SELECT SUM(CASE WHEN status IN ('new', 'seen') AND borderline = 0 THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN status = 'new' AND borderline = 0 THEN 1 ELSE 0 END) AS n,
              SUM(CASE WHEN borderline = 1 AND status IN ('new', 'seen') THEN 1 ELSE 0 END) AS b
       FROM incidents ${w}`,
      chatIds ?? [],
    );
    return { open: r?.open ?? 0, newCount: r?.n ?? 0, borderline: r?.b ?? 0 };
  }

  async countCreatedSince(iso: string, chatIds?: number[]): Promise<{ incidents: number; repeats: number; spikes: number }> {
    const w = chatIds ? (chatIds.length ? ` AND chat_id IN (${placeholders(chatIds.length)})` : ' AND 0') : '';
    const r = await this.db.first<{ n: number; r: number | null; s: number | null }>(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN repeat_type <> 'single' THEN 1 ELSE 0 END) AS r,
              SUM(CASE WHEN kind = 'spike' THEN 1 ELSE 0 END) AS s
       FROM incidents WHERE created_at >= ? AND borderline = 0${w}`,
      [iso, ...(chatIds ?? [])],
    );
    return { incidents: r?.n ?? 0, repeats: r?.r ?? 0, spikes: r?.s ?? 0 };
  }

  // --- сообщения и события ---

  async messages(incidentId: number, limit: number, offset: number): Promise<Message[]> {
    const cols = MESSAGE_COLUMNS.split(',').map((c) => `m.${c.trim()}`).join(', ');
    const rows = await this.db.query<MessageRow>(
      `SELECT ${cols} FROM incident_messages im JOIN messages m ON m.id = im.message_pk
       WHERE im.incident_id = ? ORDER BY m.sent_at, m.id LIMIT ? OFFSET ?`,
      [incidentId, Math.min(limit, 100), offset],
    );
    return rows.map(rowToMessage);
  }

  /**
   * Первый источник и признак ответа поддержки по инциденту одним запросом.
   * «Отвечала» — сообщение сотрудника чата в ответ (reply) на сообщение инцидента или после его первого сообщения.
   */
  async facts(incidentId: number): Promise<{ link: string | null; staffReplied: boolean } | null> {
    const r = await this.db.first<{ link: string | null; staff_replied: number }>(
      `SELECT
         (SELECT m.link FROM incident_messages im JOIN messages m ON m.id = im.message_pk
            WHERE im.incident_id = i.id ORDER BY m.sent_at, m.id LIMIT 1) AS link,
         CASE WHEN EXISTS (
           SELECT 1 FROM messages s WHERE s.chat_id = i.chat_id AND s.is_staff = 1 AND (
             s.sent_at > i.first_message_at
             OR s.reply_to_message_id IN (SELECT m.message_id FROM incident_messages im JOIN messages m ON m.id = im.message_pk WHERE im.incident_id = i.id)
           )
         ) THEN 1 ELSE 0 END AS staff_replied
       FROM incidents i WHERE i.id = ?`,
      [incidentId],
    );
    return r ? { link: r.link, staffReplied: r.staff_replied === 1 } : null;
  }

  async addEvent(incidentId: number, kind: string, details: Record<string, unknown> | null, actor: string | null): Promise<void> {
    await this.db.exec('INSERT INTO incident_events (incident_id, at, kind, details, actor) VALUES (?, ?, ?, ?, ?)', [
      incidentId,
      nowIso(),
      kind,
      details ? JSON.stringify(details) : null,
      actor,
    ]);
  }

  async events(incidentId: number): Promise<IncidentEvent[]> {
    const rows = await this.db.query<{ id: number; incident_id: number; at: string; kind: string; details: string | null; actor: string | null }>(
      'SELECT * FROM incident_events WHERE incident_id = ? ORDER BY id DESC LIMIT 100',
      [incidentId],
    );
    return rows.map((r) => ({
      id: r.id,
      incidentId: r.incident_id,
      at: r.at,
      kind: r.kind,
      details: parseJson<Record<string, unknown> | null>(r.details, null),
      actor: r.actor,
    }));
  }

  // --- обратная связь ---

  async saveFeedback(incidentId: number, recipientId: number, verdict: 'useful' | 'false', analysisVersion: string | null): Promise<void> {
    await this.db.exec(
      `INSERT INTO feedback (incident_id, recipient_id, verdict, analysis_version, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(incident_id, recipient_id) DO UPDATE SET verdict = excluded.verdict, analysis_version = excluded.analysis_version,
         created_at = excluded.created_at`,
      [incidentId, recipientId, verdict, analysisVersion, nowIso()],
    );
  }

  async feedbackFor(incidentId: number): Promise<Array<{ recipientId: number; verdict: string; analysisVersion: string | null; createdAt: string }>> {
    const rows = await this.db.query<{ recipient_id: number; verdict: string; analysis_version: string | null; created_at: string }>(
      'SELECT recipient_id, verdict, analysis_version, created_at FROM feedback WHERE incident_id = ? ORDER BY id LIMIT 100',
      [incidentId],
    );
    return rows.map((r) => ({ recipientId: r.recipient_id, verdict: r.verdict, analysisVersion: r.analysis_version, createdAt: r.created_at }));
  }

  async feedbackStats(sinceIso: string): Promise<{ useful: number; falsePositive: number }> {
    const r = await this.db.first<{ u: number | null; f: number | null }>(
      `SELECT SUM(CASE WHEN verdict = 'useful' THEN 1 ELSE 0 END) AS u, SUM(CASE WHEN verdict = 'false' THEN 1 ELSE 0 END) AS f
       FROM feedback WHERE created_at >= ?`,
      [sinceIso],
    );
    return { useful: r?.u ?? 0, falsePositive: r?.f ?? 0 };
  }

  // --- хранение ---
  async deleteOlderThan(iso: string): Promise<number> {
    await this.db.exec(
      'DELETE FROM incident_events WHERE id IN (SELECT e.id FROM incident_events e JOIN incidents i ON i.id = e.incident_id WHERE i.last_message_at < ? LIMIT 500)',
      [iso],
    );
    await this.db.exec(
      'DELETE FROM feedback WHERE id IN (SELECT f.id FROM feedback f JOIN incidents i ON i.id = f.incident_id WHERE i.last_message_at < ? LIMIT 500)',
      [iso],
    );
    await this.db.exec(
      'DELETE FROM incident_messages WHERE rowid IN (SELECT im.rowid FROM incident_messages im JOIN incidents i ON i.id = im.incident_id WHERE i.last_message_at < ? LIMIT 500)',
      [iso],
    );
    const r = await this.db.exec(
      `DELETE FROM incidents WHERE id IN (SELECT id FROM incidents WHERE last_message_at < ?
         AND id NOT IN (SELECT incident_id FROM incident_events) LIMIT 500)`,
      [iso],
    );
    return r.changes;
  }
}
