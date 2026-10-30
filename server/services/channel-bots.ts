import type { Channel } from '~shared/domain';
import type { BotService } from './bot-service';
import type { MaxBotService } from './max-bot-service';
import type { ChannelReply } from './bot-callback';

/** Выбор клиента канала по BotCallback.channel — единственная точка ветвления для callback-хендлеров. */
export class ChannelBots {
  constructor(
    private readonly telegram: BotService,
    private readonly max: MaxBotService,
  ) {}

  replyFor(channel: Channel): ChannelReply {
    return channel === 'telegram' ? this.telegram : this.max;
  }

  configured(channel: Channel): boolean {
    return channel === 'telegram' ? this.telegram.configured : this.max.configured;
  }
}
