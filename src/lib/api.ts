import type { z, ZodType } from 'zod';
import {
  AppContextSchema,
  ClaimLinkSchema,
  DirectoratesOverviewSchema,
  AdminsResponseSchema,
  AuditListSchema,
  AuthStatusSchema,
  BackupResponseSchema,
  BindingCodeSchema,
  ChatDetailsSchema,
  ChatSchema,
  ChatsResponseSchema,
  DeliveryDetailsSchema,
  DeliveryJobSchema,
  DeliveryListSchema,
  IncidentDetailsSchema,
  IncidentListSchema,
  IncidentSchema,
  LoginResponseSchema,
  MeSchema,
  MessageDetailsSchema,
  MessagesResponseSchema,
  OkSchema,
  OverviewSchema,
  PeriodsResponseSchema,
  RecipientSchema,
  RecipientsResponseSchema,
  ReportDetailsSchema,
  ReportListSchema,
  ReportSchema,
  RequeueResponseSchema,
  SendMenuResponseSchema,
  SettingsResponseSchema,
  type ChatRulesDto,
  type CreateRecipientInput,
  type GlobalSettingsDto,
  type LoginInput,
  type ManualReportInput,
  type UpdateRecipientInput,
} from '~shared/schemas';
import type { Channel, IncidentStatus } from '~shared/domain';

/**
 * Типизированный API-клиент. Каждый ответ валидируется той же zod-схемой, что и на сервере.
 * Не-2xx → ApiError (message — текст ошибки сервера), 401 → событие «нужен вход».
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const UNAUTHORIZED_EVENT = 'api:unauthorized';

async function request<S extends ZodType>(path: string, schema: S, init?: RequestInit): Promise<z.infer<S>> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, body?.error ?? `Ошибка ${res.status}`, body);
  }
  return schema.parse(await res.json());
}

function send<S extends ZodType>(method: string, path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
  return request(path, schema, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export type IncidentFilters = {
  chatId?: number;
  status?: IncidentStatus;
  minSeverity?: string;
  topic?: string;
  from?: string;
  to?: string;
  borderline?: 'true' | 'false';
  kind?: 'problem' | 'spike';
  limit?: number;
  offset?: number;
};

export type DeliveryFilters = { recipientId?: number; kind?: string; status?: string; incidentId?: number; limit?: number; offset?: number };

export const api = {
  auth: {
    status: () => request('/api/auth/status', AuthStatusSchema),
    login: (input: LoginInput) => send('POST', '/api/auth/login', LoginResponseSchema, input),
    logout: () => send('POST', '/api/auth/logout', OkSchema),
  },
  admins: {
    list: () => request('/api/admins', AdminsResponseSchema),
    create: (login: string, password: string) => send('POST', '/api/admins', OkSchema, { login, password }),
    password: (id: number, password: string) => send('POST', `/api/admins/${id}/password`, OkSchema, { password }),
    setDisabled: (id: number, disabled: boolean) => send('POST', `/api/admins/${id}/disabled`, OkSchema, { disabled }),
  },
  overview: (hours: number) => request(`/api/overview${qs({ hours })}`, OverviewSchema),
  context: () => request('/api/context', AppContextSchema),
  directorates: {
    overview: () => request('/api/directorates', DirectoratesOverviewSchema),
    create: (name: string) => send('POST', '/api/directorates', OkSchema, { name }),
    rename: (id: number, name: string) => send('PATCH', `/api/directorates/${id}`, OkSchema, { name }),
    createManager: (login: string, password: string, directorateIds: number[]) =>
      send('POST', '/api/directorates/managers', OkSchema, { login, password, directorateIds }),
    setManagerDirectorates: (id: number, directorateIds: number[]) => send('PUT', `/api/directorates/managers/${id}`, OkSchema, { directorateIds }),
    setQuietChats: (id: number, quietChats: 'line' | 'hide' | 'full') => send('PUT', `/api/directorate-settings/${id}`, OkSchema, { quietChats }),
    setChatAccess: (chatId: number, directorateId: number, access: 'owner' | 'reader' | null) =>
      send('PUT', `/api/chats/${chatId}/access`, OkSchema, { directorateId, access }),
  },
  chats: {
    list: () => request('/api/chats', ChatsResponseSchema),
    get: (id: number) => request(`/api/chats/${id}`, ChatDetailsSchema),
    activate: (id: number) => send('POST', `/api/chats/${id}/activate`, ChatSchema),
    claimLink: (directorateId: number | undefined, channel: Channel) => send('POST', '/api/chats/claim-link', ClaimLinkSchema, { directorateId, channel }),
    setImportance: (id: number, importance: 'high' | 'normal' | 'low', directorateId?: number) =>
      send('PUT', `/api/chats/${id}/importance`, ChatDetailsSchema, { importance, directorateId }),
    deactivate: (id: number) => send('POST', `/api/chats/${id}/deactivate`, ChatSchema),
    checkRights: (id: number) => send('POST', `/api/chats/${id}/check-rights`, ChatSchema),
    setStaff: (id: number, staff: Array<{ telegramUserId: number; label: string | null }>) =>
      send('PUT', `/api/chats/${id}/staff`, ChatDetailsSchema, { staff }),
    setRules: (id: number, rules: Partial<ChatRulesDto>) => send('PUT', `/api/chats/${id}/rules`, ChatDetailsSchema, rules),
    messages: (id: number, offset = 0) => request(`/api/chats/${id}/messages${qs({ limit: 50, offset })}`, MessagesResponseSchema),
  },
  messages: {
    get: (id: number) => request(`/api/messages/${id}`, MessageDetailsSchema),
    failed: () => request('/api/messages/failed?limit=100', MessagesResponseSchema),
    requeue: (chatId: number | null) => send('POST', '/api/analysis/requeue', RequeueResponseSchema, { chatId }),
  },
  recipients: {
    list: () => request('/api/recipients', RecipientsResponseSchema),
    get: (id: number) => request(`/api/recipients/${id}`, RecipientSchema),
    create: (input: CreateRecipientInput) => send('POST', '/api/recipients', RecipientSchema, input),
    update: (id: number, input: UpdateRecipientInput) => send('PATCH', `/api/recipients/${id}`, RecipientSchema, input),
    setEnabled: (id: number, enabled: boolean) => send('POST', `/api/recipients/${id}/enabled`, RecipientSchema, { enabled }),
    issueCode: (id: number, channel: Channel) => send('POST', `/api/recipients/${id}/code`, BindingCodeSchema, { channel }),
    resetBinding: (id: number, channel: Channel) => send('POST', `/api/recipients/${id}/reset-binding`, RecipientSchema, { channel }),
    remove: (id: number) => send('DELETE', `/api/recipients/${id}`, OkSchema),
    sendMenu: (id: number, channel: Channel) => send('POST', `/api/recipients/${id}/menu`, SendMenuResponseSchema, { channel }),
    sendMenuAll: (channel: Channel) => send('POST', '/api/recipients/menu', SendMenuResponseSchema, { channel }),
    setDirectorates: (id: number, directorateIds: number[]) => send('PUT', `/api/recipients/${id}/directorates`, RecipientSchema, { directorateIds }),
    setSubscriptions: (id: number, kind: 'summary' | 'alert', chatIds: number[]) =>
      send('PUT', `/api/recipients/${id}/subscriptions/${kind}`, RecipientSchema, { chatIds }),
  },
  incidents: {
    list: (f: IncidentFilters) => request(`/api/incidents${qs(f)}`, IncidentListSchema),
    get: (id: number) => request(`/api/incidents/${id}`, IncidentDetailsSchema),
    setStatus: (id: number, status: IncidentStatus) => send('POST', `/api/incidents/${id}/status`, IncidentSchema, { status }),
  },
  reports: {
    list: (f: { recipientId?: number; periodId?: number; limit?: number; offset?: number }) => request(`/api/reports${qs(f)}`, ReportListSchema),
    get: (id: number) => request(`/api/reports/${id}`, ReportDetailsSchema),
    manual: (input: ManualReportInput) => send('POST', '/api/reports/manual', ReportSchema, input),
    periods: () => request('/api/periods?limit=50', PeriodsResponseSchema),
    rebuild: (periodId: number) => send('POST', `/api/periods/${periodId}/rebuild`, OkSchema),
  },
  deliveries: {
    list: (f: DeliveryFilters) => request(`/api/deliveries${qs(f)}`, DeliveryListSchema),
    get: (id: number) => request(`/api/deliveries/${id}`, DeliveryDetailsSchema),
    retry: (id: number) => send('POST', `/api/deliveries/${id}/retry`, DeliveryJobSchema),
    test: (recipientId: number, channel: Channel) => send('POST', '/api/deliveries/test', OkSchema, { recipientId, channel }),
  },
  settings: {
    get: () => request('/api/settings', SettingsResponseSchema),
    save: (s: GlobalSettingsDto) => send('PUT', '/api/settings', SettingsResponseSchema, s),
    backup: () => send('POST', '/api/settings/backup', BackupResponseSchema),
  },
  audit: (f: { entity?: string; actor?: string; limit?: number; offset?: number }) => request(`/api/audit${qs(f)}`, AuditListSchema),
};

/** Бинарный поток, не JSON-эндпоинт — используется напрямую как src у <video>. */
export const GUIDE_VIDEO_URL = '/api/guide-video';
