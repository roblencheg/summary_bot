import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { OkSchema, TelegramUpdateSchema } from '~shared/schemas';
import type { Container } from '~server/container';
import type { TgUpdate } from '~server/integrations/telegram-client';

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Webhook Telegram: проверить секрет, СОХРАНИТЬ сырой апдейт и сразу ответить 200.
 * Обработка — асинхронно воркером приёма. Сбой записи → 500, Telegram повторит доставку.
 */
export async function registerTelegramRoutes(app: FastifyInstance, c: Container): Promise<void> {
  app.post('/api/telegram/webhook', async (req, reply) => {
    if (c.bot.mode !== 'webhook' || !c.bot.webhookSecret) return reply.status(503).send({ error: 'Webhook выключен' });
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (typeof header !== 'string' || !safeEqual(header, c.bot.webhookSecret)) {
      return reply.status(401).send({ error: 'Неверный секрет' });
    }
    const update = TelegramUpdateSchema.parse(req.body) as unknown as TgUpdate;
    await c.ingestion.store(update);
    return OkSchema.parse({ ok: true });
  });
}
