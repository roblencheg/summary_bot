import { gzipSync, gunzipSync } from 'node:zlib';
import type { MessageRepository } from '~server/repositories/message-repository';
import type { IncidentRepository } from '~server/repositories/incident-repository';
import type { ReportRepository } from '~server/repositories/report-repository';
import type { DeliveryRepository } from '~server/repositories/delivery-repository';
import type { UpdateRepository } from '~server/repositories/update-repository';
import type { MaxUpdateRepository } from '~server/repositories/max-update-repository';
import type { AnalysisRepository } from '~server/repositories/analysis-repository';
import type { AuditRepository } from '~server/repositories/audit-repository';
import type { GapRepository } from '~server/repositories/gap-repository';
import type { BackupRepository } from '~server/repositories/backup-repository';
import type { OnDemandRepository } from '~server/repositories/on-demand-repository';
import type { DirectorateRepository } from '~server/repositories/directorate-repository';
import type { AdminRepository } from '~server/repositories/admin-repository';
import { localParts } from '~server/domain/periods';
import type { SettingsService } from './settings-service';

const LAST_RUN_KEY = 'maintenance.last_date';
const DAY = 86_400_000;

/** Сроки хранения и резервные копии. Раз в сутки после 04:00 по часовому поясу расписания. */
export class MaintenanceService {
  constructor(
    private readonly messages: MessageRepository,
    private readonly incidents: IncidentRepository,
    private readonly reports: ReportRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly updates: UpdateRepository,
    private readonly maxUpdates: MaxUpdateRepository,
    private readonly analysis: AnalysisRepository,
    private readonly audit: AuditRepository,
    private readonly gaps: GapRepository,
    private readonly admins: AdminRepository,
    private readonly backup: BackupRepository | null,
    private readonly settings: SettingsService,
    private readonly onDemand: OnDemandRepository,
    private readonly directorates: DirectorateRepository,
  ) {}

  async runIfDue(now = new Date()): Promise<boolean> {
    const g = await this.settings.global();
    const p = localParts(now, g.timezone);
    const today = `${p.y}-${p.m}-${p.d}`;
    if (p.h < 4 || (await this.settings.getValue<string>(LAST_RUN_KEY)) === today) return false;
    await this.settings.setValue(LAST_RUN_KEY, today);
    await this.retention(now);
    if (this.backup) await this.runBackup(now, g.backupKeep).catch((err) => console.error('[backup] failed:', (err as Error).message));
    return true;
  }

  /** Удаление от зависимых к родителям, пакетами по 500. */
  async retention(now = new Date()): Promise<Record<string, number>> {
    const g = await this.settings.global();
    const msgCut = new Date(now.getTime() - g.retentionMessagesDays * DAY).toISOString();
    const repCut = new Date(now.getTime() - g.retentionReportsDays * DAY).toISOString();
    const techCut = new Date(now.getTime() - g.retentionTechDays * DAY).toISOString();
    const drain = async (fn: () => Promise<number>) => {
      let total = 0;
      for (let i = 0; i < 400; i++) {
        const n = await fn();
        total += n;
        if (n < 500) break;
      }
      return total;
    };
    const stats: Record<string, number> = {};
    stats.revisions = await drain(() => this.messages.deleteRevisionsOlderThan(msgCut));
    stats.analysis = await drain(() => this.messages.deleteAnalysisOlderThan(msgCut));
    stats.incidentLinks = await drain(() => this.messages.deleteIncidentLinksOlderThan(msgCut));
    stats.messages = await drain(() => this.messages.deleteOlderThan(msgCut));
    stats.participants = await drain(() => this.messages.deleteOrphanParticipants(msgCut));
    stats.incidents = await drain(() => this.incidents.deleteOlderThan(repCut));
    stats.reports = await drain(() => this.reports.deleteOlderThan(repCut));
    stats.deliveries = await drain(() => this.deliveries.deleteOlderThan(techCut));
    stats.updates = await drain(() => this.updates.deleteProcessedOlderThan(techCut));
    stats.maxUpdates = await drain(() => this.maxUpdates.deleteProcessedOlderThan(techCut));
    stats.aiCalls = await drain(() => this.analysis.deleteCallsOlderThan(techCut));
    stats.onDemand = await drain(() => this.onDemand.deleteOlderThan(techCut));
    await this.directorates.deleteExpiredClaimCodes(techCut);
    stats.gaps = await drain(() => this.gaps.deleteOlderThan(repCut));
    stats.audit = await drain(() => this.audit.deleteOlderThan(repCut));
    await this.admins.deleteExpiredSessions();
    console.log('[maintenance] retention:', JSON.stringify(stats));
    return stats;
  }

  /** Экспорт всех таблиц в NDJSON.gz в локальное файловое хранилище, ротация копий. */
  async runBackup(now = new Date(), keep = 14): Promise<string> {
    if (!this.backup) throw new Error('Хранилище недоступно');
    const date = now.toISOString().slice(0, 10);
    const prefix = `backups/${date}/`;
    for (const table of await this.backup.tables()) {
      const lines: string[] = [];
      for await (const page of this.backup.rows(table)) for (const row of page) lines.push(JSON.stringify(row));
      await this.backup.upload(`${prefix}${table}.ndjson.gz`, gzipSync(Buffer.from(lines.join('\n'))), 'application/gzip');
    }
    const all = await this.backup.listPrefixes('backups/');
    for (const old of all.slice(0, Math.max(0, all.length - keep))) {
      for (const key of await this.backup.listKeys(old)) await this.backup.deleteKey(key);
    }
    console.log(`[backup] saved ${prefix}`);
    return prefix;
  }

  /** Восстановление копии в пустую БД (scripts/restore.ts). Существующие строки не перезаписываются. */
  async restore(date: string, log: (s: string) => void): Promise<void> {
    if (!this.backup) throw new Error('Хранилище недоступно');
    const keys = await this.backup.listKeys(`backups/${date}/`);
    if (!keys.length) throw new Error(`Копия backups/${date}/ не найдена`);
    for (const key of keys) {
      const table = key.split('/').pop()!.replace('.ndjson.gz', '');
      const text = gunzipSync(await this.backup.download(key)).toString('utf8');
      const rows = text ? text.split('\n').map((l) => JSON.parse(l) as Record<string, unknown>) : [];
      await this.backup.insertRows(table, rows);
      log(`${table}: ${rows.length} строк`);
    }
  }

  listBackups(): Promise<string[]> {
    return this.backup ? this.backup.listPrefixes('backups/') : Promise.resolve([]);
  }
}
