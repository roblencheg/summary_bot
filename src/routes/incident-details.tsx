import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '~/components/layout/page';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { ErrorNote, Loading, Notice, useToast } from '~/components/ui/feedback';
import { Table, Td, Th, Tr } from '~/components/ui/table';
import { CategoryChips, DeliveryStatusBadge, IncidentStatusBadge, SeverityBadge } from '~/components/domain-badges';
import { MessageModal } from '~/components/message-modal';
import { useIncident, useSetIncidentStatus } from '~/hooks/use-incidents';
import { useChats } from '~/hooks/use-chats';
import { useRecipients } from '~/hooks/use-recipients';
import { useTimezone } from '~/hooks/use-settings';
import { dt } from '~/lib/format';
import { DELIVERY_KIND_LABELS, INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, REPEAT_TYPE_LABELS, TONE_LABELS, type Tone } from '~shared/domain';

const EVENT_LABELS: Record<string, string> = {
  created: 'Создан',
  message: 'Новое сообщение',
  alert: 'Алерт поставлен в рассылку',
  update: 'Обновление поставлено в рассылку',
  status: 'Смена статуса',
  feedback: 'Оценка получателя',
  resolution_confirmed: 'Явное подтверждение решения в переписке',
};

export function IncidentDetailsPage() {
  const id = Number(useParams().id);
  const { data, isLoading, error } = useIncident(id);
  const setStatus = useSetIncidentStatus(id);
  const chats = useChats();
  const recipients = useRecipients();
  const tz = useTimezone();
  const toast = useToast();
  const [openMsg, setOpenMsg] = useState<number | null>(null);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorNote error={error} />;
  const i = data.incident;
  const chat = chats.data?.find((c) => c.id === i.chatId);
  const rname = (rid: number) => recipients.data?.find((r) => r.id === rid)?.name ?? `#${rid}`;

  return (
    <>
      <PageHeader
        eyebrow={`06 · Инцидент #${i.id}${i.kind === 'spike' ? ' · всплеск' : ''}`}
        title={i.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={i.severity} />
            <IncidentStatusBadge status={i.status} />
            <CategoryChips categories={i.categories} />
          </span>
        }
        actions={INCIDENT_STATUSES.filter((s) => s !== i.status).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === 'false_positive' ? 'danger' : s === 'closed' ? 'signal' : 'secondary'}
            loading={setStatus.isPending && setStatus.variables === s}
            onClick={() => setStatus.mutateAsync(s).then(() => toast(`Статус: ${INCIDENT_STATUS_LABELS[s]}`), (e) => toast(e.message, 'danger'))}
          >
            {INCIDENT_STATUS_LABELS[s]}
          </Button>
        ))}
      />
      <div className="mb-4 space-y-3">
        {i.borderline && <Notice tone="info" title="Пограничный случай">Уверенность модели ниже порога чата — алерт не отправлялся. Проверьте и при необходимости смените статус.</Notice>}
        {i.resolutionConfirmed && <Notice tone="ok">В переписке есть явное подтверждение решения. Закрыть инцидент может только администратор.</Notice>}
        {i.sourcesDeleted && <Notice tone="info">Часть исходных сообщений удалена по сроку хранения.</Notice>}
        {i.relatedIncidentId && (
          <Notice tone="info">
            Связан с инцидентом{' '}
            <Link to={`/incidents/${i.relatedIncidentId}`} className="font-semibold underline">
              #{i.relatedIncidentId}
            </Link>{' '}
            (другая сущность или прежний закрыт администратором).
          </Notice>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="animate-rise">
          <CardHeader title="Основания" />
          <CardBody className="space-y-3 text-sm">
            <p className="leading-relaxed">{i.summary}</p>
            {i.severityReason && (
              <p className="rounded-lg bg-sunken/60 p-3 text-[13.5px]">
                <b>Почему такая серьёзность:</b> {i.severityReason}
              </p>
            )}
            {i.spikeData && (
              <div className="rounded-lg bg-sunken/60 p-3 text-[13.5px]">
                <p>
                  <b>Окно:</b> {dt(i.spikeData.windowStart, tz)} – {dt(i.spikeData.windowEnd, tz)} · {i.spikeData.count} сообщ. · {i.spikeData.authors} участников
                </p>
                <p>
                  <b>База:</b> {i.spikeData.historyLimited ? 'ограничена (история < заданного периода)' : `≈ ${i.spikeData.baselinePerWindow.toFixed(1)} за окно, рост ×${i.spikeData.ratio?.toFixed(1) ?? '—'}`}
                </p>
                <p>
                  <b>Темы:</b> {i.spikeData.topics.map((t) => `${t.topic} (${t.count})`).join(', ') || '—'} · <b>тон:</b>{' '}
                  {i.spikeData.tones.map((t) => `${TONE_LABELS[t.tone as Tone] ?? t.tone} ${t.count}`).join(', ') || 'не определён'}
                </p>
              </div>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-ink-soft">Чат</dt>
              <dd>
                <Link to={`/chats/${i.chatId}`} className="font-semibold hover:text-signal">
                  {chat?.title ?? i.chatId}
                </Link>
              </dd>
              <dt className="text-ink-soft">Тема</dt>
              <dd>{i.topic ?? '—'}</dd>
              <dt className="text-ink-soft">Автор</dt>
              <dd>{i.authorName ?? '—'}</dd>
              <dt className="text-ink-soft">Сообщений / участников</dt>
              <dd className="num">
                {i.messageCount} / {i.affectedAuthors} · {REPEAT_TYPE_LABELS[i.repeatType]}
              </dd>
              <dt className="text-ink-soft">Период</dt>
              <dd className="num">
                {dt(i.firstMessageAt, tz)} – {dt(i.lastMessageAt, tz)}
              </dd>
              <dt className="text-ink-soft">Сущности</dt>
              <dd className="num">{i.entities.join(', ') || '—'}</dd>
              <dt className="text-ink-soft">Уверенность</dt>
              <dd className="num">{i.confidence.toFixed(2)}</dd>
              <dt className="text-ink-soft">Версия анализа</dt>
              <dd className="num break-all text-[12px]">{i.analysisVersion ?? '—'}</dd>
            </dl>
          </CardBody>
        </Card>

        <Card className="animate-rise">
          <CardHeader title="Хронология" />
          <CardBody>
            <ol className="relative space-y-3 border-l border-line pl-4 text-[13px]">
              {data.events.map((e) => (
                <li key={e.id}>
                  <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface bg-signal" />
                  <p className="font-semibold">{EVENT_LABELS[e.kind] ?? e.kind}</p>
                  <p className="num text-ink-mute">
                    {dt(e.at, tz, true)}
                    {e.actor && ` · ${e.actor}`}
                  </p>
                  {e.details && 'reason' in e.details && <p className="text-ink-soft">{String(e.details.reason)}</p>}
                  {e.details && 'to' in e.details && (
                    <p className="text-ink-soft">
                      {INCIDENT_STATUS_LABELS[e.details.from as keyof typeof INCIDENT_STATUS_LABELS]} → {INCIDENT_STATUS_LABELS[e.details.to as keyof typeof INCIDENT_STATUS_LABELS]}
                    </p>
                  )}
                  {e.details && 'verdict' in e.details && <p className="text-ink-soft">{e.details.verdict === 'useful' ? 'полезный сигнал' : 'ложное срабатывание'}</p>}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4 animate-rise">
        <CardHeader title="Связанные сообщения" hint="Полный текст без маскирования; нажмите — анализ и редакции" />
        {data.messages.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Время</Th>
                <Th>Автор</Th>
                <Th>Текст</Th>
                <Th>Источник</Th>
              </tr>
            </thead>
            <tbody>
              {data.messages.map((m) => (
                <Tr key={m.id} onClick={() => setOpenMsg(m.id)}>
                  <Td className="num whitespace-nowrap text-[13px]">{dt(m.sentAt, tz)}</Td>
                  <Td className="text-[13px]">{m.authorName}</Td>
                  <Td className="text-[13px]">{m.text}</Td>
                  <Td className="text-[13px]">
                    {m.link ? (
                      <a href={m.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-info underline">
                        #{m.messageId}
                      </a>
                    ) : (
                      <span className="num text-ink-mute">#{m.messageId}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <CardBody className="text-sm text-ink-soft">{i.kind === 'spike' ? 'Всплеск считается по количеству сообщений окна.' : 'Сообщения удалены по сроку хранения.'}</CardBody>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="animate-rise">
          <CardHeader title="Рассылка" />
          {data.deliveries.length ? (
            <Table>
              <tbody>
                {data.deliveries.map((d) => (
                  <tr key={d.id}>
                    <Td className="text-[13px]">{rname(d.recipientId)}</Td>
                    <Td className="text-[13px]">{DELIVERY_KIND_LABELS[d.kind]}</Td>
                    <Td>
                      <DeliveryStatusBadge status={d.status} />
                    </Td>
                    <Td className="num text-[12.5px] text-ink-soft">{dt(d.sentAt ?? d.createdAt, tz)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <CardBody className="text-sm text-ink-soft">Уведомлений не отправлялось (ниже порогов или нет подписчиков).</CardBody>
          )}
        </Card>
        <Card className="animate-rise">
          <CardHeader title="Оценки получателей" hint="Не меняют правила автоматически" />
          {data.feedback.length ? (
            <CardBody className="space-y-1 text-[13px]">
              {data.feedback.map((f, k) => (
                <p key={k} className="flex justify-between gap-3">
                  <span>{rname(f.recipientId)}</span>
                  <span className={f.verdict === 'useful' ? 'text-ok' : 'text-danger'}>{f.verdict === 'useful' ? '👍 полезный' : '👎 ложный'}</span>
                </p>
              ))}
            </CardBody>
          ) : (
            <CardBody className="text-sm text-ink-soft">Оценок пока нет.</CardBody>
          )}
        </Card>
      </div>
      <MessageModal id={openMsg} onClose={() => setOpenMsg(null)} />
    </>
  );
}
