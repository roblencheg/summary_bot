import type { Category, IncidentStatus, Severity } from '~shared/domain';

export interface Incident {
  id: number;
  chatId: number;
  kind: 'problem' | 'spike';
  status: IncidentStatus;
  title: string;
  summary: string;
  topic: string | null;
  categories: Category[];
  severity: Severity;
  severityReason: string | null;
  confidence: number;
  entities: string[];
  authorKey: string | null;
  authorName: string | null;
  affectedAuthors: number;
  messageCount: number;
  repeatType: 'single' | 'author_repeat' | 'multi' | 'mass';
  firstMessageAt: string;
  lastMessageAt: string;
  borderline: boolean;
  resolutionConfirmed: boolean;
  relatedIncidentId: number | null;
  analysisVersion: string | null;
  spikeData: SpikeData | null;
  sourcesDeleted: boolean;
  lastAlertAt: string | null;
  lastAlertSeverity: Severity | null;
  lastAlertCategories: Category[];
  lastAlertAuthors: number | null;
  lastAlertMessageCount: number | null;
  pendingUpdate: boolean;
  statusChangedBy: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpikeData {
  windowStart: string;
  windowEnd: string;
  windowMin: number;
  count: number;
  authors: number;
  baselinePerWindow: number;
  ratio: number | null;
  historyLimited: boolean;
  topics: Array<{ topic: string; count: number }>;
  tones: Array<{ tone: string; count: number }>;
  unanalyzed: number;
}

export interface IncidentEvent {
  id: number;
  incidentId: number;
  at: string;
  kind: string;
  details: Record<string, unknown> | null;
  actor: string | null;
}

export interface NewIncident {
  chatId: number;
  kind: 'problem' | 'spike';
  title: string;
  summary: string;
  topic: string | null;
  categories: Category[];
  severity: Severity;
  severityReason: string | null;
  confidence: number;
  entities: string[];
  authorKey: string | null;
  authorName: string | null;
  firstMessageAt: string;
  lastMessageAt: string;
  relatedIncidentId: number | null;
  analysisVersion: string | null;
  spikeData: SpikeData | null;
}
