import { z } from 'zod';

/** Runtime settings from environment variables. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: z.coerce.number().optional(),

  DATA_DIR: z.string().default('./data'),
  DEFAULT_TIMEZONE: z.string().default('UTC').refine((v) => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, 'Invalid timezone'),
  OPENAI_MODEL: z.string().default('gpt-5.4-mini'),

  // External AI provider
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_BASE_URL: z.string().url().optional(),
  GEMINI_API_KEY: z.string().optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_MODE: z.enum(['webhook', 'polling', 'off']).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).optional(),

  // MAX
  MAX_BOT_TOKEN: z.string().optional(),
  MAX_MODE: z.enum(['webhook', 'polling', 'off']).optional(),
  MAX_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).optional(),

  // Админ-доступ
  ADMIN_INITIAL_LOGIN: z.string().optional(),
  ADMIN_INITIAL_PASSWORD: z.string().optional(),

  // Публичный адрес prod-деплоя: webhook, CORS, проверка Origin
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
});

export const env = envSchema.parse(Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, value === '' ? undefined : value])));
export const isProd = env.NODE_ENV === 'production';
export const port = env.PORT ?? (isProd ? 3000 : 3001);

// A single process must own polling for each bot token.
export const telegramMode = env.TELEGRAM_MODE ?? (env.TELEGRAM_BOT_TOKEN && isProd ? 'polling' : 'off');
export const maxMode = env.MAX_MODE ?? (env.MAX_BOT_TOKEN && isProd ? 'polling' : 'off');
export const publicBaseUrl = new URL(env.PUBLIC_BASE_URL).origin;
