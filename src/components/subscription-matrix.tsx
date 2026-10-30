import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '~/components/ui/button';
import { Card, CardHeader } from '~/components/ui/card';
import { Empty, Loading, useToast } from '~/components/ui/feedback';
import { Table, Td, Th } from '~/components/ui/table';
import { RecipientStatusBadge } from '~/components/domain-badges';
import { useChats } from '~/hooks/use-chats';
import { useRecipientMutations, useRecipients } from '~/hooks/use-recipients';
import { cn } from '~/lib/utils';
import { CHANNEL_LABELS, CHANNELS } from '~shared/domain';

/**
 * Матрица «получатель × чат» для одного вида подписки. Изменения копятся локально,
 * «Сохранить» отправляет только изменённые строки и подтверждает результат.
 */
export function SubscriptionMatrix({ kind }: { kind: 'summary' | 'alert' }) {
  const recipients = useRecipients();
  const chats = useChats();
  const m = useRecipientMutations();
  const toast = useToast();
  const field = kind === 'summary' ? 'summaryChatIds' : 'alertChatIds';
  const server = useMemo(() => new Map((recipients.data ?? []).map((r) => [r.id, r[field]])), [recipients.data, field]);
  const [draft, setDraft] = useState<Map<number, number[]>>(new Map());
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(new Map(server)), [server]);

  const active = (chats.data ?? []).filter((c) => c.status === 'active' || c.status === 'disabled');
  // чёткое разделение поверхностей: Telegram-чаты и MAX-чаты — отдельными группами колонок, а не вперемешку
  const groups = CHANNELS.map((channel) => ({ channel, chats: active.filter((c) => c.channel === channel) })).filter((g) => g.chats.length > 0);
  const cols = groups.flatMap((g) => g.chats);
  const changed = [...draft].filter(([id, ids]) => JSON.stringify([...ids].sort()) !== JSON.stringify([...(server.get(id) ?? [])].sort()));

  const toggle = (rid: number, cid: number) => {
    setDraft((d) => {
      const next = new Map(d);
      const cur = next.get(rid) ?? [];
      next.set(rid, cur.includes(cid) ? cur.filter((x) => x !== cid) : [...cur, cid]);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const [id, chatIds] of changed) await m.setSubscriptions.mutateAsync({ id, kind, chatIds });
      toast(`Сохранено: ${changed.length} ${changed.length === 1 ? 'получатель' : 'получателя(ей)'}`);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setSaving(false);
    }
  };

  const accent = kind === 'summary' ? 'bg-info text-white border-info' : 'bg-signal text-white border-signal';

  return (
    <Card className="animate-rise">
      <CardHeader
        title={kind === 'summary' ? 'Назначения саммари' : 'Назначения алертов'}
        hint="Отметьте чаты для каждого получателя. Назначения саммари и алертов не зависят друг от друга."
        actions={
          <>
            {changed.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(new Map(server))}>
                Отменить
              </Button>
            )}
            <Button size="sm" disabled={!changed.length} loading={saving} onClick={save}>
              Сохранить {changed.length ? `(${changed.length})` : ''}
            </Button>
          </>
        }
      />
      {recipients.isLoading || chats.isLoading ? (
        <Loading />
      ) : !recipients.data?.length ? (
        <Empty title="Нет получателей" hint="Создайте получателей в разделе «Пользователи»." />
      ) : !cols.length ? (
        <Empty title="Нет подключённых чатов" hint="Активируйте сбор хотя бы в одном чате." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th rowSpan={2}>Получатель</Th>
              {groups.map((g) => (
                <Th key={g.channel} colSpan={g.chats.length} className="border-l border-l-line-strong text-center normal-case tracking-normal">
                  {CHANNEL_LABELS[g.channel]}
                </Th>
              ))}
            </tr>
            <tr>
              {groups.map((g) =>
                g.chats.map((c, i) => (
                  <Th key={c.id} className={cn('min-w-28 text-center normal-case tracking-normal', i === 0 && 'border-l border-l-line-strong')}>
                    {c.title}
                  </Th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {recipients.data.map((r) => {
              const ids = draft.get(r.id) ?? [];
              return (
                <tr key={r.id} className="hover:bg-sunken/40">
                  <Td>
                    <Link to={`/users/${r.id}`} className="font-semibold hover:text-signal">
                      {r.name}
                    </Link>
                    <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
                      <span className="flex items-center gap-1">
                        <span className="text-ink-mute">Tg:</span> <RecipientStatusBadge status={r.status} />
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="text-ink-mute">MAX:</span> <RecipientStatusBadge status={r.maxStatus} />
                      </span>
                    </div>
                  </Td>
                  {groups.map((g) =>
                    g.chats.map((c, i) => {
                      const on = ids.includes(c.id);
                      return (
                        <Td key={c.id} className={cn('text-center align-middle', i === 0 && 'border-l border-l-line-strong')}>
                          <button
                            type="button"
                            aria-pressed={on}
                            aria-label={`${r.name} — ${c.title}`}
                            onClick={() => toggle(r.id, c.id)}
                            className={cn(
                              'grid size-8 cursor-pointer place-items-center rounded-lg border text-sm font-bold transition-colors mx-auto',
                              on ? accent : 'border-line-strong bg-surface text-transparent hover:border-ink-mute',
                            )}
                          >
                            ✓
                          </button>
                        </Td>
                      );
                    }),
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
