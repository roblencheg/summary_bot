import { z } from 'zod';
import {
  CATEGORIES,
  CHANNELS,
  CHAT_STATUSES,
  DELIVERY_KINDS,
  DELIVERY_STATUSES,
  INCIDENT_STATUSES,
  PERIOD_TYPES,
  RECIPIENT_STATUSES,
  SEVERITIES,
  TONES,
} from './domain';

// Любой API-эндпоинт: zod-схема ответа и входа здесь, ОДНА и ТА ЖЕ на сервере
// (валидация ответа) и на клиенте (валидация полученного JSON).

const iso = z.string();
const isoOrNull = z.string().nullable();
const Category = z.enum(CATEGORIES);
const Severity = z.enum(SEVERITIES);
const ChannelSchema = z.enum(CHANNELS);

export const ChannelInputSchema = z.object({ channel: ChannelSchema });
export type ChannelInput = z.infer<typeof ChannelInputSchema>;

export const OkSchema = z.object({ ok: z.literal(true) });
export const ErrorSchema = z.object({ error: z.string(), details: z.unknown().optional() });

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// --- авторизация ---

export const LoginInputSchema = z.object({
  login: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const ADMIN_ROLES = ['superadmin', 'manager'] as const;
export const IMPORTANCE_LEVELS = ['high', 'normal', 'low'] as const;
export const IMPORTANCE_LABELS: Record<(typeof IMPORTANCE_LEVELS)[number], string> = { high: 'Высокая', normal: 'Обычная', low: 'Низкая' };
export const QUIET_MODES = ['line', 'hide', 'full'] as const;
export const QUIET_MODE_LABELS: Record<(typeof QUIET_MODES)[number], string> = {
  line: 'Одной строкой «Без событий: …»',
  hide: 'Не показывать',
  full: 'Показывать полностью',
};
export const DirectorateRefSchema = z.object({ id: z.number(), name: z.string() });
export type DirectorateRef = z.infer<typeof DirectorateRefSchema>;
export const MeSchema = z.object({
  id: z.number(),
  login: z.string(),
  role: z.enum(ADMIN_ROLES),
  directorates: z.array(DirectorateRefSchema.extend({ quietChats: z.enum(QUIET_MODES) })),
});
export type Me = z.infer<typeof MeSchema>;

export const AuthStatusSchema = z.object({
  authenticated: z.boolean(),
  admin: MeSchema.nullable(),
  bootstrapNeeded: z.boolean(),
});
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

export const LoginResponseSchema = MeSchema.extend({ firstLogin: z.boolean() });
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const AdminSchema = z.object({ id: z.number(), login: z.string(), role: z.enum(ADMIN_ROLES), disabled: z.boolean(), createdAt: iso, lastLoginAt: isoOrNull });
export type AdminDto = z.infer<typeof AdminSchema>;
export const AdminsResponseSchema = z.array(AdminSchema);
export const CreateAdminInputSchema = z.object({ login: z.string().trim().min(3).max(64), password: z.string().min(10).max(200) });
export const AdminPasswordInputSchema = z.object({ password: z.string().min(10).max(200) });
export const AdminDisabledInputSchema = z.object({ disabled: z.boolean() });

// --- правила и настройки ---

export const ChatRulesSchema = z.object({
  categories: z.array(Category).min(1),
  minSeverity: Severity,
  minConfidence: z.number().min(0).max(1),
  cooldownMin: z.number().int().min(1).max(1440),
  repeatCount: z.number().int().min(2).max(100),
  repeatWindowMin: z.number().int().min(1).max(1440),
  authorRepeatHours: z.number().int().min(1).max(168),
  spikeWindowMin: z.number().int().min(1).max(60),
  spikeMinMessages: z.number().int().min(2).max(10000),
  spikeRatio: z.number().min(1).max(100),
  massAuthors: z.number().int().min(2).max(1000),
  massWindowMin: z.number().int().min(1).max(1440),
  historyDays: z.number().int().min(1).max(30),
  noReplyWindowMin: z.number().int().min(1).max(1440),
});
export type ChatRulesDto = z.infer<typeof ChatRulesSchema>;
export const ChatRulesOverrideSchema = ChatRulesSchema.partial();

export const GlobalSettingsSchema = z.object({
  timezone: z.string().min(1),
  dayStart: z.string().regex(/^\d{2}:\d{2}$/),
  nightStart: z.string().regex(/^\d{2}:\d{2}$/),
  aiModel: z.string().min(1).max(100),
  topics: z.array(z.string().trim().min(1).max(60)).min(1).max(40),
  contextWindowHours: z.number().int().min(1).max(168),
  catchupMaxReports: z.number().int().min(0).max(28),
  delayedThresholdMin: z.number().int().min(1).max(1440),
  retentionMessagesDays: z.number().int().min(1).max(3650),
  retentionReportsDays: z.number().int().min(1).max(3650),
  retentionTechDays: z.number().int().min(1).max(3650),
  backupKeep: z.number().int().min(1).max(90),
  rules: ChatRulesSchema,
});
export type GlobalSettingsDto = z.infer<typeof GlobalSettingsSchema>;

export const SettingsResponseSchema = z.object({
  settings: GlobalSettingsSchema,
  defaults: GlobalSettingsSchema,
  secrets: z.array(z.object({ name: z.string(), set: z.boolean() })),
  runtime: z.object({
    telegramMode: z.string(),
    webhookUrl: z.string().nullable(),
    publicBaseUrl: z.string(),
    botUsername: z.string().nullable(),
    botReadsAllGroupMessages: z.boolean().nullable(),
    maxMode: z.string(),
    maxBotUsername: z.string().nullable(),
    aiConfigured: z.boolean(),
    storageConfigured: z.boolean(),
  }),
  backups: z.array(z.string()),
});
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

// --- чаты ---

export const ChatSchema = z.object({
  id: z.number(),
  title: z.string(),
  type: z.string(),
  username: z.string().nullable(),
  isForum: z.boolean(),
  status: z.enum(CHAT_STATUSES),
  collectionStartedAt: isoOrNull,
  lastMessageAt: isoOrNull,
  lastEventAt: isoOrNull,
  botMemberStatus: z.string().nullable(),
  botIsAdmin: z.boolean().nullable(),
  botReadsAll: z.boolean().nullable(),
  rightsCheckedAt: isoOrNull,
  rightsError: z.string().nullable(),
  migratedTo: z.number().nullable(),
  createdAt: iso,
  updatedAt: iso,
  channel: ChannelSchema,
  /** Права текущего пользователя: суперадмин, дирекция-владелец или доступ на чтение. */
  access: z.enum(['super', 'owner', 'reader']),
  /** Дирекция-владелец; null — чат не разобран. */
  ownerDirectorate: DirectorateRefSchema.nullable(),
  /** Важность в саммари для дирекции руководителя; null — суперадмин (задаёт в «Дирекциях»). */
  importance: z.enum(IMPORTANCE_LEVELS).nullable(),
});
export type ChatDto = z.infer<typeof ChatSchema>;
export const ChatsResponseSchema = z.array(ChatSchema);

export const ChatStaffSchema = z.object({ telegramUserId: z.number().int().positive(), label: z.string().max(100).nullable() });
export const ChatStaffInputSchema = z.object({ staff: z.array(ChatStaffSchema).max(200) });

export const GapSchema = z.object({
  id: z.number(),
  chatId: z.number().nullable(),
  startedAt: iso,
  endedAt: isoOrNull,
  reason: z.string(),
  details: z.string().nullable(),
  recovered: z.boolean(),
});
export type GapDto = z.infer<typeof GapSchema>;

export const ChatDetailsSchema = ChatSchema.extend({
  rulesOverride: ChatRulesOverrideSchema,
  effectiveRules: ChatRulesSchema,
  staff: z.array(ChatStaffSchema),
  summaryRecipients: z.array(z.object({ id: z.number(), name: z.string() })),
  alertRecipients: z.array(z.object({ id: z.number(), name: z.string() })),
});
export type ChatDetailsDto = z.infer<typeof ChatDetailsSchema>;

export const MessageSchema = z.object({
  id: z.number(),
  chatId: z.number(),
  messageId: z.number(),
  sentAt: iso,
  receivedAt: iso,
  authorName: z.string(),
  authorUsername: z.string().nullable(),
  authorId: z.number().nullable(),
  identityLimited: z.boolean(),
  isStaff: z.boolean(),
  text: z.string(),
  contentType: z.string(),
  hasText: z.boolean(),
  replyToMessageId: z.number().nullable(),
  threadId: z.number().nullable(),
  editedAt: isoOrNull,
  revisionCount: z.number(),
  link: z.string().nullable(),
  analysisStatus: z.string(),
  analysisError: z.string().nullable(),
  analyzedAt: isoOrNull,
  isRequest: z.boolean().nullable(),
  requestKey: z.string().nullable(),
  topic: z.string().nullable(),
  tone: z.enum(TONES).nullable(),
  categories: z.array(Category),
  severity: z.string().nullable(),
  confidence: z.number().nullable(),
  summary: z.string().nullable(),
  resolutionConfirmed: z.boolean(),
});
export type MessageDto = z.infer<typeof MessageSchema>;
export const MessagesResponseSchema = z.array(MessageSchema);

export const MessageDetailsSchema = z.object({
  message: MessageSchema,
  revisions: z.array(z.object({ editedAt: iso, oldText: z.string(), newText: z.string(), significant: z.boolean() })),
  analysis: z
    .object({ model: z.string(), promptVersion: z.string(), rulesVersion: z.string(), analyzedAt: iso, result: z.unknown(), flags: z.array(z.string()) })
    .nullable(),
});
export type MessageDetailsDto = z.infer<typeof MessageDetailsSchema>;

export const MessagesQuerySchema = PageQuerySchema.extend({ from: z.string().optional(), to: z.string().optional() });

// --- получатели ---

export const RecipientSchema = z.object({
  id: z.number(),
  name: z.string(),
  telegramUserId: z.number().nullable(),
  telegramUsername: z.string().nullable(),
  status: z.enum(RECIPIENT_STATUSES),
  maxUserId: z.number().nullable(),
  maxUsername: z.string().nullable(),
  maxStatus: z.enum(RECIPIENT_STATUSES),
  maxActivatedAt: isoOrNull,
  maxBlockedAt: isoOrNull,
  isTechAdmin: z.boolean(),
  summaryDay: z.boolean(),
  summaryNight: z.boolean(),
  alertCategories: z.array(Category),
  alertMinSeverity: Severity,
  activatedAt: isoOrNull,
  blockedAt: isoOrNull,
  lastDeliveryAt: isoOrNull,
  lastDeliveryStatus: z.string().nullable(),
  createdAt: iso,
  updatedAt: iso,
  summaryChatIds: z.array(z.number()),
  alertChatIds: z.array(z.number()),
  directorateIds: z.array(z.number()),
});
export type RecipientDto = z.infer<typeof RecipientSchema>;
export const RecipientsResponseSchema = z.array(RecipientSchema);

export const CreateRecipientInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  isTechAdmin: z.boolean().default(false),
  /** Дирекция получателя; по умолчанию — первая своя (руководитель) или первая в системе (суперадмин). */
  directorateId: z.number().int().optional(),
});
export type CreateRecipientInput = z.infer<typeof CreateRecipientInputSchema>;

export const UpdateRecipientInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isTechAdmin: z.boolean().optional(),
  summaryDay: z.boolean().optional(),
  summaryNight: z.boolean().optional(),
  alertCategories: z.array(Category).min(1).optional(),
  alertMinSeverity: Severity.optional(),
});
export type UpdateRecipientInput = z.infer<typeof UpdateRecipientInputSchema>;

export const SendMenuResponseSchema = z.object({ queued: z.number() });
export type SendMenuResponse = z.infer<typeof SendMenuResponseSchema>;

export const RecipientEnabledInputSchema = z.object({ enabled: z.boolean() });

export const SubscriptionsInputSchema = z.object({ chatIds: z.array(z.number().int()).max(500) });
export type SubscriptionsInput = z.infer<typeof SubscriptionsInputSchema>;

export const BindingCodeSchema = z.object({ code: z.string(), link: z.string().nullable(), expiresAt: iso, channel: ChannelSchema });
export type BindingCodeDto = z.infer<typeof BindingCodeSchema>;

// --- инциденты ---

const SpikeDataSchema = z.object({
  windowStart: iso,
  windowEnd: iso,
  windowMin: z.number(),
  count: z.number(),
  authors: z.number(),
  baselinePerWindow: z.number(),
  ratio: z.number().nullable(),
  historyLimited: z.boolean(),
  topics: z.array(z.object({ topic: z.string(), count: z.number() })),
  tones: z.array(z.object({ tone: z.string(), count: z.number() })),
  unanalyzed: z.number(),
});

export const IncidentSchema = z.object({
  id: z.number(),
  chatId: z.number(),
  kind: z.enum(['problem', 'spike']),
  status: z.enum(INCIDENT_STATUSES),
  title: z.string(),
  summary: z.string(),
  topic: z.string().nullable(),
  categories: z.array(Category),
  severity: Severity,
  severityReason: z.string().nullable(),
  confidence: z.number(),
  entities: z.array(z.string()),
  authorName: z.string().nullable(),
  affectedAuthors: z.number(),
  messageCount: z.number(),
  repeatType: z.enum(['single', 'author_repeat', 'multi', 'mass']),
  firstMessageAt: iso,
  lastMessageAt: iso,
  borderline: z.boolean(),
  resolutionConfirmed: z.boolean(),
  relatedIncidentId: z.number().nullable(),
  analysisVersion: z.string().nullable(),
  spikeData: SpikeDataSchema.nullable(),
  sourcesDeleted: z.boolean(),
  lastAlertAt: isoOrNull,
  pendingUpdate: z.boolean(),
  statusChangedBy: z.string().nullable(),
  statusChangedAt: isoOrNull,
  createdAt: iso,
});
export type IncidentDto = z.infer<typeof IncidentSchema>;

export const IncidentListSchema = z.object({ items: z.array(IncidentSchema), total: z.number(), topics: z.array(z.string()) });
export type IncidentListDto = z.infer<typeof IncidentListSchema>;

export const IncidentQuerySchema = PageQuerySchema.extend({
  chatId: z.coerce.number().int().optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  minSeverity: Severity.optional(),
  topic: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  borderline: z.enum(['true', 'false']).optional(),
  kind: z.enum(['problem', 'spike']).optional(),
});

export const IncidentDetailsSchema = z.object({
  incident: IncidentSchema,
  messages: z.array(MessageSchema),
  events: z.array(z.object({ id: z.number(), at: iso, kind: z.string(), details: z.record(z.string(), z.unknown()).nullable(), actor: z.string().nullable() })),
  feedback: z.array(z.object({ recipientId: z.number(), verdict: z.string(), analysisVersion: z.string().nullable(), createdAt: iso })),
  deliveries: z.array(z.lazy(() => DeliveryJobSchema)),
});
export type IncidentDetailsDto = z.infer<typeof IncidentDetailsSchema>;

export const IncidentStatusInputSchema = z.object({ status: z.enum(INCIDENT_STATUSES) });

// --- отчёты ---

export const PeriodSchema = z.object({
  id: z.number(),
  periodType: z.enum(PERIOD_TYPES),
  startsAt: iso,
  endsAt: iso,
  status: z.string(),
  error: z.string().nullable(),
  createdAt: iso,
});
export const PeriodsResponseSchema = z.array(PeriodSchema);

export const ReportSchema = z.object({
  id: z.number(),
  recipientId: z.number(),
  periodId: z.number(),
  periodType: z.enum(PERIOD_TYPES),
  startsAt: iso,
  endsAt: iso,
  version: z.number(),
  manual: z.boolean(),
  status: z.string(),
  chatIds: z.array(z.number()),
  parts: z.array(z.string()),
  fullText: z.string().nullable(),
  /** Саммари в формате rich message Telegram (заголовки, таблицы, сворачиваемые разделы). */
  richHtml: z.string().nullable(),
  delayed: z.boolean(),
  createdAt: iso,
  builtAt: isoOrNull,
  sentAt: isoOrNull,
  /** MAX не умеет rich message — параллельный, более простой набор по каналу MAX на той же строке. */
  maxStatus: z.string(),
  maxChatIds: z.array(z.number()),
  maxParts: z.array(z.string()),
  maxFullText: z.string().nullable(),
  maxBuiltAt: isoOrNull,
  maxSentAt: isoOrNull,
});
export type ReportDto = z.infer<typeof ReportSchema>;
export const ReportListSchema = z.object({ items: z.array(ReportSchema), total: z.number() });

const DigestRequestSchema = z.object({
  requestKey: z.string(),
  authorName: z.string(),
  identityLimited: z.boolean(),
  summary: z.string(),
  topic: z.string(),
  severity: z.string(),
  messages: z.number(),
  repeats: z.number(),
  status: z.enum(['resolved', 'answered', 'no_reply', 'unknown']),
  firstMessageId: z.number(),
  firstMessagePk: z.number(),
  link: z.string().nullable(),
  sentAt: iso,
  score: z.number(),
});

export const ReportDetailsSchema = z.object({
  report: ReportSchema,
  digests: z.array(
    z.object({
      // в отчёте нужны только id, название и канал: права и важность чата здесь не вычисляются
      chat: ChatSchema.pick({ id: true, title: true, channel: true }),
      digest: z.object({
        version: z.number(),
        createdAt: iso,
        stats: z.object({
          messages: z.number(),
          authors: z.number(),
          unidentified: z.number(),
          attachmentsNoText: z.number(),
          requests: z.number(),
          repeatedRequests: z.number(),
          riskSignals: z.number(),
          classifiedRequests: z.number(),
          unanalyzed: z.number(),
          topics: z.array(z.object({ topic: z.string(), count: z.number() })),
          tones: z.array(z.object({ tone: z.string(), count: z.number() })),
        }),
        content: z.object({
          overview: z.array(z.object({ text: z.string(), evidence: z.array(z.number()) })),
          toneReasons: z.array(z.object({ text: z.string(), evidence: z.array(z.number()) })),
          attention: z.array(z.object({ text: z.string(), evidence: z.array(z.number()) })),
          requests: z.array(DigestRequestSchema),
          gaps: z.array(z.object({ startedAt: iso, endedAt: isoOrNull, reason: z.string() })),
          staffConfigured: z.boolean(),
          aiAvailable: z.boolean(),
        }),
      }),
    }),
  ),
});
export type ReportDetailsDto = z.infer<typeof ReportDetailsSchema>;

export const ReportQuerySchema = PageQuerySchema.extend({
  recipientId: z.coerce.number().int().optional(),
  periodId: z.coerce.number().int().optional(),
});

export const ManualReportInputSchema = z.object({
  recipientId: z.number().int(),
  periodType: z.enum(PERIOD_TYPES),
  /** любой момент внутри нужного периода или сразу после него (ISO) */
  anchor: z.string(),
});
export type ManualReportInput = z.infer<typeof ManualReportInputSchema>;

// --- доставка ---

export const DeliveryJobSchema = z.object({
  id: z.number(),
  recipientId: z.number(),
  kind: z.enum(DELIVERY_KINDS),
  channel: ChannelSchema,
  incidentId: z.number().nullable(),
  reportId: z.number().nullable(),
  chatId: z.number().nullable(),
  status: z.enum(DELIVERY_STATUSES),
  statusReason: z.string().nullable(),
  attempts: z.number(),
  partsSent: z.number(),
  uncertain: z.boolean(),
  manualRetry: z.boolean(),
  nextAttemptAt: iso,
  lastError: z.string().nullable(),
  triggerAt: isoOrNull,
  sourceSentAt: isoOrNull,
  sourceReceivedAt: isoOrNull,
  analyzedAt: isoOrNull,
  createdAt: iso,
  sentAt: isoOrNull,
});
export type DeliveryJobDto = z.infer<typeof DeliveryJobSchema>;
export const DeliveryListSchema = z.object({ items: z.array(DeliveryJobSchema), total: z.number() });

export const DeliveryQuerySchema = PageQuerySchema.extend({
  recipientId: z.coerce.number().int().optional(),
  kind: z.enum(DELIVERY_KINDS).optional(),
  status: z.enum(DELIVERY_STATUSES).optional(),
  incidentId: z.coerce.number().int().optional(),
  reportId: z.coerce.number().int().optional(),
});

export const DeliveryDetailsSchema = z.object({
  job: DeliveryJobSchema,
  attempts: z.array(
    z.object({
      id: z.number(),
      at: iso,
      part: z.number(),
      ok: z.boolean(),
      uncertain: z.boolean(),
      httpStatus: z.number().nullable(),
      errorCode: z.string().nullable(),
      error: z.string().nullable(),
      telegramMessageId: z.number().nullable(),
      durationMs: z.number().nullable(),
    }),
  ),
});
export type DeliveryDetailsDto = z.infer<typeof DeliveryDetailsSchema>;

export const TestDeliveryInputSchema = z.object({ recipientId: z.number().int(), channel: ChannelSchema });

// --- аудит ---

export const AuditListSchema = z.object({
  items: z.array(
    z.object({
      id: z.number(),
      at: iso,
      actor: z.string(),
      action: z.string(),
      entity: z.string(),
      entityId: z.string().nullable(),
      oldValue: z.unknown(),
      newValue: z.unknown(),
    }),
  ),
  total: z.number(),
});
export type AuditListDto = z.infer<typeof AuditListSchema>;
export const AuditQuerySchema = PageQuerySchema.extend({ entity: z.string().optional(), actor: z.string().optional() });

// --- обзор и здоровье ---

const nullableNum = z.number().nullable();

export const OverviewSchema = z.object({
  generatedAt: iso,
  hours: z.number(),
  service: z.object({
    startedAt: iso,
    heartbeats: z.record(z.string(), z.number()),
    staleWorkers: z.array(z.string()),
    telegramConfigured: z.boolean(),
    intake: z.object({
      mode: z.string(),
      webhookUrl: z.string().nullable(),
      webhookRegisteredAt: isoOrNull,
      pendingUpdateCount: nullableNum,
      lastErrorAt: isoOrNull,
      lastErrorMessage: z.string().nullable(),
      failingSince: isoOrNull,
      lastOkAt: isoOrNull,
    }),
    bot: z.object({ lastGetMeOkAt: isoOrNull, username: z.string().nullable(), readsAll: z.boolean().nullable(), error: z.string().nullable() }),
    maxConfigured: z.boolean(),
    maxIntake: z.object({
      mode: z.string(),
      lastErrorAt: isoOrNull,
      lastErrorMessage: z.string().nullable(),
      failingSince: isoOrNull,
      lastOkAt: isoOrNull,
    }),
    maxBot: z.object({ lastGetMeOkAt: isoOrNull, username: z.string().nullable(), error: z.string().nullable() }),
    ai: z.object({ configured: z.boolean(), lastOkAt: isoOrNull, failingSince: isoOrNull, lastError: z.string().nullable() }),
    dbSizeBytes: nullableNum,
  }),
  messages: z.object({
    messages: z.number(),
    chats: z.number(),
    authors: z.number(),
    peakPerMinute: z.number(),
    perChat: z.array(z.object({ chatId: z.number(), n: z.number() })),
  }),
  chats: z.array(z.object({ status: z.string(), n: z.number() })),
  recipients: z.array(z.object({ status: z.string(), n: z.number() })),
  analysis: z.object({
    pending: z.number(),
    failed: z.number(),
    oldestPendingAt: isoOrNull,
    usage: z.object({ calls: z.number(), failed: z.number(), inputTokens: z.number(), outputTokens: z.number(), avgMs: z.number() }),
  }),
  intakeQueue: z.object({ pending: z.number(), failed: z.number(), oldestPendingAt: isoOrNull }),
  delivery: z.object({
    pending: z.number(),
    failed: z.number(),
    oldestPendingAt: isoOrNull,
    uncertain: z.number(),
    latency: z.object({
      alerts: z.number(),
      avgTelegramToReceive: nullableNum,
      avgReceiveToAnalyze: nullableNum,
      avgReceiveToSent: nullableNum,
      maxReceiveToSent: nullableNum,
    }),
    summaryLatency: z.object({ reports: z.number(), avgAfterBoundary: nullableNum, maxAfterBoundary: nullableNum }),
    byStatus: z.array(z.object({ status: z.string(), n: z.number() })),
  }),
  incidents: z.object({ open: z.number(), newCount: z.number(), borderline: z.number(), incidents: z.number(), repeats: z.number(), spikes: z.number() }),
  feedback: z.object({ useful: z.number(), falsePositive: z.number(), falseShare: nullableNum }),
  gaps: z.array(GapSchema),
});
export type OverviewDto = z.infer<typeof OverviewSchema>;

export const HealthSchema = z.object({ status: z.literal('ok'), uptimeSec: z.number() });
export const ReadySchema = z.object({ ready: z.boolean(), components: z.record(z.string(), z.object({ ok: z.boolean(), detail: z.string().optional() })) });

// --- Telegram webhook (вход от Telegram; полная структура апдейта разбирается на сервере) ---
export const TelegramUpdateSchema = z.object({ update_id: z.number().int() }).passthrough();
export const MaxUpdateSchema = z.object({ update_type: z.string(), timestamp: z.number() }).passthrough();
export const OverviewQuerySchema = z.object({ hours: z.coerce.number().int().min(1).max(24 * 30).default(24) });
export const RequeueInputSchema = z.object({ chatId: z.number().int().nullable() });
export const RequeueResponseSchema = z.object({ requeued: z.number() });
export const BackupResponseSchema = z.object({ prefix: z.string() });

// --- контекст интерфейса (доступен всем ролям) ---

/** Минимум общих настроек для отображения: часовой пояс, расписание, бот, правила по умолчанию. */
export const AppContextSchema = z.object({
  timezone: z.string(),
  dayStart: z.string(),
  nightStart: z.string(),
  botUsername: z.string().nullable(),
  maxBotUsername: z.string().nullable(),
  defaultRules: ChatRulesSchema,
});
export type AppContextDto = z.infer<typeof AppContextSchema>;

// --- дирекции ---

export const DirectoratesOverviewSchema = z.object({
  directorates: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      managerIds: z.array(z.number()),
      quietChats: z.enum(QUIET_MODES),
      chats: z.array(
        z.object({ chatId: z.number(), title: z.string(), channel: ChannelSchema, status: z.enum(CHAT_STATUSES), access: z.enum(['owner', 'reader']), importance: z.enum(IMPORTANCE_LEVELS) }),
      ),
      recipients: z.number(),
    }),
  ),
  managers: z.array(
    z.object({ id: z.number(), login: z.string(), disabled: z.boolean(), lastLoginAt: isoOrNull, directorateIds: z.array(z.number()) }),
  ),
  unassigned: z.array(z.object({ id: z.number(), title: z.string(), channel: ChannelSchema, status: z.enum(CHAT_STATUSES) })),
});
export type DirectoratesOverviewDto = z.infer<typeof DirectoratesOverviewSchema>;

export const DirectorateNameInputSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const CreateManagerInputSchema = z.object({
  login: z.string().trim().min(3).max(64),
  password: z.string().min(10).max(200),
  directorateIds: z.array(z.number().int()).max(50),
});
export const DirectorateIdsInputSchema = z.object({ directorateIds: z.array(z.number().int()).max(50) });
export const ChatAccessInputSchema = z.object({ directorateId: z.number().int(), access: z.enum(['owner', 'reader']).nullable() });
export const ClaimLinkInputSchema = z.object({ directorateId: z.number().int().optional(), channel: ChannelSchema.default('telegram') });
export const ClaimLinkSchema = z.object({ link: z.string().nullable(), code: z.string(), expiresAt: iso, directorate: z.string(), channel: ChannelSchema });
export type ClaimLinkDto = z.infer<typeof ClaimLinkSchema>;
export const ChatImportanceInputSchema = z.object({ importance: z.enum(IMPORTANCE_LEVELS), directorateId: z.number().int().optional() });
export const QuietChatsInputSchema = z.object({ quietChats: z.enum(QUIET_MODES) });
