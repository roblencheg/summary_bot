import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '~/components/layout/page';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { ErrorNote, Loading, Modal, Notice, useToast } from '~/components/ui/feedback';
import { Checkbox, Field, Input, Select, Switch } from '~/components/ui/form';
import { Table, Td, Th, Tr } from '~/components/ui/table';
import { DeliveryStatusBadge, RecipientStatusBadge } from '~/components/domain-badges';
import { ChatChecklist } from '~/components/chat-checklist';
import { useRecipient, useRecipientMutations } from '~/hooks/use-recipients';
import { useChats } from '~/hooks/use-chats';
import { useDeliveries, useDeliveryMutations } from '~/hooks/use-deliveries';
import { useTimezone } from '~/hooks/use-settings';
import { useMe } from '~/hooks/use-auth';
import { useDirectorates } from '~/hooks/use-directorates';
import { api } from '~/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { dt } from '~/lib/format';
import { CATEGORIES, CATEGORY_LABELS, CHANNELS, CHANNEL_LABELS, DELIVERY_KIND_LABELS, SEVERITIES, SEVERITY_LABELS, type Category, type Channel, type Severity } from '~shared/domain';
import type { BindingCodeDto, RecipientDto } from '~shared/schemas';

export function UserDetailsPage() {
  const id = Number(useParams().id);
  const { isSuper } = useMe();
  const { data: r, isLoading, error } = useRecipient(id);
  const chats = useChats();
  const m = useRecipientMutations();
  const dm = useDeliveryMutations();
  const deliveries = useDeliveries({ recipientId: id, limit: 10 });
  const tz = useTimezone();
  const toast = useToast();
  const nav = useNavigate();

  const [name, setName] = useState('');
  const [tech, setTech] = useState(false);
  const [summaryChats, setSummaryChats] = useState<number[]>([]);
  const [summaryDay, setSummaryDay] = useState(true);
  const [summaryNight, setSummaryNight] = useState(true);
  const [alertChats, setAlertChats] = useState<number[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [minSev, setMinSev] = useState<Severity>('attention');
  const [code, setCode] = useState<BindingCodeDto | null>(null);

  useEffect(() => {
    if (!r) return;
    setName(r.name);
    setTech(r.isTechAdmin);
    setSummaryChats(r.summaryChatIds);
    setSummaryDay(r.summaryDay);
    setSummaryNight(r.summaryNight);
    setAlertChats(r.alertChatIds);
    setCats(r.alertCategories);
    setMinSev(r.alertMinSeverity);
  }, [r]);

  if (isLoading) return <Loading />;
  if (error || !r) return <ErrorNote error={error} />;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, 'danger');
      return false;
    }
  };

  const saveSummary = () =>
    run(async () => {
      await m.setSubscriptions.mutateAsync({ id, kind: 'summary', chatIds: summaryChats });
      await m.update.mutateAsync({ id, input: { summaryDay, summaryNight } });
    }, 'Подписка на саммари сохранена');

  const saveAlerts = () =>
    run(async () => {
      await m.setSubscriptions.mutateAsync({ id, kind: 'alert', chatIds: alertChats });
      await m.update.mutateAsync({ id, input: { alertCategories: cats, alertMinSeverity: minSev } });
    }, 'Подписка на алерты сохранена');

  return (
    <>
      <PageHeader
        eyebrow={`03 · Пользователи · #${r.id}`}
        title={r.name}
        description={
          <span className="flex flex-wrap items-center gap-3">
            {CHANNELS.map((channel) => (
              <span key={channel} className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">{CHANNEL_LABELS[channel]}</span>
                <RecipientStatusBadge status={channel === 'telegram' ? r.status : r.maxStatus} />
                {channel === 'telegram' && r.telegramUserId && (
                  <span className="num text-[12px] text-ink-mute">
                    {r.telegramUserId}
                    {r.telegramUsername && ` · @${r.telegramUsername}`}
                  </span>
                )}
                {channel === 'max' && r.maxUserId && (
                  <span className="num text-[12px] text-ink-mute">
                    {r.maxUserId}
                    {r.maxUsername && ` · @${r.maxUsername}`}
                  </span>
                )}
              </span>
            ))}
          </span>
        }
        actions={
          r.status === 'disabled' || r.maxStatus === 'disabled' ? (
            <Button variant="signal" onClick={() => run(() => m.setEnabled.mutateAsync({ id, enabled: true }), 'Пользователь включён')}>
              Включить
            </Button>
          ) : (
            <Button variant="danger" onClick={() => run(() => m.setEnabled.mutateAsync({ id, enabled: false }), 'Пользователь отключён, неотправленные уведомления отменены')}>
              Отключить
            </Button>
          )
        }
      />

      {r.status === 'pending' && (
        <div className="mb-4">
          <Notice title="Не привязан в Telegram">Уведомления в Telegram не доставляются, пока пользователь не введёт код привязки боту.</Notice>
        </div>
      )}
      {r.status === 'blocked' && (
        <div className="mb-4">
          <Notice tone="danger" title="Пользователь заблокировал бота в Telegram">
            Отправки в Telegram не повторяются. Попросите пользователя разблокировать бота и выполнить /start.
          </Notice>
        </div>
      )}
      {r.maxStatus === 'pending' && (
        <div className="mb-4">
          <Notice title="Не привязан в MAX">Уведомления в MAX не доставляются, пока пользователь не введёт код привязки боту.</Notice>
        </div>
      )}
      {r.maxStatus === 'blocked' && (
        <div className="mb-4">
          <Notice tone="danger" title="Пользователь заблокировал бота в MAX">
            Отправки в MAX не повторяются. Попросите пользователя разблокировать бота и выполнить /start.
          </Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="animate-rise">
          <CardHeader title="Профиль и привязка" />
          <CardBody className="space-y-4">
            <Field label="Имя">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            {isSuper && <Checkbox label="Технические уведомления о сбоях" checked={tech} onChange={setTech} />}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => run(() => m.update.mutateAsync({ id, input: isSuper ? { name, isTechAdmin: tech } : { name } }), 'Профиль сохранён')}>
                Сохранить
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={async () => {
                  if (confirm(isSuper ? `Удалить «${r.name}» и все его подписки?` : `Удалить «${r.name}» из вашей дирекции? Если он состоит и в других дирекциях, их рассылки продолжатся.`) && (await run(() => m.remove.mutateAsync(id), 'Пользователь удалён'))) nav('/users');
                }}
              >
                Удалить
              </Button>
            </div>
            <p className="text-[12.5px] text-ink-mute">
              Активирован в Telegram: {dt(r.activatedAt, tz)} · в MAX: {dt(r.maxActivatedAt, tz)} · создан: {dt(r.createdAt, tz)}
            </p>
            <div className="space-y-3 border-t border-line pt-4">
              {CHANNELS.map((channel) => (
                <ChannelBindingRow key={channel} id={id} channel={channel} r={r} m={m} dm={dm} run={run} onIssuedCode={setCode} />
              ))}
            </div>
          </CardBody>
        </Card>

        <Card className="animate-rise">
          <CardHeader
            title="Последние отправки"
            actions={
              isSuper && (
                <Link to={`/deliveries?recipientId=${id}`} className="text-sm font-semibold text-signal">
                  Весь журнал →
                </Link>
              )
            }
          />
          {deliveries.data?.items.length ? (
            <Table>
              <tbody>
                {deliveries.data.items.map((d) => (
                  <Tr key={d.id}>
                    <Td className="text-[13px]">{DELIVERY_KIND_LABELS[d.kind]}</Td>
                    <Td>
                      <DeliveryStatusBadge status={d.status} />
                    </Td>
                    <Td className="num text-[12.5px] text-ink-soft">{dt(d.sentAt ?? d.createdAt, tz)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <CardBody className="text-sm text-ink-soft">Отправок ещё не было.</CardBody>
          )}
        </Card>

        <Card className="animate-rise">
          <CardHeader
            title="Саммари"
            hint="Одно сообщение с разделами по назначенным чатам"
            actions={
              <Button size="sm" onClick={saveSummary} loading={m.setSubscriptions.isPending}>
                Сохранить
              </Button>
            }
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-5">
              <Switch checked={summaryNight} onChange={setSummaryNight} label="Утреннее 08:00 (за ночь)" />
              <Switch checked={summaryDay} onChange={setSummaryDay} label="Вечернее 22:00 (за день)" />
            </div>
            <ChatChecklist chats={chats.data ?? []} value={summaryChats} onChange={setSummaryChats} />
          </CardBody>
        </Card>

        <Card className="animate-rise">
          <CardHeader
            title="Алерты"
            hint="Независимо от саммари"
            actions={
              <Button size="sm" onClick={saveAlerts} loading={m.setSubscriptions.isPending}>
                Сохранить
              </Button>
            }
          />
          <CardBody className="space-y-4">
            <ChatChecklist chats={chats.data ?? []} value={alertChats} onChange={setAlertChats} />
            <div className="border-t border-line pt-4">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-ink-soft">Категории</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {CATEGORIES.map((c) => (
                  <Checkbox key={c} label={CATEGORY_LABELS[c]} checked={cats.includes(c)} onChange={(on) => setCats(on ? [...cats, c] : cats.filter((x) => x !== c))} />
                ))}
              </div>
            </div>
            <Field label="Минимальная серьёзность">
              <Select value={minSev} onChange={(e) => setMinSev(e.target.value as Severity)}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </CardBody>
        </Card>
      </div>

      {isSuper && <RecipientDirectorates id={id} value={r.directorateIds} />}

      <Modal open={code !== null} onClose={() => setCode(null)} title={code ? `Код привязки · ${CHANNEL_LABELS[code.channel]}` : 'Код привязки'}>
        {code && (
          <div className="space-y-4 text-sm">
            <p>Передайте код пользователю. Он одноразовый и действует до {dt(code.expiresAt, tz)}. Показывается только сейчас.</p>
            {code.link ? (
              <div className="flex gap-2">
                <Input readOnly value={code.link} className="num" onFocus={(e) => e.target.select()} />
                <Button variant="secondary" onClick={() => navigator.clipboard.writeText(code.link!).then(() => toast('Ссылка скопирована'))}>
                  Копировать
                </Button>
              </div>
            ) : (
              <Notice tone="signal">Кликабельная ссылка для этого канала недоступна — передайте пользователю команду вручную.</Notice>
            )}
            <p>
              Команда в личном диалоге с ботом: <code className="num rounded bg-sunken px-1.5 py-0.5">/start {code.code}</code>
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}

/** Привязка, меню и тестовое уведомление одного канала — Telegram и MAX рядом, независимо друг от друга. */
function ChannelBindingRow({
  id,
  channel,
  r,
  m,
  dm,
  run,
  onIssuedCode,
}: {
  id: number;
  channel: Channel;
  r: RecipientDto;
  m: ReturnType<typeof useRecipientMutations>;
  dm: ReturnType<typeof useDeliveryMutations>;
  run: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
  onIssuedCode: (c: BindingCodeDto) => void;
}) {
  const status = channel === 'telegram' ? r.status : r.maxStatus;
  const userId = channel === 'telegram' ? r.telegramUserId : r.maxUserId;
  const active = status === 'active';
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink-soft">{CHANNEL_LABELS[channel]}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="signal" loading={m.issueCode.isPending} onClick={async () => onIssuedCode(await m.issueCode.mutateAsync({ id, channel }))}>
          {userId ? 'Новый код привязки' : 'Выдать код привязки'}
        </Button>
        {userId && (
          <Button size="sm" variant="ghost" onClick={() => confirm(`Сбросить привязку ${CHANNEL_LABELS[channel]}?`) && run(() => m.resetBinding.mutateAsync({ id, channel }), 'Привязка сброшена')}>
            Сбросить привязку
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          loading={m.sendMenu.isPending}
          disabled={!active}
          title="Сообщение с кнопкой «Что сейчас происходит»; бот закрепит его в диалоге"
          onClick={() => run(() => m.sendMenu.mutateAsync({ id, channel }), 'Меню бота поставлено в очередь')}
        >
          Отправить меню
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={dm.test.isPending}
          disabled={!active}
          onClick={() => run(() => dm.test.mutateAsync({ recipientId: id, channel }), 'Тестовое уведомление поставлено в очередь')}
        >
          Тестовое уведомление
        </Button>
      </div>
    </div>
  );
}

/** Состав дирекций получателя — только суперадмин. Руководители видят получателя своих дирекций. */
function RecipientDirectorates({ id, value }: { id: number; value: number[] }) {
  const dirs = useDirectorates(true);
  const qc = useQueryClient();
  const toast = useToast();
  const [ids, setIds] = useState<number[]>(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setIds(value), [value]);

  const save = async () => {
    setSaving(true);
    try {
      await api.recipients.setDirectorates(id, ids);
      await qc.invalidateQueries({ queryKey: ['recipients'] });
      toast('Дирекции сохранены');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-4 animate-rise">
      <CardHeader title="Дирекции" hint="Руководители видят и настраивают получателя своих дирекций. Подписки на чаты, ставшие недоступными, снимаются." />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap gap-4">
          {(dirs.data?.directorates ?? []).map((d) => (
            <Checkbox key={d.id} label={d.name} checked={ids.includes(d.id)} onChange={(on) => setIds(on ? [...ids, d.id] : ids.filter((x) => x !== d.id))} />
          ))}
        </div>
        <Button size="sm" loading={saving} onClick={save}>
          Сохранить дирекции
        </Button>
      </CardBody>
    </Card>
  );
}
