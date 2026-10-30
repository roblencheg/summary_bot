import OpenAI from 'openai';
import { openaiConfig } from '~server/platform';

/**
 * Вызов модели через внешний AI API с жёсткой JSON-схемой ответа.
 * Без БД: учёт вызовов пишет сервис по возвращённой статистике.
 */

export type AiErrorKind = 'unavailable' | 'invalid';

export class AiError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    message: string,
    public readonly usage: AiUsage | null = null,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface AiUsage {
  model: string;
  startedAt: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredRequest<T> {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  parse: (raw: unknown) => T;
  timeoutMs?: number;
}

export class AiClient {
  private client: OpenAI | null = null;

  get configured(): boolean {
    return Boolean(process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY);
  }

  private get api(): OpenAI {
    if (!this.client) this.client = new OpenAI({ ...openaiConfig(), maxRetries: 0 });
    return this.client;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<{ data: T; usage: AiUsage }> {
    const startedAt = new Date();
    let response: OpenAI.Responses.Response;
    try {
      response = await this.api.responses.create(
        {
          model: req.model,
          instructions: req.system,
          input: req.user,
          text: { format: { type: 'json_schema', name: req.schemaName, strict: true, schema: req.jsonSchema } },
        },
        { timeout: req.timeoutMs ?? 60_000 },
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      const usage = this.usage(req.model, startedAt, null);
      // 4xx (кроме 408/409/429) — ошибка запроса, а не недоступность
      if (status && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) {
        throw new AiError('invalid', `AI request rejected: ${status} ${(err as Error).message}`, usage);
      }
      throw new AiError('unavailable', `AI unavailable: ${status ?? ''} ${(err as Error).message}`.trim(), usage);
    }
    const usage = this.usage(req.model, startedAt, response.usage ?? null);
    if (response.status && response.status !== 'completed') {
      throw new AiError('invalid', `AI response status ${response.status}`, usage);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(response.output_text);
    } catch {
      throw new AiError('invalid', 'AI response is not valid JSON', usage);
    }
    try {
      return { data: req.parse(raw), usage };
    } catch (err) {
      throw new AiError('invalid', `AI response failed schema: ${(err as Error).message.slice(0, 300)}`, usage);
    }
  }

  private usage(model: string, startedAt: Date, u: { input_tokens?: number; output_tokens?: number } | null): AiUsage {
    return {
      model,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      inputTokens: u?.input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
    };
  }
}
