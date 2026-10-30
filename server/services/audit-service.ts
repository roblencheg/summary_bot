import type { AuditRepository } from '~server/repositories/audit-repository';
import type { AuditEntry } from '~server/models/audit';

const SECRET_KEYS = /pass|secret|token|code|hash/i;

/** Убираем из аудита всё, что похоже на секрет. */
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? '***' : scrub(x)]));
  }
  return v;
}

export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  async record(actor: string, action: string, entity: string, entityId: string | null, oldValue: unknown, newValue: unknown): Promise<void> {
    await this.repo.insert({ actor, action, entity, entityId, oldValue: scrub(oldValue), newValue: scrub(newValue) });
  }

  list(f: { entity?: string; actor?: string; limit: number; offset: number }): Promise<{ items: AuditEntry[]; total: number }> {
    return this.repo.list(f);
  }
}
