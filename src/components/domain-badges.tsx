import { Badge, type Tone } from '~/components/ui/badge';
import {
  CATEGORY_LABELS,
  CHAT_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  INCIDENT_STATUS_LABELS,
  RECIPIENT_STATUS_LABELS,
  SEVERITY_LABELS,
  type Category,
  type ChatStatus,
  type DeliveryStatus,
  type IncidentStatus,
  type RecipientStatus,
  type Severity,
} from '~shared/domain';

const severityTone: Record<Severity, Tone> = { info: 'info', attention: 'signal', high: 'danger', critical: 'dark' };
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge tone={severityTone[severity]} dot>
      {SEVERITY_LABELS[severity]}
    </Badge>
  );
}

export function CategoryChips({ categories }: { categories: Category[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {categories.map((c) => (
        <span key={c} className="rounded-md bg-sunken px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-soft">
          {CATEGORY_LABELS[c]}
        </span>
      ))}
    </span>
  );
}

const chatTone: Record<ChatStatus, Tone> = { pending: 'signal', active: 'ok', disabled: 'neutral', removed: 'danger', migrated: 'neutral' };
export function ChatStatusBadge({ status }: { status: ChatStatus }) {
  return (
    <Badge tone={chatTone[status]} dot>
      {CHAT_STATUS_LABELS[status]}
    </Badge>
  );
}

const recipientTone: Record<RecipientStatus, Tone> = { pending: 'signal', active: 'ok', blocked: 'danger', disabled: 'neutral' };
export function RecipientStatusBadge({ status }: { status: RecipientStatus }) {
  return (
    <Badge tone={recipientTone[status]} dot>
      {RECIPIENT_STATUS_LABELS[status]}
    </Badge>
  );
}

const incidentTone: Record<IncidentStatus, Tone> = { new: 'signal', seen: 'info', closed: 'ok', false_positive: 'neutral' };
export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return <Badge tone={incidentTone[status]}>{INCIDENT_STATUS_LABELS[status]}</Badge>;
}

const deliveryTone: Record<DeliveryStatus, Tone> = {
  pending: 'info',
  retry: 'signal',
  sending: 'info',
  sent: 'ok',
  failed: 'danger',
  blocked: 'danger',
  not_activated: 'signal',
  cancelled: 'neutral',
};
export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return <Badge tone={deliveryTone[status]}>{DELIVERY_STATUS_LABELS[status]}</Badge>;
}
