import type { Db } from '~server/platform';
import type { Recipient } from '~server/models/recipient';
import type { Category, Channel, RecipientStatus, Severity } from '~shared/domain';
import { nowIso, parseJson } from './sql-utils';

interface RecipientRow {
  id: number;
  name: string;
  telegram_user_id: number | null;
  telegram_username: string | null;
  status: string;
  max_user_id: number | null;
  max_username: string | null;
  max_status: string;
  max_activated_at: string | null;
  max_blocked_at: string | null;
  is_tech_admin: number;
  summary_day: number;
  summary_night: number;
  alert_categories: string;
  alert_min_severity: string;
  activated_at: string | null;
  blocked_at: string | null;
  last_delivery_at: string | null;
  last_delivery_status: string | null;
  created_at: string;
  updated_at: string;
}

const rowToRecipient = (r: RecipientRow): Recipient => ({
  id: r.id,
  name: r.name,
  telegramUserId: r.telegram_user_id,
  telegramUsername: r.telegram_username,
  status: r.status as RecipientStatus,
  maxUserId: r.max_user_id,
  maxUsername: r.max_username,
  maxStatus: r.max_status as RecipientStatus,
  maxActivatedAt: r.max_activated_at,
  maxBlockedAt: r.max_blocked_at,
  isTechAdmin: r.is_tech_admin === 1,
  summaryDay: r.summary_day === 1,
  summaryNight: r.summary_night === 1,
  alertCategories: parseJson<Category[]>(r.alert_categories, []),
  alertMinSeverity: r.alert_min_severity as Severity,
  activatedAt: r.activated_at,
  blockedAt: r.blocked_at,
  lastDeliveryAt: r.last_delivery_at,
  lastDeliveryStatus: r.last_delivery_status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface RecipientPatch {
  name?: string;
  isTechAdmin?: boolean;
  summaryDay?: boolean;
  summaryNight?: boolean;
  alertCategories?: Category[];
  alertMinSeverity?: Severity;
  status?: RecipientStatus;
  maxStatus?: RecipientStatus;
}

export class RecipientRepository {
  constructor(private readonly db: Db) {}

  async create(r: { name: string; alertCategories: Category[]; alertMinSeverity: Severity; isTechAdmin: boolean }): Promise<number> {
    const now = nowIso();
    const res = await this.db.exec(
      `INSERT INTO recipients (name, alert_categories, alert_min_severity, is_tech_admin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [r.name, JSON.stringify(r.alertCategories), r.alertMinSeverity, r.isTechAdmin ? 1 : 0, now, now],
    );
    if (!res.changes || !res.lastInsertRowid) throw new Error('RecipientRepository.create: insert failed');
    return res.lastInsertRowid;
  }

  async get(id: number): Promise<Recipient | null> {
    const r = await this.db.first<RecipientRow>('SELECT * FROM recipients WHERE id = ?', [id]);
    return r ? rowToRecipient(r) : null;
  }

  async findByTelegramId(telegramUserId: number): Promise<Recipient | null> {
    const r = await this.db.first<RecipientRow>('SELECT * FROM recipients WHERE telegram_user_id = ?', [telegramUserId]);
    return r ? rowToRecipient(r) : null;
  }

  async findByMaxId(maxUserId: number): Promise<Recipient | null> {
    const r = await this.db.first<RecipientRow>('SELECT * FROM recipients WHERE max_user_id = ?', [maxUserId]);
    return r ? rowToRecipient(r) : null;
  }

  async findByChannelId(channel: Channel, id: number): Promise<Recipient | null> {
    return channel === 'telegram' ? this.findByTelegramId(id) : this.findByMaxId(id);
  }

  async list(): Promise<Recipient[]> {
    const out: Recipient[] = [];
    for (let offset = 0; ; offset += 100) {
      const rows = await this.db.query<RecipientRow>('SELECT * FROM recipients ORDER BY name, id LIMIT 100 OFFSET ?', [offset]);
      out.push(...rows.map(rowToRecipient));
      if (rows.length < 100) return out;
    }
  }

  /** Технические админы, активные хотя бы в одном канале — какой из них использовать, решает вызывающий код. */
  async listTechAdmins(): Promise<Recipient[]> {
    const rows = await this.db.query<RecipientRow>(
      "SELECT * FROM recipients WHERE is_tech_admin = 1 AND (status = 'active' OR max_status = 'active') LIMIT 100",
    );
    return rows.map(rowToRecipient);
  }

  async update(id: number, p: RecipientPatch): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, v: unknown) => {
      sets.push(`${col} = ?`);
      params.push(v);
    };
    if (p.name !== undefined) add('name', p.name);
    if (p.isTechAdmin !== undefined) add('is_tech_admin', p.isTechAdmin ? 1 : 0);
    if (p.summaryDay !== undefined) add('summary_day', p.summaryDay ? 1 : 0);
    if (p.summaryNight !== undefined) add('summary_night', p.summaryNight ? 1 : 0);
    if (p.alertCategories !== undefined) add('alert_categories', JSON.stringify(p.alertCategories));
    if (p.alertMinSeverity !== undefined) add('alert_min_severity', p.alertMinSeverity);
    if (p.status !== undefined) add('status', p.status);
    if (p.maxStatus !== undefined) add('max_status', p.maxStatus);
    if (!sets.length) return;
    add('updated_at', nowIso());
    await this.db.exec(`UPDATE recipients SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  }

  /** Привязка Telegram ID. false — ID уже занят другим получателем. */
  async bind(id: number, telegramUserId: number, username: string | null): Promise<boolean> {
    const taken = await this.findByTelegramId(telegramUserId);
    if (taken && taken.id !== id) return false;
    await this.db.exec(
      `UPDATE recipients SET telegram_user_id = ?, telegram_username = ?, status = 'active', activated_at = ?, blocked_at = NULL,
         updated_at = ? WHERE id = ?`,
      [telegramUserId, username, nowIso(), nowIso(), id],
    );
    return true;
  }

  async resetBinding(id: number): Promise<void> {
    await this.db.exec(
      `UPDATE recipients SET telegram_user_id = NULL, telegram_username = NULL, status = 'pending', activated_at = NULL,
         blocked_at = NULL, updated_at = ? WHERE id = ?`,
      [nowIso(), id],
    );
  }

  async markBlocked(id: number): Promise<void> {
    await this.db.exec("UPDATE recipients SET status = 'blocked', blocked_at = ?, updated_at = ? WHERE id = ? AND status = 'active'", [
      nowIso(),
      nowIso(),
      id,
    ]);
  }

  async setMenuMessageId(id: number, messageId: number): Promise<void> {
    await this.db.exec('UPDATE recipients SET menu_message_id = ? WHERE id = ?', [messageId, id]);
  }

  /** Привязка MAX ID. false — ID уже занят другим получателем. */
  async bindMax(id: number, maxUserId: number, username: string | null): Promise<boolean> {
    const taken = await this.findByMaxId(maxUserId);
    if (taken && taken.id !== id) return false;
    await this.db.exec(
      `UPDATE recipients SET max_user_id = ?, max_username = ?, max_status = 'active', max_activated_at = ?, max_blocked_at = NULL,
         updated_at = ? WHERE id = ?`,
      [maxUserId, username, nowIso(), nowIso(), id],
    );
    return true;
  }

  async resetBindingMax(id: number): Promise<void> {
    await this.db.exec(
      `UPDATE recipients SET max_user_id = NULL, max_username = NULL, max_status = 'pending', max_activated_at = NULL,
         max_blocked_at = NULL, updated_at = ? WHERE id = ?`,
      [nowIso(), id],
    );
  }

  async markBlockedMax(id: number): Promise<void> {
    await this.db.exec("UPDATE recipients SET max_status = 'blocked', max_blocked_at = ?, updated_at = ? WHERE id = ? AND max_status = 'active'", [
      nowIso(),
      nowIso(),
      id,
    ]);
  }

  async setMaxMenuMessageId(id: number, messageId: number): Promise<void> {
    await this.db.exec('UPDATE recipients SET max_menu_message_id = ? WHERE id = ?', [messageId, id]);
  }

  async setLastDelivery(id: number, status: string): Promise<void> {
    await this.db.exec('UPDATE recipients SET last_delivery_at = ?, last_delivery_status = ? WHERE id = ?', [nowIso(), status, id]);
  }

  async delete(id: number): Promise<void> {
    await this.db.exec('DELETE FROM summary_subscriptions WHERE recipient_id = ?', [id]);
    await this.db.exec('DELETE FROM alert_subscriptions WHERE recipient_id = ?', [id]);
    await this.db.exec('DELETE FROM binding_codes WHERE recipient_id = ?', [id]);
    await this.db.exec('DELETE FROM recipients WHERE id = ?', [id]);
  }

  // --- коды привязки: одна карта «канал → код», старые неиспользованные коды того же канала гасятся ---
  async createCode(recipientId: number, channel: Channel, codeHash: string, expiresAt: string): Promise<void> {
    await this.db.exec('DELETE FROM binding_codes WHERE recipient_id = ? AND channel = ? AND used_at IS NULL', [recipientId, channel]);
    await this.db.exec('INSERT INTO binding_codes (code_hash, recipient_id, channel, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [
      codeHash,
      recipientId,
      channel,
      nowIso(),
      expiresAt,
    ]);
  }

  async findCode(codeHash: string): Promise<{ recipientId: number; channel: Channel; expiresAt: string; usedAt: string | null } | null> {
    const r = await this.db.first<{ recipient_id: number; channel: string; expires_at: string; used_at: string | null }>(
      'SELECT recipient_id, channel, expires_at, used_at FROM binding_codes WHERE code_hash = ?',
      [codeHash],
    );
    return r ? { recipientId: r.recipient_id, channel: r.channel as Channel, expiresAt: r.expires_at, usedAt: r.used_at } : null;
  }

  /** Атомарно гасит код. true — код был не использован и погашен этим вызовом. */
  async useCode(codeHash: string): Promise<boolean> {
    const r = await this.db.exec('UPDATE binding_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?', [
      nowIso(),
      codeHash,
      nowIso(),
    ]);
    return r.changes > 0;
  }

  async activeCodeExpiry(recipientId: number, channel: Channel): Promise<string | null> {
    const r = await this.db.first<{ expires_at: string }>(
      'SELECT expires_at FROM binding_codes WHERE recipient_id = ? AND channel = ? AND used_at IS NULL AND expires_at > ? ORDER BY expires_at DESC LIMIT 1',
      [recipientId, channel, nowIso()],
    );
    return r?.expires_at ?? null;
  }
}
