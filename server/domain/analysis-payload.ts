import type { Message } from '~server/models/message';
import type { Incident } from '~server/models/incident';

/**
 * Данные для модели. Только тексты чата, имена авторов и метки ролей — без Telegram ID,
 * получателей и настроек доступа. Используется и сервисом анализа, и скриптом калибровки.
 */

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

export function authorRef(m: Pick<Message, 'authorKey'>): string | null {
  return m.authorKey ? `a${Math.abs(hash(m.authorKey))}` : null;
}

function role(m: Message): 'support' | 'participant' | 'unknown' {
  if (m.isStaff) return 'support';
  return m.identityLimited ? 'unknown' : 'participant';
}

function forPrompt(m: Message, withAnalysis: boolean) {
  return {
    message_id: m.messageId,
    time: m.sentAt,
    author: m.authorName,
    author_ref: authorRef(m),
    role: role(m),
    reply_to: m.replyToMessageId,
    edited: m.revisionCount > 0,
    text: m.text.slice(0, 4000),
    ...(withAnalysis ? { request_key: m.requestKey, summary: m.summary } : {}),
  };
}

export function analysisPayload(topics: string[], context: Message[], open: Incident[], batch: Message[]) {
  return {
    data: {
      chat_topics: topics,
      context: context.map((m) => forPrompt(m, true)),
      open_incidents: open.map((i) => ({
        id: String(i.id),
        summary: i.summary,
        topic: i.topic,
        categories: i.categories,
        entities: i.entities,
        author: i.authorName,
        last_message_at: i.lastMessageAt,
      })),
      messages: batch.map((m) => forPrompt(m, false)),
    },
  };
}
