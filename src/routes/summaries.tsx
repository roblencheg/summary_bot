import { useState, type FormEvent } from 'react';
import { PageHeader } from '~/components/layout/page';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { Badge } from '~/components/ui/badge';
import { ErrorNote, Loading, Modal, Notice, Pager, useToast } from '~/components/ui/feedback';
import { Field, Input, Select } from '~/components/ui/form';
import { Table, Td, Th, Tr } from '~/components/ui/table';
import { SubscriptionMatrix } from '~/components/subscription-matrix';
import { useRecipients } from '~/hooks/use-recipients';
import { usePeriods, useReport, useReportMutations, useReports } from '~/hooks/use-reports';
import { useAppContext, useTimezone } from '~/hooks/use-settings';
import { useMe } from '~/hooks/use-auth';
import { dt, localInputToIso } from '~/lib/format';
import { CHANNEL_LABELS, PERIOD_TYPE_LABELS, type PeriodType } from '~shared/domain';

const REPORT_STATUS: Record<string, { label: string; tone: 'ok' | 'signal' | 'danger' | 'neutral' | 'info' }> = {
  pending: { label: 'ожидает отправки', tone: 'info' },
  built: { label: 'собран', tone: 'info' },
  sent: { label: 'отправлен', tone: 'ok' },
  skipped_catchup: { label: 'не отправлен: догоняющий лимит', tone: 'signal' },
  cancelled: { label: 'отменён', tone: 'neutral' },
  failed: { label: 'ошибка', tone: 'danger' },
};

const REQ_STATUS = { resolved: 'решено', answered: 'есть ответ', no_reply: 'возможно без ответа', unknown: 'нет подтверждения' } as const;

export function SummariesPage() {
  const tz = useTimezone();
  const ctx = useAppContext();
  const { isSuper } = useMe();
  const recipients = useRecipients();
  const [recipientId, setRecipientId] = useState<number | undefined>();
  const [offset, setOffset] = useState(0);
  const reports = useReports({ recipientId, offset });
  const periods = usePeriods(isSuper);
  const m = useReportMutations();
  const toast = useToast();
  const [openId, setOpenId] = useState<number | null>(null);
  const [manual, setManual] = useState({ recipientId: '', periodType: 'day' as PeriodType, anchor: '' });

  const name = (id: number) => recipients.data?.find((r) => r.id === id)?.name ?? `#${id}`;
  const g = ctx.data;

  const runManual = async (e: FormEvent) => {
    e.preventDefault();
    const anchor = localInputToIso(manual.anchor);
    if (!manual.recipientId || !anchor) return toast('Выберите получателя и момент внутри периода', 'danger');
    try {
      const r = await m.manual.mutateAsync({ recipientId: Number(manual.recipientId), periodType: manual.periodType, anchor });
      toast(`Отчёт #${r.id} поставлен в очередь`);
    } catch (err) {
      toast((err as Error).message, 'danger');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={isSuper ? '04 · Саммари' : '05 · Отчёты'}
        title={isSuper ? 'Дневные и ночные саммари' : 'Саммари ваших получателей'}
        description={
          g
            ? `В ${g.nightStart} — за ${g.dayStart}–${g.nightStart}, в ${g.dayStart} — за ${g.nightStart}–${g.dayStart} (${g.timezone}). Интервалы полуоткрытые: сообщение ровно в ${g.nightStart} попадает в ночной отчёт.`
            : undefined
        }
      />
      <div className="space-y-4">
        <SubscriptionMatrix kind="summary" />
        <Notice tone="info">Включение утреннего/вечернего отчёта для конкретного получателя — в его карточке («Пользователи»).</Notice>

        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Card className="animate-rise">
            <CardHeader
              title="Сформированные отчёты"
              actions={
                <Select className="h-8 w-52 text-[13px]" value={recipientId ?? ''} onChange={(e) => (setRecipientId(e.target.value ? Number(e.target.value) : undefined), setOffset(0))}>
                  <option value="">Все получатели</option>
                  {recipients.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              }
            />
            {reports.isLoading ? (
              <Loading />
            ) : !reports.data?.items.length ? (
              <CardBody className="text-sm text-ink-soft">Отчётов пока нет — первые появятся после ближайшей границы периода.</CardBody>
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Период</Th>
                      <Th>Получатель</Th>
                      <Th>Статус</Th>
                      <Th>Отправлен</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.data.items.map((r) => (
                      <Tr key={r.id} onClick={() => setOpenId(r.id)}>
                        <Td className="text-[13px]">
                          <p className="font-semibold">
                            {PERIOD_TYPE_LABELS[r.periodType]}
                            {r.manual && ' · вручную'}
                            {r.version > 1 && ` · v${r.version}`}
                          </p>
                          <p className="num text-ink-mute">
                            {dt(r.startsAt, tz)} – {dt(r.endsAt, tz)}
                          </p>
                        </Td>
                        <Td className="text-[13px]">{name(r.recipientId)}</Td>
                        <Td>
                          <div className="flex flex-col gap-1">
                            {r.chatIds.length > 0 && (
                              <span>
                                <span className="mr-1 text-[11px] text-ink-mute">{CHANNEL_LABELS.telegram}</span>
                                <Badge tone={REPORT_STATUS[r.status]?.tone ?? 'neutral'}>{REPORT_STATUS[r.status]?.label ?? r.status}</Badge>
                              </span>
                            )}
                            {r.maxChatIds.length > 0 && (
                              <span>
                                <span className="mr-1 text-[11px] text-ink-mute">{CHANNEL_LABELS.max}</span>
                                <Badge tone={REPORT_STATUS[r.maxStatus]?.tone ?? 'neutral'}>{REPORT_STATUS[r.maxStatus]?.label ?? r.maxStatus}</Badge>
                              </span>
                            )}
                          </div>
                          {r.delayed && <span className="block text-[12px] text-signal">с задержкой</span>}
                        </Td>
                        <Td className="num text-[13px]">{dt(r.sentAt, tz)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <Pager total={reports.data.total} offset={offset} limit={50} onChange={setOffset} />
              </>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="animate-rise">
              <CardHeader title="Сформировать вручную" hint="Права проверяются заново при отправке" />
              <CardBody>
                <form className="space-y-3" onSubmit={runManual}>
                  <Field label="Получатель">
                    <Select value={manual.recipientId} onChange={(e) => setManual({ ...manual, recipientId: e.target.value })}>
                      <option value="">—</option>
                      {recipients.data?.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Тип периода">
                    <Select value={manual.periodType} onChange={(e) => setManual({ ...manual, periodType: e.target.value as PeriodType })}>
                      <option value="day">Дневной</option>
                      <option value="night">Ночной</option>
                    </Select>
                  </Field>
                  <Field label="Любой момент внутри периода" hint="По времени вашего браузера">
                    <Input type="datetime-local" value={manual.anchor} onChange={(e) => setManual({ ...manual, anchor: e.target.value })} />
                  </Field>
                  <Button type="submit" className="w-full" loading={m.manual.isPending}>
                    Сформировать и отправить
                  </Button>
                </form>
              </CardBody>
            </Card>

            {isSuper && (
            <Card className="animate-rise">
              <CardHeader title="Периоды" hint="Пересборка — после восстановления AI или правки правил" />
              <CardBody className="max-h-80 space-y-2 overflow-y-auto text-[13px]">
                {periods.data?.length ? (
                  periods.data.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2">
                      <span>
                        <b>{PERIOD_TYPE_LABELS[p.periodType]}</b> <span className="num text-ink-soft">{dt(p.endsAt, tz)}</span>
                        <span className={p.status === 'ready' ? 'text-ok' : 'text-signal'}> · {p.status === 'ready' ? 'готов' : p.status === 'collecting' ? 'сбор' : 'ошибка'}</span>
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => m.rebuild.mutateAsync(p.id).then(() => toast('Дайджесты пересобраны'), (e) => toast(e.message, 'danger'))}>
                        Пересобрать
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-ink-soft">Периодов ещё нет.</p>
                )}
              </CardBody>
            </Card>
            )}
          </div>
        </div>
      </div>
      <ReportModal id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function ReportModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, isLoading, error } = useReport(id);
  const tz = useTimezone();
  return (
    <Modal open={id !== null} onClose={onClose} title={`Отчёт #${id ?? ''}`} wide>
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote error={error} />
      ) : (
        <div className="space-y-6">
          {data.report.chatIds.length > 0 && (
            <ReportChannelSection channel="telegram" richHtml={data.report.richHtml} parts={data.report.parts} />
          )}
          {data.report.maxChatIds.length > 0 && <ReportChannelSection channel="max" richHtml={null} parts={data.report.maxParts} />}
          {data.digests.map(({ chat, digest }) => (
            <section key={chat.id}>
              <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-ink-soft">
                {chat.title} <span className="text-ink-mute">({CHANNEL_LABELS[chat.channel]})</span> — полный список обращений ({digest.content.requests.length}) · дайджест v{digest.version}
              </p>
              <p className="num mb-2 text-[12.5px] text-ink-soft">
                Сообщений {digest.stats.messages} · авторов {digest.stats.authors}
                {digest.stats.attachmentsNoText > 0 && ` · вложений без текста ${digest.stats.attachmentsNoText}`} · обращений {digest.stats.requests} (повторных{' '}
                {digest.stats.repeatedRequests}) · сигналов риска {digest.stats.riskSignals}
                {digest.stats.unanalyzed > 0 && ` · не проанализировано AI ${digest.stats.unanalyzed}`}
                {digest.content.gaps.map((g) => (
                  <span key={g.startedAt} className="block text-ink-mute">
                    Пробел сбора: {dt(g.startedAt, tz)} – {g.endedAt ? dt(g.endedAt, tz) : 'продолжается'}
                  </span>
                ))}
              </p>
              {digest.content.requests.length === 0 ? (
                <p className="text-sm text-ink-soft">Обращений нет.</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Время</Th>
                      <Th>Автор</Th>
                      <Th>Суть</Th>
                      <Th>Статус</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {digest.content.requests.map((r) => (
                      <tr key={r.requestKey}>
                        <Td className="num whitespace-nowrap text-[12.5px]">{dt(r.sentAt, tz)}</Td>
                        <Td className="text-[13px]">{r.authorName}</Td>
                        <Td className="text-[13px]">
                          {r.summary}
                          <span className="block text-[12px] text-ink-mute">
                            {r.topic} · сообщений {r.messages}
                            {r.link && (
                              <>
                                {' · '}
                                <a href={r.link} target="_blank" rel="noreferrer" className="text-info underline">
                                  источник
                                </a>
                              </>
                            )}
                          </span>
                        </Td>
                        <Td className="text-[12.5px]">{REQ_STATUS[r.status]}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </section>
          ))}
          {data.report.fullText && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-ink-soft">Полный текст без маскирования ({CHANNEL_LABELS.telegram})</summary>
              <div className="tg-html mt-2 whitespace-pre-wrap rounded-xl border border-line p-4 text-[13px]" dangerouslySetInnerHTML={{ __html: data.report.fullText }} />
            </details>
          )}
          {data.report.maxFullText && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-ink-soft">Полный текст без маскирования ({CHANNEL_LABELS.max})</summary>
              <div className="tg-html mt-2 whitespace-pre-wrap rounded-xl border border-line p-4 text-[13px]" dangerouslySetInnerHTML={{ __html: data.report.maxFullText }} />
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}

function ReportChannelSection({ channel, richHtml, parts }: { channel: 'telegram' | 'max'; richHtml: string | null; parts: string[] }) {
  return (
    <section>
      <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-ink-soft">
        {`Как в ${CHANNEL_LABELS[channel]}`}
        {richHtml ? ' (одним сообщением, идентификаторы скрыты)' : ` (${parts.length || '—'} ${parts.length === 1 ? 'часть' : 'частей'}, идентификаторы скрыты)`}
      </p>
      {richHtml ? (
        <div className="tg-html tg-rich rounded-xl border border-line bg-sunken/40 p-4 text-[13.5px] leading-relaxed" dangerouslySetInnerHTML={{ __html: richHtml }} />
      ) : parts.length ? (
        parts.map((p, i) => (
          <div key={i} className="tg-html mb-3 whitespace-pre-wrap rounded-xl border border-line bg-sunken/40 p-4 text-[13.5px] leading-relaxed" dangerouslySetInnerHTML={{ __html: p }} />
        ))
      ) : (
        <p className="text-sm text-ink-soft">Отчёт ещё не собран — он собирается в момент отправки по текущим правам получателя.</p>
      )}
    </section>
  );
}
