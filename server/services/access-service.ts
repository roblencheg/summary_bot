import type { DirectorateRepository } from '~server/repositories/directorate-repository';
import type { Admin } from '~server/models/admin';
import type { Scope } from '~server/models/directorate';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';

/**
 * Права запроса по дирекциям. Суперадмин — без фильтров; руководитель — только чаты своих
 * дирекций (владелец или чтение) и получатели своих дирекций. Невидимое → 404, не своё действие → 403.
 */
export class AccessService {
  constructor(private readonly repo: DirectorateRepository) {}

  async scopeFor(admin: Admin): Promise<Scope> {
    if (admin.role !== 'manager') return { kind: 'super', login: admin.login };
    const directorateIds = await this.repo.directoratesOfAdmin(admin.id);
    const access = await this.repo.chatAccessOfDirectorates(directorateIds);
    const recipientIds = await this.repo.recipientIdsOfDirectorates(directorateIds);
    return {
      kind: 'manager',
      login: admin.login,
      adminId: admin.id,
      directorateIds,
      chatIds: new Set(access.map((a) => a.chatId)),
      ownedChatIds: new Set(access.filter((a) => a.access === 'owner').map((a) => a.chatId)),
      recipientIds: new Set(recipientIds),
    };
  }

  requireSuper(s: Scope): void {
    if (s.kind !== 'super') throw new ForbiddenError('Раздел доступен только суперадмину');
  }

  /** undefined — без фильтра (суперадмин). */
  chatFilter(s: Scope): number[] | undefined {
    return s.kind === 'super' ? undefined : [...s.chatIds];
  }

  recipientFilter(s: Scope): number[] | undefined {
    return s.kind === 'super' ? undefined : [...s.recipientIds];
  }

  canSeeChat(s: Scope, chatId: number): boolean {
    return s.kind === 'super' || s.chatIds.has(chatId);
  }

  canSeeRecipient(s: Scope, recipientId: number): boolean {
    return s.kind === 'super' || s.recipientIds.has(recipientId);
  }

  accessTo(s: Scope, chatId: number): 'super' | 'owner' | 'reader' | null {
    if (s.kind === 'super') return 'super';
    if (s.ownedChatIds.has(chatId)) return 'owner';
    return s.chatIds.has(chatId) ? 'reader' : null;
  }

  assertChat(s: Scope, chatId: number, mode: 'read' | 'own' = 'read'): void {
    const a = this.accessTo(s, chatId);
    if (!a) throw new NotFoundError('Чат не найден');
    if (mode === 'own' && a === 'reader') throw new ForbiddenError('Менять настройки чата может только дирекция-владелец');
  }

  assertRecipient(s: Scope, recipientId: number): void {
    if (!this.canSeeRecipient(s, recipientId)) throw new NotFoundError('Получатель не найден');
  }

  /** Дирекция для нового объекта: указанная (если доступна) или единственная/первая своя. */
  async targetDirectorate(s: Scope, requested: number | undefined): Promise<number> {
    if (s.kind === 'manager') {
      if (requested !== undefined) {
        if (!s.directorateIds.includes(requested)) throw new ValidationError('Дирекция недоступна');
        return requested;
      }
      if (!s.directorateIds.length) throw new ValidationError('Вы не состоите ни в одной дирекции — обратитесь к суперадмину');
      return s.directorateIds[0];
    }
    if (requested !== undefined) {
      if (!(await this.repo.get(requested))) throw new ValidationError('Дирекция не найдена');
      return requested;
    }
    const [first] = await this.repo.list();
    if (!first) throw new ValidationError('Сначала создайте дирекцию');
    return first.id;
  }
}
