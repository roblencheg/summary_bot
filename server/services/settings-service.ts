import { createHash } from 'node:crypto';
import type { SettingsRepository } from '~server/repositories/settings-repository';
import type { ChatRules, GlobalSettings } from '~server/models/settings';
import { CATEGORIES, SEVERITIES } from '~shared/domain';
import { DEFAULT_SETTINGS } from './settings-defaults';
import type { AuditService } from './audit-service';
import { ValidationError } from './errors';

const GLOBAL_KEY = 'global';

/** Настройки с кэшем в памяти: процесс один, инвалидация — при сохранении. */
export class SettingsService {
  private cache: GlobalSettings | null = null;
  private chatCache = new Map<number, Partial<ChatRules>>();

  constructor(
    private readonly repo: SettingsRepository,
    private readonly audit: AuditService,
  ) {}

  async global(): Promise<GlobalSettings> {
    if (this.cache) return this.cache;
    const stored = (await this.repo.get<Partial<GlobalSettings>>(GLOBAL_KEY)) ?? {};
    this.cache = {
      ...DEFAULT_SETTINGS,
      ...stored,
      rules: { ...DEFAULT_SETTINGS.rules, ...(stored.rules ?? {}) },
    };
    return this.cache;
  }

  async updateGlobal(next: GlobalSettings, actor: string): Promise<GlobalSettings> {
    validateGlobal(next);
    const prev = await this.global();
    await this.repo.set(GLOBAL_KEY, next, actor);
    this.cache = null;
    await this.audit.record(actor, 'settings.update', 'settings', GLOBAL_KEY, prev, next);
    return this.global();
  }

  async chatOverride(chatId: number): Promise<Partial<ChatRules>> {
    const cached = this.chatCache.get(chatId);
    if (cached) return cached;
    const v = (await this.repo.getChatRules(chatId)) as Partial<ChatRules>;
    this.chatCache.set(chatId, v);
    return v;
  }

  async rulesFor(chatId: number): Promise<ChatRules> {
    const g = await this.global();
    return { ...g.rules, ...(await this.chatOverride(chatId)) };
  }

  async setChatOverride(chatId: number, override: Partial<ChatRules>, actor: string): Promise<void> {
    const merged = { ...(await this.global()).rules, ...override };
    validateRules(merged);
    const prev = await this.chatOverride(chatId);
    await this.repo.setChatRules(chatId, override);
    this.chatCache.delete(chatId);
    await this.audit.record(actor, 'chat.rules.update', 'chat', String(chatId), prev, override);
  }

  /** Версия правил — хэш итоговых правил чата и списка тем; хранится в каждом анализе. */
  async rulesVersion(chatId: number): Promise<string> {
    const rules = await this.rulesFor(chatId);
    const g = await this.global();
    return createHash('sha256').update(JSON.stringify({ rules, topics: g.topics })).digest('hex').slice(0, 12);
  }

  async getValue<T>(key: string): Promise<T | null> {
    return this.repo.get<T>(key);
  }

  async setValue(key: string, value: unknown): Promise<void> {
    await this.repo.set(key, value, 'system');
  }
}

function validateTime(s: string, field: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new ValidationError(`${field}: ожидается время ЧЧ:ММ`);
}

export function validateRules(r: ChatRules): void {
  if (!r.categories.length) throw new ValidationError('Нужна хотя бы одна категория алертов');
  if (r.categories.some((c) => !CATEGORIES.includes(c))) throw new ValidationError('Неизвестная категория');
  if (!SEVERITIES.includes(r.minSeverity)) throw new ValidationError('Неизвестная серьёзность');
  if (r.minConfidence < 0 || r.minConfidence > 1) throw new ValidationError('Порог уверенности — от 0 до 1');
  const positive: Array<[keyof ChatRules, number, number]> = [
    ['cooldownMin', 1, 1440],
    ['repeatCount', 2, 100],
    ['repeatWindowMin', 1, 1440],
    ['authorRepeatHours', 1, 168],
    ['spikeWindowMin', 1, 60],
    ['spikeMinMessages', 2, 10_000],
    ['spikeRatio', 1, 100],
    ['massAuthors', 2, 1000],
    ['massWindowMin', 1, 1440],
    ['historyDays', 1, 30],
    ['noReplyWindowMin', 1, 1440],
  ];
  for (const [k, min, max] of positive) {
    const v = r[k] as number;
    if (typeof v !== 'number' || Number.isNaN(v) || v < min || v > max) {
      throw new ValidationError(`${k}: допустимо от ${min} до ${max}`);
    }
  }
}

function validateGlobal(g: GlobalSettings): void {
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: g.timezone });
  } catch {
    throw new ValidationError('Неизвестный часовой пояс IANA');
  }
  validateTime(g.dayStart, 'Начало дня');
  validateTime(g.nightStart, 'Начало ночи');
  if (g.dayStart >= g.nightStart) throw new ValidationError('Начало дня должно быть раньше начала ночи');
  if (!g.topics.length) throw new ValidationError('Нужна хотя бы одна тема');
  if (!g.aiModel.trim()) throw new ValidationError('Укажите модель AI');
  if (g.retentionMessagesDays < 1 || g.retentionReportsDays < 1 || g.retentionTechDays < 1) {
    throw new ValidationError('Сроки хранения — от 1 дня');
  }
  if (g.catchupMaxReports < 0 || g.catchupMaxReports > 28) throw new ValidationError('Лимит догоняющих отчётов — 0…28');
  if (g.backupKeep < 1 || g.backupKeep > 90) throw new ValidationError('Число резервных копий — 1…90');
  validateRules(g.rules);
}
