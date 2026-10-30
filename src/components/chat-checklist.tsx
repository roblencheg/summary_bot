import type { ChatDto } from '~shared/schemas';
import { Checkbox } from '~/components/ui/form';
import { CHANNELS, CHANNEL_LABELS } from '~shared/domain';

/**
 * Только подключённые чаты (активные или с выключенным сбором) можно назначать.
 * Telegram- и MAX-чаты показываются раздельными группами: получатель получит саммари/алерт
 * только в той поверхности, откуда пришёл чат, — смешанный список визуально это скрывал.
 */
export function ChatChecklist({ chats, value, onChange }: { chats: ChatDto[]; value: number[]; onChange: (ids: number[]) => void }) {
  const assignable = chats.filter((c) => c.status === 'active' || c.status === 'disabled' || value.includes(c.id));
  if (!assignable.length) return <p className="text-sm text-ink-soft">Нет подключённых чатов. Сначала активируйте сбор в разделе «Чаты».</p>;
  const groups = CHANNELS.map((channel) => ({ channel, chats: assignable.filter((c) => c.channel === channel) })).filter((g) => g.chats.length > 0);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.channel}>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.07em] text-ink-soft">{CHANNEL_LABELS[g.channel]}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {g.chats.map((c) => (
              <Checkbox
                key={c.id}
                label={c.title}
                hint={c.status === 'active' ? undefined : 'сбор выключен'}
                checked={value.includes(c.id)}
                onChange={(on) => onChange(on ? [...value, c.id] : value.filter((x) => x !== c.id))}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
