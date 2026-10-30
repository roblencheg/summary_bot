import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '~/components/layout/page';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { Empty, ErrorNote, Loading, useToast } from '~/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '~/components/ui/form';
import { Table, Td, Th, Tr } from '~/components/ui/table';
import { RecipientStatusBadge } from '~/components/domain-badges';
import { useRecipientMutations, useRecipients } from '~/hooks/use-recipients';
import { useChats } from '~/hooks/use-chats';
import { useMe } from '~/hooks/use-auth';
import { useDirectorates } from '~/hooks/use-directorates';
import { ago } from '~/lib/format';
import { CHANNELS, CHANNEL_LABELS, DELIVERY_STATUS_LABELS, type DeliveryStatus } from '~shared/domain';

export function UsersPage() {
  const { data, isLoading, error } = useRecipients();
  const chats = useChats();
  const m = useRecipientMutations();
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [tech, setTech] = useState(false);
  const [directorateId, setDirectorateId] = useState('');
  const { me, isSuper } = useMe();
  const all = useDirectorates(isSuper);
  const dirs = isSuper ? (all.data?.directorates ?? []) : (me?.directorates ?? []);
  const dirName = (id: number) => dirs.find((d) => d.id === id)?.name;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await m.create.mutateAsync({ name, isTechAdmin: isSuper && tech, directorateId: directorateId ? Number(directorateId) : undefined });
      toast(`Пользователь «${r.name}» создан`);
      nav(`/users/${r.id}`);
    } catch (err) {
      toast((err as Error).message, 'danger');
    }
  };

  const activeChats = chats.data?.filter((c) => c.status === 'active' || c.status === 'disabled') ?? [];
  const chatGroups = CHANNELS.map((channel) => ({ channel, chats: activeChats.filter((c) => c.channel === channel) })).filter((g) => g.chats.length > 0);

  return (
    <>
      <PageHeader
        eyebrow="03 · Пользователи"
        title="Получатели уведомлений"
        description="Создайте запись, выдайте одноразовую ссылку привязки — после запуска бота по ней пользователь станет активным и получит закреплённое меню. Username не используется для доступа."
        actions={
          isSuper && (
            <div className="flex gap-2">
              {(['telegram', 'max'] as const).map((channel) => (
                <Button
                  key={channel}
                  variant="secondary"
                  loading={m.sendMenuAll.isPending}
                  onClick={async () => {
                    if (!confirm(`Отправить меню бота всем активным в ${CHANNEL_LABELS[channel]} получателям?`)) return;
                    try {
                      const res = await m.sendMenuAll.mutateAsync(channel);
                      toast(`Меню поставлено в очередь: ${res.queued}`);
                    } catch (err) {
                      toast((err as Error).message, 'danger');
                    }
                  }}
                >
                  Меню всем ({CHANNEL_LABELS[channel]})
                </Button>
              ))}
            </div>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="animate-rise">
          {isLoading ? (
            <Loading />
          ) : error ? (
            <div className="p-5">
              <ErrorNote error={error} />
            </div>
          ) : !data?.length ? (
            <Empty title="Получателей пока нет" hint="Создайте первого получателя в форме справа." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Имя</Th>
                  <Th>Telegram</Th>
                  <Th>MAX</Th>
                  <Th className="text-center">Саммари / Алерты</Th>
                  <Th>Последняя доставка</Th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <Tr key={r.id} onClick={() => nav(`/users/${r.id}`)}>
                    <Td>
                      <p className="font-semibold">{r.name}</p>
                      {r.isTechAdmin && <p className="text-[11.5px] font-semibold text-violet">тех. уведомления</p>}
                      {isSuper && <p className="text-[11.5px] text-ink-mute">{r.directorateIds.map(dirName).filter(Boolean).join(', ') || 'без дирекции'}</p>}
                    </Td>
                    <Td className="num text-[13px]">
                      <RecipientStatusBadge status={r.status} />
                      {r.telegramUserId && <span className="block text-ink-mute">{r.telegramUserId}</span>}
                    </Td>
                    <Td className="num text-[13px]">
                      <RecipientStatusBadge status={r.maxStatus} />
                      {r.maxUserId && <span className="block text-ink-mute">{r.maxUserId}</span>}
                    </Td>
                    <Td className="num text-center text-[13px]">
                      {r.summaryChatIds.length} / {r.alertChatIds.length}
                    </Td>
                    <Td className="text-[13px]">
                      {r.lastDeliveryAt ? (
                        <>
                          {DELIVERY_STATUS_LABELS[r.lastDeliveryStatus as DeliveryStatus] ?? r.lastDeliveryStatus}
                          <span className="block text-ink-mute">{ago(r.lastDeliveryAt)}</span>
                        </>
                      ) : (
                        <span className="text-ink-mute">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="h-fit animate-rise">
          <CardHeader title="Новый получатель" />
          <CardBody>
            <form onSubmit={create} className="space-y-4">
              <Field label="Имя">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя получателя" required />
              </Field>
              {(isSuper || dirs.length > 1) && (
                <Field label="Дирекция">
                  <Select value={directorateId} onChange={(e) => setDirectorateId(e.target.value)}>
                    {isSuper && <option value="">— первая в системе —</option>}
                    {dirs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {isSuper && <Checkbox label="Технические уведомления" hint="Сбои AI, приёма и доставки" checked={tech} onChange={setTech} />}
              <Button type="submit" className="w-full" loading={m.create.isPending}>
                Создать
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>

      {data && data.length > 0 && activeChats.length > 0 && (
        <Card className="mt-4 animate-rise">
          <CardHeader title="Матрица назначений" hint={`С — саммари, А — алерты. Назначения независимы; меняются в карточке пользователя${isSuper ? ' или в разделах «Саммари» и «Алерты»' : ''}.`} />
          <Table>
            <thead>
              <tr>
                <Th rowSpan={2}>Пользователь</Th>
                {chatGroups.map((g) => (
                  <Th key={g.channel} colSpan={g.chats.length} className="border-l border-l-line-strong text-center normal-case tracking-normal">
                    {CHANNEL_LABELS[g.channel]}
                  </Th>
                ))}
              </tr>
              <tr>
                {chatGroups.map((g) =>
                  g.chats.map((c, i) => (
                    <Th key={c.id} className={`text-center normal-case tracking-normal${i === 0 ? ' border-l border-l-line-strong' : ''}`}>
                      {c.title}
                    </Th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <Tr key={r.id} onClick={() => nav(`/users/${r.id}`)}>
                  <Td className="font-semibold">{r.name}</Td>
                  {chatGroups.map((g) =>
                    g.chats.map((c, i) => (
                      <Td key={c.id} className={`text-center font-mono text-[12px]${i === 0 ? ' border-l border-l-line-strong' : ''}`}>
                        <span className={r.summaryChatIds.includes(c.id) ? 'font-bold text-info' : 'text-line-strong'}>С</span>
                        {' · '}
                        <span className={r.alertChatIds.includes(c.id) ? 'font-bold text-signal' : 'text-line-strong'}>А</span>
                      </Td>
                    )),
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
