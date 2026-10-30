import type { Db } from '~server/platform';
import type { AuditEntry } from '~server/models/audit';
import { nowIso, parseJson } from './sql-utils';

interface AuditRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  old_value: string | null;
  new_value: string | null;
}

export class AuditRepository {
  constructor(private readonly db: Db) {}

  async insert(e: Omit<AuditEntry, 'id' | 'at'>): Promise<void> {
    await this.db.exec(
      'INSERT INTO audit_log (at, actor, action, entity, entity_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        nowIso(),
        e.actor,
        e.action,
        e.entity,
        e.entityId,
        e.oldValue === undefined ? null : JSON.stringify(e.oldValue),
        e.newValue === undefined ? null : JSON.stringify(e.newValue),
      ],
    );
  }

  async list(f: { entity?: string; actor?: string; limit: number; offset: number }): Promise<{ items: AuditEntry[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.entity) {
      where.push('entity = ?');
      params.push(f.entity);
    }
    if (f.actor) {
      where.push('actor = ?');
      params.push(f.actor);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await this.db.query<AuditRow>(
      `SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, Math.min(f.limit, 100), f.offset],
    );
    const total = await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log ${w}`, params);
    return {
      items: rows.map((r) => ({
        id: r.id,
        at: r.at,
        actor: r.actor,
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        oldValue: parseJson(r.old_value, null),
        newValue: parseJson(r.new_value, null),
      })),
      total: total?.n ?? 0,
    };
  }

  async deleteOlderThan(iso: string): Promise<number> {
    const r = await this.db.exec('DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log WHERE at < ? LIMIT 500)', [iso]);
    return r.changes;
  }
}
