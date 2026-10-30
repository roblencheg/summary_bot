import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '~/components/layout/page';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Empty, ErrorNote, Loading, Modal, Notice, Pager, useToast } from '~/components/ui/feedback';
import { Select } from '~/components/ui/form';
import { Table, Td, Th, Tr } from '~/components/ui/table';
import { DeliveryStatusBadge } from '~/components/domain-badges';
import { useDeliveries, useDelivery, useDeliveryMutations } from '~/hooks/use-deliveries';
import { useRecipients } from '~/hooks/use-recipients';
import { useTimezone } from '~/hooks/use-settings';
import { dt } from '~/lib/format';
import { CHANNEL_LABELS, DELIVERY_KINDS, DELIVERY_KIND_LABELS, DELIVERY_STATUSES, DELIVERY_STATUS_LABELS } from '~shared/domain';

export function DeliveriesPage() {
  const [sp, setSp] = useSearchParams();
  const tz = useTimezone();
  const recipients = useRecipients();
  const [openId, setOpenId] = useState<number | null>(null);
  const f = {
    recipientId: sp.get('recipientId') ? Number(sp.get('recipientId')) : undefined,
    kind: sp.get('kind') || undefined,
    status: sp.get('status') || undefined,
    limit: 50,
    offset: Number(sp.get('offset') ?? 0),
  };
  const { data, isLoading, error } = useDeliveries(f);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('offset');
    setSp(next, { replace: true });
  };
  const rname = (id: number) => recipients.data?.find((r) => r.id === id)?.name ?? `#${id}`;

  return (
    <>
      <PageHeader
        eyebrow="07 · Журнал отправок"
        title="Журнал отправок"
        description="«Принято Telegram» означает, что API принял сообщение, а не что его прочитали. При сетевом обрыве результат неопределённый: повтор возможен и помечается в тексте."
      />
      <Card className="mb-4 animate-rise p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select value={sp.get('recipientId') ?? ''} onChange={(e) => set('recipientId', e.target.value)}>
            <option value="">Все получатели</option>
            {recipients.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Select value={sp.get('kind') ?? ''} onChange={(e) => set('kind', e.target.value)}>
            <option value="">Все типы</option>
            {DELIVERY_KINDS.map((k) => (
              <option key={k} value={k}>
                {DELIVERY_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <Select value={sp.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Все статусы</option>
            {DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DELIVERY_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </Card>
      <Card className="animate-rise">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <div className="p-5">
            <ErrorNote error={error} />
          </div>
        ) : !data?.items.length ? (
          <Empty title="Отправок нет" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Получатель</Th>
                  <Th>Тип</Th>
                  <Th>Основание</Th>
                  <Th>Создано</Th>
                  <Th>Попыток</Th>
                  <Th>Результат</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((d) => (
                  <Tr key={d.id} onClick={() => setOpenId(d.id)}>
                    <Td className="num text-[13px] text-ink-mute">{d.id}</Td>
                    <Td className="text-[13px] font-semibold">{rname(d.recipientId)}</Td>
                    <Td className="text-[13px]">
                      {DELIVERY_KIND_LABELS[d.kind]} <span className="text-[11px] text-ink-mute">· {CHANNEL_LABELS[d.channel]}</span>
                      {d.manualRetry && <span className="block text-[11.5px] text-violet">вручную</span>}
                    </Td>
                    <Td className="text-[13px]">
                      {d.incidentId ? (
                        <Link to={`/incidents/${d.incidentId}`} onClick={(e) => e.stopPropagation()} className="text-info underline">
                          инцидент #{d.incidentId}
                        </Link>
                      ) : d.reportId ? (
                        `отчёт #${d.reportId}`
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="num whitespace-nowrap text-[13px]">{dt(d.createdAt, tz)}</Td>
                    <Td className="num text-[13px]">{d.attempts}</Td>
                    <Td>
                      <DeliveryStatusBadge status={d.status} />
                      {d.uncertain && <span className="block text-[11.5px] text-signal">возможен дубль</span>}
                      {(d.statusReason || d.lastError) && <span className="block max-w-56 truncate text-[11.5px] text-ink-mute">{d.statusReason ?? d.lastError}</span>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pager total={data.total} offset={f.offset} limit={50} onChange={(o) => set('offset', String(o))} />
          </>
        )}
      </Card>
      <DeliveryModal id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function DeliveryModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, isLoading, error } = useDelivery(id);
  const m = useDeliveryMutations();
  const tz = useTimezone();
  const toast = useToast();
  const canRetry = data && ['failed', 'blocked', 'not_activated', 'cancelled'].includes(data.job.status);
  return (
    <Modal open={id !== null} onClose={onClose} title={`Отправка #${id ?? ''}`} wide>
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote error={error} />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <DeliveryStatusBadge status={data.job.status} />
            <span>
              {DELIVERY_KIND_LABELS[data.job.kind]} · {CHANNEL_LABELS[data.job.channel]}
            </span>
            {data.job.statusReason && <span className="text-ink-soft">— {data.job.statusReason}</span>}
          </div>
          {data.job.uncertain && <Notice>Была попытка с неопределённым результатом: получатель мог получить сообщение дважды.</Notice>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-ink-soft">Сообщение в Telegram</dt>
            <dd className="num">{dt(data.job.sourceSentAt, tz, true)}</dd>
            <dt className="text-ink-soft">Получено системой</dt>
            <dd className="num">{dt(data.job.sourceReceivedAt, tz, true)}</dd>
            <dt className="text-ink-soft">Проанализировано</dt>
            <dd className="num">{dt(data.job.analyzedAt, tz, true)}</dd>
            <dt className="text-ink-soft">Граница периода</dt>
            <dd className="num">{dt(data.job.triggerAt, tz, true)}</dd>
            <dt className="text-ink-soft">Принято Telegram</dt>
            <dd className="num">{dt(data.job.sentAt, tz, true)}</dd>
            <dt className="text-ink-soft">Частей отправлено</dt>
            <dd className="num">{data.job.partsSent}</dd>
          </dl>
          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-ink-soft">Попытки</p>
            {data.attempts.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Время</Th>
                    <Th>Часть</Th>
                    <Th>Результат</Th>
                    <Th>мс</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.attempts.map((a) => (
                    <tr key={a.id}>
                      <Td className="num text-[12.5px]">{dt(a.at, tz, true)}</Td>
                      <Td className="num text-[12.5px]">{a.part + 1}</Td>
                      <Td className="text-[12.5px]">
                        {a.ok ? <span className="text-ok">принято, id {a.telegramMessageId}</span> : <span className="text-danger">{[a.errorCode, a.httpStatus, a.error].filter(Boolean).join(' · ')}</span>}
                        {a.uncertain && <span className="block text-signal">результат неизвестен</span>}
                      </Td>
                      <Td className="num text-[12.5px]">{a.durationMs ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-ink-soft">Попыток не было.</p>
            )}
          </div>
          {canRetry && (
            <Button
              variant="signal"
              loading={m.retry.isPending}
              onClick={() => m.retry.mutateAsync(data.job.id).then(() => (toast('Повторная отправка поставлена в очередь'), onClose()), (e) => toast(e.message, 'danger'))}
            >
              Повторить отправку
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
