import { z } from 'zod';
import { CATEGORIES, TONES } from '~shared/domain';

/**
 * Схемы ответа модели. Это НЕ контракт HTTP API (поэтому не в shared/schemas.ts):
 * JSON-схема уходит в `text.format` (strict), zod — повторная проверка на нашей стороне.
 */

export const AI_CATEGORIES = CATEGORIES.filter((c) => c !== 'spike');
export const AI_SEVERITIES = ['none', 'info', 'attention', 'high', 'critical'] as const;

export function analysisJsonSchema(topics: string[]): Record<string, unknown> {
  const str = { type: 'string' };
  const intArr = { type: 'array', items: { type: 'integer' } };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['messages'],
    properties: {
      messages: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'message_id',
            'is_request',
            'request_ref',
            'topic',
            'summary',
            'tone',
            'categories',
            'severity',
            'severity_reason',
            'confidence',
            'repeat_markers',
            'entities',
            'incident_ref',
            'material_update',
            'resolution_confirmed',
            'answers_message_ids',
            'evidence_message_ids',
          ],
          properties: {
            message_id: { type: 'integer' },
            is_request: { type: 'boolean' },
            request_ref: str,
            topic: { type: 'string', enum: topics },
            summary: str,
            tone: { type: 'string', enum: [...TONES] },
            categories: { type: 'array', items: { type: 'string', enum: AI_CATEGORIES } },
            severity: { type: 'string', enum: [...AI_SEVERITIES] },
            severity_reason: str,
            confidence: { type: 'number' },
            repeat_markers: { type: 'array', items: str },
            entities: { type: 'array', items: str },
            incident_ref: str,
            material_update: { type: 'boolean' },
            resolution_confirmed: { type: 'boolean' },
            answers_message_ids: intArr,
            evidence_message_ids: intArr,
          },
        },
      },
    },
  };
}

export const AnalysisItemSchema = z.object({
  message_id: z.number().int(),
  is_request: z.boolean(),
  request_ref: z.string().max(200),
  topic: z.string(),
  summary: z.string().max(1000),
  tone: z.enum(TONES),
  categories: z.array(z.enum(AI_CATEGORIES as [string, ...string[]])),
  severity: z.enum(AI_SEVERITIES),
  severity_reason: z.string().max(1000),
  confidence: z.number().min(0).max(1),
  repeat_markers: z.array(z.string().max(100)).max(10),
  entities: z.array(z.string().max(100)).max(20),
  incident_ref: z.string().max(50),
  material_update: z.boolean(),
  resolution_confirmed: z.boolean(),
  answers_message_ids: z.array(z.number().int()).max(50),
  evidence_message_ids: z.array(z.number().int()).max(50),
});
export type AnalysisItem = z.infer<typeof AnalysisItemSchema>;

export const AnalysisResponseSchema = z.object({ messages: z.array(AnalysisItemSchema) });
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

export function digestJsonSchema(): Record<string, unknown> {
  const statement = {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'evidence_message_ids'],
    properties: { text: { type: 'string' }, evidence_message_ids: { type: 'array', items: { type: 'integer' } } },
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'overview', 'tone_reasons', 'attention'],
    properties: {
      headline: statement,
      overview: { type: 'array', items: statement },
      tone_reasons: { type: 'array', items: statement },
      attention: { type: 'array', items: statement },
    },
  };
}

const StatementSchema = z.object({ text: z.string().max(600), evidence_message_ids: z.array(z.number().int()).max(20) });
export const DigestResponseSchema = z.object({
  headline: StatementSchema,
  overview: z.array(StatementSchema).max(8),
  tone_reasons: z.array(StatementSchema).max(6),
  attention: z.array(StatementSchema).max(8),
});
export type DigestResponse = z.infer<typeof DigestResponseSchema>;
