import type { MessageRepository } from '~server/repositories/message-repository';
import type { AnalysisRepository } from '~server/repositories/analysis-repository';
import type { Message } from '~server/models/message';
import { NotFoundError } from './errors';

/** Просмотр сообщений в админке (исходный текст без маскирования — только администратору). */
export class MessageService {
  constructor(
    private readonly repo: MessageRepository,
    private readonly analysis: AnalysisRepository,
  ) {}

  listByChat(chatId: number, f: { from?: string; to?: string; limit: number; offset: number }): Promise<Message[]> {
    return this.repo.listByChat(chatId, f);
  }

  listAnalysisFailed(limit: number): Promise<Message[]> {
    return this.repo.listAnalysisFailed(limit);
  }

  async details(id: number) {
    const [message] = await this.repo.getByIds([id]);
    if (!message) throw new NotFoundError('Сообщение не найдено');
    return {
      message,
      revisions: await this.repo.listRevisions(id),
      analysis: await this.analysis.latestForMessage(id),
    };
  }
}
