import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ChatDetailsSchema,
  ChatImportanceInputSchema,
  ChatRulesOverrideSchema,
  ChatSchema,
  ChatStaffInputSchema,
  ChatsResponseSchema,
  ClaimLinkInputSchema,
  ClaimLinkSchema,
  MessageDetailsSchema,
  MessagesQuerySchema,
  MessagesResponseSchema,
  PageQuerySchema,
  RequeueInputSchema,
  RequeueResponseSchema,
} from '~shared/schemas';
import type { Container } from '~server/container';
import type { Chat } from '~server/models/chat';
import { actor, idParam, parse, scope } from './http';

export async function registerChatRoutes(app: FastifyInstance, c: Container): Promise<void> {
  /** Права, дирекция-владелец и важность для дирекции руководителя — в каждом ответе с чатом. */
  const decorate = async (req: FastifyRequest, chat: Chat) => {
    const s = scope(req);
    const [owners, importance] = await Promise.all([c.directorates.chatOwners(), c.directorates.importanceFor(s)]);
    return { ...chat, access: c.access.accessTo(s, chat.id) ?? 'reader', ownerDirectorate: owners.get(chat.id) ?? null, importance: importance.get(chat.id) ?? null };
  };

  const details = async (req: FastifyRequest, id: number) => {
    const s = scope(req);
    c.access.assertChat(s, id);
    const chat = await c.chats.details(id);
    const recipients = (await c.recipients.list()).filter((r) => c.access.canSeeRecipient(s, r.id));
    return ChatDetailsSchema.parse({
      ...(await decorate(req, chat)),
      rulesOverride: chat.rulesOverride,
      staff: chat.staff,
      effectiveRules: await c.settings.rulesFor(id),
      summaryRecipients: recipients.filter((r) => r.summaryChatIds.includes(id)).map((r) => ({ id: r.id, name: r.name })),
      alertRecipients: recipients.filter((r) => r.alertChatIds.includes(id)).map((r) => ({ id: r.id, name: r.name })),
    });
  };

  const own = async (req: FastifyRequest) => {
    const id = idParam(req);
    c.access.assertChat(scope(req), id, 'own');
    return id;
  };

  app.get('/api/chats', async (req) => {
    const s = scope(req);
    const [owners, importance] = await Promise.all([c.directorates.chatOwners(), c.directorates.importanceFor(s)]);
    const chats = (await c.chats.list()).filter((chat) => c.access.canSeeChat(s, chat.id));
    return ChatsResponseSchema.parse(
      chats.map((chat) => ({ ...chat, access: c.access.accessTo(s, chat.id), ownerDirectorate: owners.get(chat.id) ?? null, importance: importance.get(chat.id) ?? null })),
    );
  });

  // важность чата в саммари для дирекции (руководитель — своя, суперадмин — указанная)
  app.put('/api/chats/:id/importance', async (req) => {
    const id = idParam(req);
    const input = parse(ChatImportanceInputSchema, req.body);
    await c.directorates.setImportance(scope(req), id, input.importance, input.directorateId);
    return details(req, id);
  });

  // ссылка подключения своего чата: бот добавляется в группу с одноразовым кодом дирекции
  app.post('/api/chats/claim-link', async (req, reply) => {
    const input = parse(ClaimLinkInputSchema, req.body ?? {});
    reply.status(201);
    return ClaimLinkSchema.parse(await c.directorates.issueClaimLink(scope(req), input.directorateId, input.channel));
  });

  app.get('/api/chats/:id', async (req) => details(req, idParam(req)));

  app.post('/api/chats/:id/activate', async (req) => ChatSchema.parse(await decorate(req, await c.chats.activate(await own(req), actor(req)))));

  app.post('/api/chats/:id/deactivate', async (req) => ChatSchema.parse(await decorate(req, await c.chats.deactivate(await own(req), actor(req)))));

  app.post('/api/chats/:id/check-rights', async (req) => ChatSchema.parse(await decorate(req, await c.chats.checkRightsFor(await own(req)))));

  app.put('/api/chats/:id/staff', async (req) => {
    const id = await own(req);
    const input = parse(ChatStaffInputSchema, req.body);
    await c.chats.setStaff(id, input.staff, actor(req));
    return details(req, id);
  });

  app.put('/api/chats/:id/rules', async (req) => {
    const id = await own(req);
    const input = parse(ChatRulesOverrideSchema, req.body);
    await c.chats.setRules(id, input, actor(req));
    return details(req, id);
  });

  app.get('/api/chats/:id/messages', async (req) => {
    const id = idParam(req);
    c.access.assertChat(scope(req), id);
    const q = parse(MessagesQuerySchema, req.query);
    return MessagesResponseSchema.parse(await c.messages.listByChat(id, q));
  });

  app.get('/api/messages/failed', async (req) => {
    c.access.requireSuper(scope(req));
    const q = parse(PageQuerySchema, req.query);
    return MessagesResponseSchema.parse(await c.messages.listAnalysisFailed(q.limit));
  });

  app.get('/api/messages/:id', async (req) => {
    const d = await c.messages.details(idParam(req));
    c.access.assertChat(scope(req), d.message.chatId);
    return MessageDetailsSchema.parse(d);
  });

  app.post('/api/analysis/requeue', async (req) => {
    c.access.requireSuper(scope(req));
    const input = parse(RequeueInputSchema, req.body);
    const n = await c.analysis.requeueFailed(input.chatId);
    await c.audit.record(actor(req), 'analysis.requeue', 'chat', input.chatId === null ? null : String(input.chatId), null, { requeued: n });
    c.state.wake('analysis');
    return RequeueResponseSchema.parse({ requeued: n });
  });
}
