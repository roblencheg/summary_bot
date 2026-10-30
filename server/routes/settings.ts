import type { FastifyInstance } from 'fastify';
import { AppContextSchema, AuditListSchema, AuditQuerySchema, BackupResponseSchema, GlobalSettingsSchema, SettingsResponseSchema } from '~shared/schemas';
import type { Container } from '~server/container';
import { env, publicBaseUrl } from '~server/config';
import { createPlatform } from '~server/platform';
import { DEFAULT_SETTINGS } from '~server/services/settings-defaults';
import { actor, parse, scope } from './http';

const SECRET_NAMES = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'MAX_BOT_TOKEN',
  'MAX_WEBHOOK_SECRET',
  'ADMIN_INITIAL_LOGIN',
  'ADMIN_INITIAL_PASSWORD',
  'OPENAI_API_KEY',
] as const;

export async function registerSettingsRoutes(app: FastifyInstance, c: Container): Promise<void> {
  const response = async () => {
    const me = await c.bot.getMe();
    const maxMe = await c.maxBot.getMe();
    return SettingsResponseSchema.parse({
      settings: await c.settings.global(),
      defaults: DEFAULT_SETTINGS,
      // только признак «задан/не задан» — значения секретов не покидают сервер
      secrets: SECRET_NAMES.map((name) => ({ name, set: Boolean(env[name]) })),
      runtime: {
        telegramMode: c.bot.configured ? c.bot.mode : 'off',
        webhookUrl: c.state.intake.webhookUrl,
        publicBaseUrl,
        botUsername: me?.username ?? null,
        botReadsAllGroupMessages: me?.can_read_all_group_messages ?? null,
        maxMode: c.maxBot.configured ? c.maxBot.mode : 'off',
        maxBotUsername: maxMe?.username ?? null,
        aiConfigured: c.ai.configured,
        storageConfigured: createPlatform().configured,
      },
      backups: await c.maintenance.listBackups().catch(() => []),
    });
  };

  // минимум общих настроек для интерфейса любой роли (часовой пояс, расписание, бот, правила по умолчанию)
  app.get('/api/context', async () => {
    const g = await c.settings.global();
    const me = await c.bot.getMe();
    const maxMe = await c.maxBot.getMe();
    return AppContextSchema.parse({
      timezone: g.timezone,
      dayStart: g.dayStart,
      nightStart: g.nightStart,
      botUsername: me?.username ?? null,
      maxBotUsername: maxMe?.username ?? null,
      defaultRules: g.rules,
    });
  });

  // глобальные настройки, копии и аудит — только суперадмин
  app.get('/api/settings', async (req) => {
    c.access.requireSuper(scope(req));
    return response();
  });

  app.put('/api/settings', async (req) => {
    c.access.requireSuper(scope(req));
    const input = parse(GlobalSettingsSchema, req.body);
    await c.settings.updateGlobal(input, actor(req));
    return response();
  });

  app.post('/api/settings/backup', async (req) => {
    c.access.requireSuper(scope(req));
    const g = await c.settings.global();
    const prefix = await c.maintenance.runBackup(new Date(), g.backupKeep);
    await c.audit.record(actor(req), 'backup.manual', 'backup', prefix, null, null);
    return BackupResponseSchema.parse({ prefix });
  });

  app.get('/api/audit', async (req) => {
    c.access.requireSuper(scope(req));
    return AuditListSchema.parse(await c.audit.list(parse(AuditQuerySchema, req.query)));
  });
}
