/**
 * Калибровка качества алертов на размеченной выборке (не автотест).
 *   pnpm exec tsx scripts/eval-alerts.ts scripts/eval/required.jsonl [--split test]
 *
 * Формат строки JSONL:
 *   {"id":"x","dialog_id":"d1","split":"test","messages":[{"author":"Имя","text":"…","role":"participant|support"}],
 *    "target":2, "expected":{"alert":true,"categories":["prolonged"]}}
 * target — индекс размечаемого сообщения (по умолчанию последнее), остальные — контекст.
 * Решение «алерт» = есть категория и серьёзность/уверенность проходят правила по умолчанию.
 * Один dialog_id не может быть одновременно в tune и test.
 * Пример с id «req-…» — обязательный: его ошибка даёт код выхода 2.
 */
import { readFileSync } from 'node:fs';
import { AiClient } from '~server/integrations/ai-client';
import { AnalysisResponseSchema, analysisJsonSchema } from '~server/integrations/ai-schemas';
import { ANALYSIS_PROMPT_VERSION, analysisSystemPrompt } from '~server/integrations/prompts';
import { analysisPayload } from '~server/domain/analysis-payload';
import { DEFAULT_SETTINGS } from '~server/services/settings-defaults';
import type { Message } from '~server/models/message';
import { CATEGORIES, OTHER_TOPIC, severityRank, type Severity } from '~shared/domain';

interface Example {
  id: string;
  dialog_id: string;
  split: 'tune' | 'test' | 'required';
  messages: Array<{ author: string; text: string; role?: 'participant' | 'support' }>;
  target?: number;
  /** exhaustive=false — categories перечисляют обязательный минимум (лишние не считаются ошибкой) */
  expected: { alert: boolean; categories?: string[]; exhaustive?: boolean };
}

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('Использование: pnpm exec tsx scripts/eval-alerts.ts <file.jsonl> [--split test]');
  process.exit(1);
}
const split = rest[rest.indexOf('--split') + 1] ?? undefined;
const all: Example[] = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const splits = new Map<string, Set<string>>();
for (const e of all) {
  if (!splits.has(e.dialog_id)) splits.set(e.dialog_id, new Set());
  splits.get(e.dialog_id)!.add(e.split);
}
const leaked = [...splits].filter(([, s]) => s.has('tune') && s.has('test')).map(([d]) => d);
if (leaked.length) {
  console.error(`Диалоги одновременно в tune и test: ${leaked.join(', ')}`);
  process.exit(1);
}
const examples = split && rest.includes('--split') ? all.filter((e) => e.split === split) : all;

const ai = new AiClient();
const rules = DEFAULT_SETTINGS.rules;
const topics = [...DEFAULT_SETTINGS.topics, OTHER_TOPIC];
const toMessage = (m: Example['messages'][number], i: number): Message => ({
  id: i + 1,
  chatId: 0,
  messageId: i + 1,
  sentAt: new Date(Date.now() - (100 - i) * 60_000).toISOString(),
  receivedAt: new Date().toISOString(),
  authorKey: `u:${m.author}`,
  authorId: null,
  authorName: m.author,
  authorUsername: null,
  senderChatId: null,
  identityLimited: false,
  isStaff: m.role === 'support',
  text: m.text,
  contentType: 'text',
  hasText: true,
  replyToMessageId: null,
  threadId: null,
  editedAt: null,
  revisionCount: 0,
  link: null,
  analysisStatus: 'done',
  analysisAttempts: 0,
  analysisError: null,
  analyzedAt: null,
  analysisId: null,
  isRequest: null,
  requestKey: null,
  topic: null,
  tone: null,
  categories: [],
  severity: null,
  confidence: null,
  summary: null,
  resolutionConfirmed: false,
});

const cm = { tp: 0, fp: 0, fn: 0, tn: 0 };
const perCat = new Map<string, { tp: number; fp: number; fn: number }>(CATEGORIES.map((c) => [c, { tp: 0, fp: 0, fn: 0 }]));
const errors: string[] = [];
let tokens = 0;

for (const e of examples) {
  const msgs = e.messages.map(toMessage);
  const t = e.target ?? msgs.length - 1;
  const res = await ai.structured({
    model: DEFAULT_SETTINGS.aiModel,
    system: analysisSystemPrompt(topics),
    user: JSON.stringify(analysisPayload(topics, msgs.slice(0, t), [], [msgs[t]])),
    schemaName: 'message_analysis',
    jsonSchema: analysisJsonSchema(topics),
    parse: (raw) => AnalysisResponseSchema.parse(raw),
  });
  tokens += res.usage.inputTokens + res.usage.outputTokens;
  const item = res.data.messages.find((x) => x.message_id === msgs[t].messageId);
  const cats = item?.categories ?? [];
  const sev = (item?.severity ?? 'none') as Severity | 'none';
  const predicted =
    !msgs[t].isStaff && cats.some((c) => rules.categories.includes(c as never)) && severityRank(sev) >= severityRank(rules.minSeverity) && (item?.confidence ?? 0) >= rules.minConfidence;
  const exp = e.expected.alert;
  if (predicted && exp) cm.tp++;
  else if (predicted && !exp) cm.fp++;
  else if (!predicted && exp) cm.fn++;
  else cm.tn++;
  for (const c of CATEGORIES) {
    const want = e.expected.categories?.includes(c) ?? false;
    const got = cats.includes(c as never);
    const s = perCat.get(c)!;
    if (got && want) s.tp++;
    else if (got && !want && e.expected.categories && e.expected.exhaustive !== false) s.fp++;
    else if (!got && want) s.fn++;
  }
  const ok = predicted === exp;
  if (!ok) errors.push(`${e.id}: ожидалось ${exp ? 'алерт' : 'нет'}, получено ${predicted ? 'алерт' : 'нет'} [${cats.join(',')}; ${sev}; ${item?.confidence}] — ${item?.severity_reason ?? ''}`);
  console.log(`${ok ? '✓' : '✗'} ${e.id} [${e.split}] → ${predicted ? 'алерт' : 'нет'} (${cats.join(', ') || '—'}, ${sev}, ${item?.confidence ?? '—'})`);
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
console.log(`\nПромпт ${ANALYSIS_PROMPT_VERSION}, модель ${DEFAULT_SETTINGS.aiModel}, примеров: ${examples.length}, токенов: ${tokens}`);
console.log('Confusion matrix (алерт):');
console.log(`              факт=алерт  факт=нет`);
console.log(`прогноз=алерт ${String(cm.tp).padStart(10)} ${String(cm.fp).padStart(9)}`);
console.log(`прогноз=нет   ${String(cm.fn).padStart(10)} ${String(cm.tn).padStart(9)}`);
console.log(`Полнота: ${pct(cm.tp, cm.tp + cm.fn)} · точность: ${pct(cm.tp, cm.tp + cm.fp)}`);
console.log('\nПо категориям (только примеры с размеченными категориями):');
for (const [c, s] of perCat) if (s.tp + s.fp + s.fn) console.log(`  ${c}: полнота ${pct(s.tp, s.tp + s.fn)}, точность ${pct(s.tp, s.tp + s.fp)} (tp ${s.tp}, fp ${s.fp}, fn ${s.fn})`);
if (errors.length) console.log(`\nОшибки:\n${errors.join('\n')}`);
process.exit(errors.some((x) => x.startsWith('req-')) ? 2 : 0);
