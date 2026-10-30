import type { Db } from '~server/platform';
import type { IncomingMessage, Message, MessageAnalysisUpdate } from '~server/models/message';
import type { Category, Severity, Tone } from '~shared/domain';
import { isoPlus, newLeaseToken, nowIso, parseJson, placeholders } from './sql-utils';

export interface MessageRow {
  id: number;
  chat_id: number;
  message_id: number;
  sent_at: string;
  received_at: string;
  author_key: string | null;
  author_id: number | null;
  author_name: string;
  author_username: string | null;
  sender_chat_id: number | null;
  identity_limited: number;
  is_staff: number;
  text: string;
  content_type: string;
  has_text: number;
  reply_to_message_id: number | null;
  thread_id: number | null;
  edited_at: string | null;
  revision_count: number;
  link: string | null;
  analysis_status: string;
  analysis_attempts: number;
  analysis_error: string | null;
  analyzed_at: string | null;
  analysis_id: number | null;
  is_request: number | null;
  request_key: string | null;
  topic: string | null;
  tone: string | null;
  categories: string | null;
  severity: string | null;
  confidence: number | null;
  summary: string | null;
  resolution_confirmed: number;
}

export const MESSAGE_COLUMNS = `id, chat_id, message_id, sent_at, received_at, author_key, author_id, author_name, author_username,
  sender_chat_id, identity_limited, is_staff, text, content_type, has_text, reply_to_message_id, thread_id, edited_at,
  revision_count, link, analysis_status, analysis_attempts, analysis_error, analyzed_at, analysis_id, is_request,
  request_key, topic, tone, categories, severity, confidence, summary, resolution_confirmed`;

export const rowToMessage = (r: MessageRow): Message => ({
  id: r.id,
  chatId: r.chat_id,
  messageId: r.message_id,
  sentAt: r.sent_at,
  receivedAt: r.received_at,
  authorKey: r.author_key,
  authorId: r.author_id,
  authorName: r.author_name,
  authorUsername: r.author_username,
  senderChatId: r.sender_chat_id,
  identityLimited: r.identity_limited === 1,
  isStaff: r.is_staff === 1,
  text: r.text,
  contentType: r.content_type,
  hasText: r.has_text === 1,
  replyToMessageId: r.reply_to_message_id,
  threadId: r.thread_id,
  editedAt: r.edited_at,
  revisionCount: r.revision_count,
  link: r.link,
  analysisStatus: r.analysis_status,
  analysisAttempts: r.analysis_attempts,
  analysisError: r.analysis_error,
  analyzedAt: r.analyzed_at,
  analysisId: r.analysis_id,
  isRequest: r.is_request === null ? null : r.is_request === 1,
  requestKey: r.request_key,
  topic: r.topic,
  tone: r.tone as Tone | null,
  categories: parseJson<Category[]>(r.categories, []),
  severity: r.severity as Severity | 'none' | null,
  confidence: r.confidence,
  summary: r.summary,
  resolutionConfirmed: r.resolution_confirmed === 1,
});

export class MessageRepository {
  constructor(private readonly db: Db) {}

  /** true — сообщение новое; false — повторная доставка (ключ chat_id + message_id). */
  async insert(m: IncomingMessage, isStaff: boolean): Promise<boolean> {
    const r = await this.db.exec(
      `INSERT INTO messages (chat_id, message_id, sent_at, received_at, author_key, author_id, author_name, author_username,
         sender_chat_id, identity_limited, is_staff, text, content_type, has_text, reply_to_message_id, thread_id, link,
         analysis_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, message_id) DO NOTHING`,
      [
        m.chatId,
        m.messageId,
        m.sentAt,
        m.receivedAt,
        m.authorKey,
        m.authorId,
        m.authorName,
        m.authorUsername,
        m.senderChatId,
        m.identityLimited ? 1 : 0,
        isStaff ? 1 : 0,
        m.text,
        m.contentType,
        m.hasText ? 1 : 0,
        m.replyToMessageId,
        m.threadId,
        m.link,
        m.hasText ? 'pending' : 'skipped',
      ],
    );
    return r.changes > 0;
  }

  async findByChatMessage(chatId: number, messageId: number): Promise<Message | null> {
    const r = await this.db.first<MessageRow>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? AND message_id = ?`, [
      chatId,
      messageId,
    ]);
    return r ? rowToMessage(r) : null;
  }

  async getByIds(ids: number[]): Promise<Message[]> {
    if (!ids.length) return [];
    const out: Message[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const rows = await this.db.query<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id IN (${placeholders(chunk.length)})`,
        chunk,
      );
      out.push(...rows.map(rowToMessage));
    }
    return out;
  }

  async getByChatMessageIds(chatId: number, messageIds: number[]): Promise<Message[]> {
    if (!messageIds.length) return [];
    const rows = await this.db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? AND message_id IN (${placeholders(messageIds.length)})`,
      [chatId, ...messageIds.slice(0, 99)],
    );
    return rows.map(rowToMessage);
  }

  async applyEdit(pk: number, newText: string, editedAt: string, reanalyze: boolean): Promise<void> {
    await this.db.exec(
      `UPDATE messages SET text = ?, edited_at = ?, revision_count = revision_count + 1, has_text = ?,
         analysis_status = CASE WHEN ? = 1 AND ? = 1 THEN 'pending' ELSE analysis_status END,
         analysis_attempts = CASE WHEN ? = 1 THEN 0 ELSE analysis_attempts END
       WHERE id = ?`,
      [newText, editedAt, newText ? 1 : 0, reanalyze ? 1 : 0, newText ? 1 : 0, reanalyze ? 1 : 0, pk],
    );
  }

  async insertRevision(pk: number, editedAt: string, oldText: string, newText: string, significant: boolean): Promise<void> {
    await this.db.exec(
      'INSERT INTO message_revisions (message_pk, edited_at, received_at, old_text, new_text, significant) VALUES (?, ?, ?, ?, ?, ?)',
      [pk, editedAt, nowIso(), oldText, newText, significant ? 1 : 0],
    );
  }

  async listRevisions(pk: number): Promise<Array<{ editedAt: string; oldText: string; newText: string; significant: boolean }>> {
    const rows = await this.db.query<{ edited_at: string; old_text: string; new_text: string; significant: number }>(
      'SELECT edited_at, old_text, new_text, significant FROM message_revisions WHERE message_pk = ? ORDER BY id LIMIT 100',
      [pk],
    );
    return rows.map((r) => ({ editedAt: r.edited_at, oldText: r.old_text, newText: r.new_text, significant: r.significant === 1 }));
  }

  async upsertParticipant(p: {
    authorKey: string;
    telegramUserId: number | null;
    senderChatId: number | null;
    displayName: string;
    username: string | null;
    seenAt: string;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO participants (author_key, telegram_user_id, sender_chat_id, display_name, username, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(author_key) DO UPDATE SET display_name = excluded.display_name, username = excluded.username,
         last_seen_at = excluded.last_seen_at`,
      [p.authorKey, p.telegramUserId, p.senderChatId, p.displayName, p.username, p.seenAt, p.seenAt],
    );
  }

  // --- очередь анализа ---

  async pendingChats(): Promise<Array<{ chatId: number; oldestReceivedAt: string; n: number }>> {
    const rows = await this.db.query<{ chat_id: number; oldest: string; n: number }>(
      `SELECT chat_id, MIN(received_at) AS oldest, COUNT(*) AS n FROM messages
       WHERE analysis_status = 'pending' AND (lease_until IS NULL OR lease_until < ?)
       GROUP BY chat_id ORDER BY oldest LIMIT 20`,
      [nowIso()],
    );
    return rows.map((r) => ({ chatId: r.chat_id, oldestReceivedAt: r.oldest, n: r.n }));
  }

  async claimForAnalysis(chatId: number, limit: number, leaseMs: number): Promise<Message[]> {
    const token = newLeaseToken();
    await this.db.exec(
      `UPDATE messages SET lease_token = ?, lease_until = ?
       WHERE id IN (
         SELECT id FROM messages WHERE chat_id = ? AND analysis_status = 'pending' AND (lease_until IS NULL OR lease_until < ?)
         ORDER BY sent_at, id LIMIT ?
       )`,
      [token, isoPlus(leaseMs), chatId, nowIso(), limit],
    );
    const rows = await this.db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE lease_token = ? ORDER BY sent_at, id`,
      [token],
    );
    return rows.map(rowToMessage);
  }

  /** Контекст: предыдущие сообщения чата до первого сообщения пакета. */
  async contextBefore(chatId: number, beforeSentAt: string, sinceIso: string, limit: number): Promise<Message[]> {
    const rows = await this.db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages
       WHERE chat_id = ? AND sent_at < ? AND sent_at >= ? AND has_text = 1
       ORDER BY sent_at DESC, id DESC LIMIT ?`,
      [chatId, beforeSentAt, sinceIso, Math.min(limit, 100)],
    );
    return rows.map(rowToMessage).reverse();
  }

  async saveAnalysis(pk: number, u: MessageAnalysisUpdate): Promise<void> {
    await this.db.exec(
      `UPDATE messages SET analysis_status = 'done', analyzed_at = ?, analysis_id = ?, is_request = ?, request_key = ?, topic = ?,
         tone = ?, categories = ?, severity = ?, confidence = ?, summary = ?, resolution_confirmed = ?, answers_message_ids = ?,
         analysis_error = NULL, lease_token = NULL, lease_until = NULL
       WHERE id = ?`,
      [
        nowIso(),
        u.analysisId,
        u.isRequest ? 1 : 0,
        u.requestKey,
        u.topic,
        u.tone,
        JSON.stringify(u.categories),
        u.severity,
        u.confidence,
        u.summary,
        u.resolutionConfirmed ? 1 : 0,
        JSON.stringify(u.answersMessageIds),
        pk,
      ],
    );
  }

  /** Невалидный ответ модели: считаем попытку; после лимита — failed. */
  async markAnalysisError(ids: number[], error: string, maxAttempts: number, retryInMs: number): Promise<void> {
    if (!ids.length) return;
    await this.db.exec(
      `UPDATE messages SET analysis_attempts = analysis_attempts + 1, analysis_error = ?,
         analysis_status = CASE WHEN analysis_attempts + 1 >= ? THEN 'failed' ELSE 'pending' END,
         lease_token = NULL, lease_until = ?
       WHERE id IN (${placeholders(ids.length)})`,
      [error.slice(0, 500), maxAttempts, isoPlus(retryInMs), ...ids],
    );
  }

  /** AI недоступен: попытку не считаем, просто откладываем пакет. */
  async postpone(ids: number[], error: string, retryInMs: number): Promise<void> {
    if (!ids.length) return;
    await this.db.exec(
      `UPDATE messages SET analysis_error = ?, lease_token = NULL, lease_until = ? WHERE id IN (${placeholders(ids.length)})`,
      [error.slice(0, 500), isoPlus(retryInMs), ...ids],
    );
  }

  async requeueFailed(chatId: number | null): Promise<number> {
    const r = await this.db.exec(
      `UPDATE messages SET analysis_status = 'pending', analysis_attempts = 0, lease_until = NULL
       WHERE analysis_status = 'failed' AND (? IS NULL OR chat_id = ?)`,
      [chatId, chatId],
    );
    return r.changes;
  }

  async backlog(): Promise<{ pending: number; failed: number; oldestPendingAt: string | null }> {
    const r = await this.db.first<{ pending: number | null; failed: number | null; oldest: string | null }>(
      `SELECT SUM(CASE WHEN analysis_status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN analysis_status = 'failed' THEN 1 ELSE 0 END) AS failed,
              MIN(CASE WHEN analysis_status = 'pending' THEN received_at END) AS oldest
       FROM messages WHERE analysis_status IN ('pending', 'failed')`,
    );
    return { pending: r?.pending ?? 0, failed: r?.failed ?? 0, oldestPendingAt: r?.oldest ?? null };
  }

  async pendingInRange(chatId: number, from: string, to: string): Promise<number> {
    const r = await this.db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND sent_at >= ? AND sent_at < ? AND analysis_status = 'pending'`,
      [chatId, from, to],
    );
    return r?.n ?? 0;
  }

  // --- всплески ---

  async windowStats(chatId: number, from: string, to: string): Promise<{ count: number; authors: number; unanalyzed: number }> {
    const r = await this.db.first<{ n: number; a: number; u: number | null }>(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT author_key) AS a,
              SUM(CASE WHEN analysis_status IN ('pending', 'failed') THEN 1 ELSE 0 END) AS u
       FROM messages WHERE chat_id = ? AND sent_at >= ? AND sent_at < ?`,
      [chatId, from, to],
    );
    return { count: r?.n ?? 0, authors: r?.a ?? 0, unanalyzed: r?.u ?? 0 };
  }

  /** Сумма сообщений в наборе интервалов (сопоставимое время прошлых дней). */
  async countInRanges(chatId: number, ranges: Array<{ from: string; to: string }>): Promise<number> {
    if (!ranges.length) return 0;
    const cond = ranges.map(() => '(sent_at >= ? AND sent_at < ?)').join(' OR ');
    const r = await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND (${cond})`, [
      chatId,
      ...ranges.flatMap((x) => [x.from, x.to]),
    ]);
    return r?.n ?? 0;
  }

  async windowTopicsAndTones(
    chatId: number,
    from: string,
    to: string,
  ): Promise<{ topics: Array<{ topic: string; count: number }>; tones: Array<{ tone: string; count: number }> }> {
    const topics = await this.db.query<{ topic: string; n: number }>(
      `SELECT topic, COUNT(*) AS n FROM messages WHERE chat_id = ? AND sent_at >= ? AND sent_at < ? AND topic IS NOT NULL
       GROUP BY topic ORDER BY n DESC LIMIT 5`,
      [chatId, from, to],
    );
    const tones = await this.db.query<{ tone: string; n: number }>(
      `SELECT tone, COUNT(*) AS n FROM messages WHERE chat_id = ? AND sent_at >= ? AND sent_at < ? AND tone IS NOT NULL
       GROUP BY tone ORDER BY n DESC`,
      [chatId, from, to],
    );
    return { topics: topics.map((t) => ({ topic: t.topic, count: t.n })), tones: tones.map((t) => ({ tone: t.tone, count: t.n })) };
  }

  // --- просмотр ---

  async listByChat(
    chatId: number,
    f: { from?: string; to?: string; limit: number; offset: number },
  ): Promise<Message[]> {
    const rows = await this.db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_id = ? AND (? IS NULL OR sent_at >= ?) AND (? IS NULL OR sent_at < ?)
       ORDER BY sent_at DESC, id DESC LIMIT ? OFFSET ?`,
      [chatId, f.from ?? null, f.from ?? null, f.to ?? null, f.to ?? null, Math.min(f.limit, 100), f.offset],
    );
    return rows.map(rowToMessage);
  }

  async listAnalysisFailed(limit: number): Promise<Message[]> {
    const rows = await this.db.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE analysis_status = 'failed' ORDER BY received_at DESC LIMIT ?`,
      [Math.min(limit, 100)],
    );
    return rows.map(rowToMessage);
  }

  // --- хранение ---

  async deleteRevisionsOlderThan(iso: string): Promise<number> {
    const r = await this.db.exec(
      `DELETE FROM message_revisions WHERE id IN (
         SELECT r.id FROM message_revisions r JOIN messages m ON m.id = r.message_pk WHERE m.sent_at < ? LIMIT 500)`,
      [iso],
    );
    return r.changes;
  }

  async deleteAnalysisOlderThan(iso: string): Promise<number> {
    const r = await this.db.exec(
      `DELETE FROM analysis_results WHERE id IN (
         SELECT a.id FROM analysis_results a JOIN messages m ON m.id = a.message_pk WHERE m.sent_at < ? LIMIT 500)`,
      [iso],
    );
    return r.changes;
  }

  async deleteIncidentLinksOlderThan(iso: string): Promise<number> {
    await this.db.exec(
      `UPDATE incidents SET sources_deleted = 1 WHERE sources_deleted = 0 AND id IN (
         SELECT im.incident_id FROM incident_messages im JOIN messages m ON m.id = im.message_pk WHERE m.sent_at < ?)`,
      [iso],
    );
    const r = await this.db.exec(
      `DELETE FROM incident_messages WHERE rowid IN (
         SELECT im.rowid FROM incident_messages im JOIN messages m ON m.id = im.message_pk WHERE m.sent_at < ? LIMIT 500)`,
      [iso],
    );
    return r.changes;
  }

  async deleteOlderThan(iso: string): Promise<number> {
    const r = await this.db.exec('DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE sent_at < ? LIMIT 500)', [iso]);
    return r.changes;
  }

  async deleteOrphanParticipants(iso: string): Promise<number> {
    const r = await this.db.exec(
      'DELETE FROM participants WHERE author_key IN (SELECT author_key FROM participants WHERE last_seen_at < ? LIMIT 500)',
      [iso],
    );
    return r.changes;
  }
}
