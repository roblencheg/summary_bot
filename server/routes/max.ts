import type { FastifyInstance } from 'fastify';
import { MaxUpdateSchema, OkSchema } from '~shared/schemas';
import type { Container } from '~server/container';
import type { MaxUpdate } from '~server/integrations/max-client';

/**
 * Webhook MAX: аналог routes/telegram.ts. AICODE-NOTE: подпись/секрет webhook-запроса MAX не
 * задокументирован (design.md, «Риски») — по умолчанию MAX_MODE=polling, и этот путь не
 * получает трафика; при включении webhook здесь нужно добавить реальную проверку подлинности.
 */
export async function registerMaxRoutes(app: FastifyInstance, c: Container): Promise<void> {
  app.post('/api/max/webhook', async (req, reply) => {
    if (c.maxBot.mode !== 'webhook') return reply.status(503).send({ error: 'Webhook выключен' });
    const update = MaxUpdateSchema.parse(req.body) as unknown as MaxUpdate;
    await c.maxIngestion.store(update, null);
    return OkSchema.parse({ ok: true });
  });
}
