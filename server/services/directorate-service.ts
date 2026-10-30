import type { DirectorateRepository } from '~server/repositories/directorate-repository';
import type { ChatAccess, Directorate, Importance, QuietMode, Scope, SummaryPrefs } from '~server/models/directorate';
import type { Channel } from '~shared/domain';
import type { AccessService } from './access-service';
import type { AdminService } from './admin-service';
import type { AuditService } from './audit-service';
import type { BotService } from './bot-service';
import type { ChatService } from './chat-service';
import type { SubscriptionService } from './subscription-service';
import { hashCode, newCode } from './recipient-service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors';
import { TECH } from './settings-defaults';

export type ClaimResult = { ok: true; directorate: Directorate } | { ok: false; reason: 'invalid' | 'taken' | 'mine' };

/**
 * Дирекции (раздел суперадмина) и подключение чата руководителем по одноразовому коду.
 * После любого изменения доступа к чату или состава дирекций подписки, ставшие невидимыми, снимаются.
 */
export class DirectorateService {
  constructor(
    private readonly repo: DirectorateRepository,
    private readonly access: AccessService,
    private readonly admins: AdminService,
    private readonly chats: ChatService,
    private readonly subscriptions: SubscriptionService,
    private readonly bot: BotService,
    private readonly audit: AuditService,
  ) {}

  /** Полная картина для раздела «Дирекции». */
  async overview() {
    const [directorates, admins, adminDirs, access, recipientDirs, chats] = await Promise.all([
      this.repo.list(),
      this.admins.list(),
      this.repo.allAdminDirectorates(),
      this.repo.allChatAccess(),
      this.repo.allRecipientDirectorates(),
      this.chats.list(),
    ]);
    const owned = new Set(access.filter((a) => a.access === 'owner').map((a) => a.chatId));
    const chatById = new Map(chats.map((c) => [c.id, c]));
    return {
      directorates: directorates.map((d) => ({
        id: d.id,
        name: d.name,
        quietChats: d.quietChats,
        managerIds: adminDirs.filter((x) => x.directorateId === d.id).map((x) => x.adminId),
        chats: access
          .filter((a) => a.directorateId === d.id && chatById.has(a.chatId))
          .map((a) => ({
            chatId: a.chatId,
            title: chatById.get(a.chatId)!.title,
            channel: chatById.get(a.chatId)!.channel,
            status: chatById.get(a.chatId)!.status,
            access: a.access,
            importance: a.importance,
          })),
        recipients: recipientDirs.filter((x) => x.directorateId === d.id).length,
      })),
      managers: admins
        .filter((a) => a.role === 'manager')
        .map((a) => ({ id: a.id, login: a.login, disabled: a.disabled, lastLoginAt: a.lastLoginAt, directorateIds: adminDirs.filter((x) => x.adminId === a.id).map((x) => x.directorateId) })),
      unassigned: chats.filter((c) => !owned.has(c.id) && c.status !== 'migrated').map((c) => ({ id: c.id, title: c.title, channel: c.channel, status: c.status })),
    };
  }

  async create(name: string, actor: string): Promise<void> {
    const n = name.trim();
    if (!n) throw new ValidationError('Укажите название');
    const id = await this.repo.create(n);
    if (!id) throw new ConflictError('Дирекция с таким названием уже есть');
    await this.audit.record(actor, 'directorate.create', 'directorate', String(id), null, { name: n });
  }

  async rename(id: number, name: string, actor: string): Promise<void> {
    const d = await this.repo.get(id);
    if (!d) throw new NotFoundError('Дирекция не найдена');
    const n = name.trim();
    if (!n) throw new ValidationError('Укажите название');
    if (!(await this.repo.rename(id, n))) throw new ConflictError('Дирекция с таким названием уже есть');
    await this.audit.record(actor, 'directorate.rename', 'directorate', String(id), { name: d.name }, { name: n });
  }

  async createManager(login: string, password: string, directorateIds: number[], actor: string): Promise<void> {
    await this.checkDirectorates(directorateIds);
    const id = await this.admins.create(login, password, actor, 'manager');
    await this.repo.setAdminDirectorates(id, directorateIds);
    await this.audit.record(actor, 'manager.directorates', 'admin', login.trim(), null, { directorateIds });
  }

  async setManagerDirectorates(adminId: number, directorateIds: number[], actor: string): Promise<void> {
    const admin = (await this.admins.list()).find((a) => a.id === adminId);
    if (!admin || admin.role !== 'manager') throw new NotFoundError('Руководитель не найден');
    await this.checkDirectorates(directorateIds);
    const prev = await this.repo.directoratesOfAdmin(adminId);
    await this.repo.setAdminDirectorates(adminId, directorateIds);
    await this.audit.record(actor, 'manager.directorates', 'admin', admin.login, { directorateIds: prev }, { directorateIds });
  }

  /** access = null — отозвать доступ дирекции к чату. */
  async setChatAccess(chatId: number, directorateId: number, access: ChatAccess | null, actor: string): Promise<void> {
    if (!(await this.chats.get(chatId))) throw new NotFoundError('Чат не найден');
    if (!(await this.repo.get(directorateId))) throw new NotFoundError('Дирекция не найдена');
    const prev = await this.repo.chatAccessOfChat(chatId);
    if (access) await this.repo.setAccess(chatId, directorateId, access);
    else await this.repo.removeAccess(chatId, directorateId);
    await this.subscriptions.dropInvisibleForChat(chatId);
    await this.audit.record(actor, 'chat.access', 'chat', String(chatId), prev, await this.repo.chatAccessOfChat(chatId));
  }

  /** Состав дирекций получателя (суперадмин). */
  async setRecipientDirectorates(recipientId: number, directorateIds: number[], actor: string): Promise<void> {
    await this.checkDirectorates(directorateIds);
    const prev = await this.repo.directoratesOfRecipient(recipientId);
    for (const id of directorateIds) await this.repo.addRecipient(recipientId, id);
    await this.repo.removeRecipient(recipientId, prev.filter((id) => !directorateIds.includes(id)));
    await this.subscriptions.dropInvisibleForRecipient(recipientId);
    await this.audit.record(actor, 'recipient.directorates', 'recipient', String(recipientId), { directorateIds: prev }, { directorateIds });
  }

  /** Дирекция-владелец каждого чата (для подписи в списке чатов). */
  async chatOwners(): Promise<Map<number, { id: number; name: string }>> {
    const [access, dirs] = await Promise.all([this.repo.allChatAccess(), this.repo.list()]);
    const name = new Map(dirs.map((d) => [d.id, d.name]));
    return new Map(access.filter((a) => a.access === 'owner').map((a) => [a.chatId, { id: a.directorateId, name: name.get(a.directorateId) ?? '—' }]));
  }

  /**
   * Важность чата в саммари для дирекции. Руководитель — своя дирекция с доступом к чату
   * (по умолчанию первая такая); суперадмин — directorateId обязателен.
   */
  async setImportance(scope: Scope, chatId: number, importance: Importance, directorateId: number | undefined): Promise<void> {
    this.access.assertChat(scope, chatId);
    const rows = await this.repo.chatAccessOfChat(chatId);
    const own = scope.kind === 'manager' ? rows.filter((r) => scope.directorateIds.includes(r.directorateId)) : rows;
    const target = directorateId ?? (scope.kind === 'manager' ? own[0]?.directorateId : undefined);
    if (target === undefined) throw new ValidationError('Укажите дирекцию');
    const row = own.find((r) => r.directorateId === target);
    if (!row) throw new ValidationError('У дирекции нет доступа к чату');
    await this.repo.setImportance(chatId, target, importance);
    await this.audit.record(scope.login, 'chat.importance', 'chat', String(chatId), { directorateId: target, importance: row.importance }, { directorateId: target, importance });
  }

  /** Режим чатов без событий в саммари дирекции: руководитель своей дирекции или суперадмин. */
  async setQuietChats(scope: Scope, directorateId: number, mode: QuietMode): Promise<void> {
    if (scope.kind === 'manager' && !scope.directorateIds.includes(directorateId)) throw new ForbiddenError('Дирекция недоступна');
    const d = await this.repo.get(directorateId);
    if (!d) throw new NotFoundError('Дирекция не найдена');
    await this.repo.setQuietChats(directorateId, mode);
    await this.audit.record(scope.login, 'directorate.quiet_chats', 'directorate', String(directorateId), { quietChats: d.quietChats }, { quietChats: mode });
  }

  /** Важность чатов для дирекций руководителя (наибольшая); суперадмину — пусто (задаёт в «Дирекциях»). */
  async importanceFor(scope: Scope): Promise<Map<number, Importance>> {
    const out = new Map<number, Importance>();
    if (scope.kind !== 'manager') return out;
    const rank: Record<Importance, number> = { low: 0, normal: 1, high: 2 };
    for (const a of await this.repo.chatAccessOfDirectorates(scope.directorateIds)) {
      const prev = out.get(a.chatId);
      if (!prev || rank[a.importance] > rank[prev]) out.set(a.chatId, a.importance);
    }
    return out;
  }

  /** Важность — наибольшая среди дирекций получателя; режим тихих чатов — самый подробный. */
  async summaryPrefs(recipientId: number): Promise<SummaryPrefs> {
    const { access, quiet } = await this.repo.prefsOfRecipient(recipientId);
    const rank: Record<Importance, number> = { low: 0, normal: 1, high: 2 };
    const importance = new Map<number, Importance>();
    for (const a of access) {
      const prev = importance.get(a.chatId);
      if (!prev || rank[a.importance] > rank[prev]) importance.set(a.chatId, a.importance);
    }
    const verbose: QuietMode[] = ['full', 'line', 'hide'];
    const mode = quiet.length ? verbose.find((m) => quiet.includes(m))! : 'line';
    return { importance, quiet: mode };
  }

  directoratesOf(ids: number[]): Promise<Directorate[]> {
    return this.repo.getMany(ids);
  }

  list(): Promise<Directorate[]> {
    return this.repo.list();
  }

  /** Код/ссылка подключения чата для дирекции руководителя: бот добавляется в группу с кодом (Telegram) или получает `/connect <код>` (MAX). */
  async issueClaimLink(
    scope: Scope,
    directorateId: number | undefined,
    channel: Channel,
  ): Promise<{ link: string | null; code: string; expiresAt: string; directorate: string; channel: Channel }> {
    const dirId = await this.access.targetDirectorate(scope, directorateId);
    const dir = (await this.repo.get(dirId))!;
    const code = newCode();
    const expiresAt = new Date(Date.now() + TECH.bindingCodeTtlHours * 3600_000).toISOString();
    await this.repo.insertClaimCode({ codeHash: hashCode(code), directorateId: dirId, createdBy: scope.login, expiresAt, channel });
    await this.audit.record(scope.login, 'chat.claim_link', 'directorate', String(dirId), null, { channel, expiresAt });
    if (channel === 'telegram') {
      const username = await this.bot.username();
      return { link: username ? `https://t.me/${username}?startgroup=${code}` : null, code, expiresAt, directorate: dir.name, channel };
    }
    // AICODE-NOTE: формат групповой deep-link ссылки MAX (аналог ?startgroup=) не подтверждён
    // документацией — код сообщается для ручного ввода `/connect <код>` в добавленной группе.
    return { link: null, code, expiresAt, directorate: dir.name, channel };
  }

  /**
   * Закрепление группы за дирекцией по коду (команда в группе того же канала, на который код выдан).
   * Свободный чат получает владельца и сразу начинает сбор; чат с владельцем не перехватывается.
   */
  async claimChat(chatId: number, code: string, fromId: number, channel: Channel): Promise<ClaimResult> {
    const actor = `${channel}:${fromId}`;
    const stored = await this.repo.findClaimCode(hashCode(code));
    if (!stored || stored.channel !== channel || stored.usedAt || new Date(stored.expiresAt).getTime() < Date.now()) {
      return { ok: false, reason: 'invalid' };
    }
    const owner = (await this.repo.chatAccessOfChat(chatId)).find((a) => a.access === 'owner');
    if (owner) {
      await this.audit.record(actor, 'chat.claim.rejected', 'chat', String(chatId), null, { directorateId: stored.directorateId, owner: owner.directorateId });
      return { ok: false, reason: owner.directorateId === stored.directorateId ? 'mine' : 'taken' };
    }
    if (!(await this.repo.useClaimCode(stored.codeHash, chatId))) return { ok: false, reason: 'invalid' };
    if (!(await this.repo.setOwnerIfNone(chatId, stored.directorateId))) return { ok: false, reason: 'taken' };
    await this.audit.record(actor, 'chat.claim', 'chat', String(chatId), null, { directorateId: stored.directorateId, issuedBy: stored.createdBy });
    // руководитель сам добавил бота — сбор начинается сразу (с проверкой прав бота)
    await this.chats.activate(chatId, actor).catch((err) => console.error('[claim] activate failed:', (err as Error).message));
    return { ok: true, directorate: (await this.repo.get(stored.directorateId))! };
  }

  private async checkDirectorates(ids: number[]): Promise<void> {
    const found = await this.repo.getMany([...new Set(ids)]);
    if (found.length !== new Set(ids).size) throw new ValidationError('Дирекция не найдена');
  }
}
