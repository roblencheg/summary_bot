import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '~/components/layout/page';
import { Card } from '~/components/ui/card';
import { Empty, ErrorNote, Loading, Pager } from '~/components/ui/feedback';
import { Input, Select } from '~/components/ui/form';
import { Table, Td, Th, Tr } from '~/components/ui/table';
import { CategoryChips, IncidentStatusBadge, SeverityBadge } from '~/components/domain-badges';
import { useIncidents } from '~/hooks/use-incidents';
import { useChats } from '~/hooks/use-chats';
import { useTimezone } from '~/hooks/use-settings';
import { dt, localInputToIso } from '~/lib/format';
import { INCIDENT_STATUSES, INCIDENT_STATUS_LABELS, REPEAT_TYPE_LABELS, SEVERITIES, SEVERITY_LABELS, type IncidentStatus } from '~shared/domain';
import type { IncidentFilters } from '~/lib/api';

export function IncidentsPage() {
  const [sp, setSp] = useSearchParams();
  const tz = useTimezone();
  const chats = useChats();
  const nav = useNavigate();
  const f: IncidentFilters = {
    chatId: sp.get('chatId') ? Number(sp.get('chatId')) : undefined,
    status: (sp.get('status') as IncidentStatus) || undefined,
    minSeverity: sp.get('minSeverity') || undefined,
    topic: sp.get('topic') || undefined,
    from: localInputToIso(sp.get('from') ?? ''),
    to: localInputToIso(sp.get('to') ?? ''),
    borderline: (sp.get('borderline') as 'true' | 'false') || undefined,
    kind: (sp.get('kind') as 'problem' | 'spike') || undefined,
    limit: 50,
    offset: Number(sp.get('offset') ?? 0),
  };
  const { data, isLoading, error } = useIncidents(f);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('offset');
    setSp(next, { replace: true });
  };
  const chatTitle = (id: number) => chats.data?.find((c) => c.id === id)?.title ?? id;

  return (
    <>
      <PageHeader eyebrow="06 · Инциденты" title="Инциденты" description="Повторные сообщения об одной проблеме объединены. «Решено» выставляется только при явном подтверждении в переписке или администратором." />
      <Card className="mb-4 animate-rise p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={sp.get('chatId') ?? ''} onChange={(e) => set('chatId', e.target.value)}>
            <option value="">Все чаты</option>
            {chats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
          <Select value={sp.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Любой статус</option>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INCIDENT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select value={sp.get('minSeverity') ?? ''} onChange={(e) => set('minSeverity', e.target.value)}>
            <option value="">Любая серьёзность</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                от «{SEVERITY_LABELS[s]}»
              </option>
            ))}
          </Select>
          <Select value={sp.get('topic') ?? ''} onChange={(e) => set('topic', e.target.value)}>
            <option value="">Любая тема</option>
            {data?.topics.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Input type="datetime-local" value={sp.get('from') ?? ''} onChange={(e) => set('from', e.target.value)} title="С" />
          <Input type="datetime-local" value={sp.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} title="По" />
          <Select value={sp.get('kind') ?? ''} onChange={(e) => set('kind', e.target.value)}>
            <option value="">Проблемы и всплески</option>
            <option value="problem">Только проблемы</option>
            <option value="spike">Только всплески</option>
          </Select>
          <Select value={sp.get('borderline') ?? ''} onChange={(e) => set('borderline', e.target.value)}>
            <option value="">Все</option>
            <option value="true">Пограничные (на проверку)</option>
            <option value="false">Без пограничных</option>
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
          <Empty title="Инцидентов не найдено" hint="Измените фильтры или дождитесь новых сообщений." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Автор</Th>
                  <Th>Суть</Th>
                  <Th>Серьёзность</Th>
                  <Th>Чат</Th>
                  <Th>Сообщ. / участн.</Th>
                  <Th>Последнее</Th>
                  <Th>Статус</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <Tr key={i.id} onClick={() => nav(`/incidents/${i.id}`)}>
                    <Td className="num text-[13px] text-ink-mute">{i.id}</Td>
                    <Td className="text-[13px]">
                      {i.kind === 'spike' ? (
                        <span className="text-ink-soft">{i.affectedAuthors} участников</span>
                      ) : (
                        <>
                          <p className="font-semibold">{i.authorName ?? 'неизвестен'}</p>
                          {i.affectedAuthors > 1 && <p className="text-[11.5px] text-ink-mute">и ещё {i.affectedAuthors - 1}</p>}
                        </>
                      )}
                    </Td>
                    <Td className="max-w-md">
                      <p className="line-clamp-2 text-[13.5px] font-semibold">
                        {i.kind === 'spike' && '📈 '}
                        {i.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <CategoryChips categories={i.categories} />
                        {i.borderline && <span className="text-[11.5px] font-semibold text-violet">пограничный</span>}
                      </div>
                    </Td>
                    <Td>
                      <SeverityBadge severity={i.severity} />
                      <p className="num mt-1 text-[11.5px] text-ink-mute">уверенность {i.confidence.toFixed(2)}</p>
                    </Td>
                    <Td className="text-[13px]">{chatTitle(i.chatId)}</Td>
                    <Td className="num text-[13px]">
                      {i.messageCount} / {i.affectedAuthors}
                      <span className="block text-[11.5px] text-ink-mute">{REPEAT_TYPE_LABELS[i.repeatType]}</span>
                    </Td>
                    <Td className="num whitespace-nowrap text-[13px]">{dt(i.lastMessageAt, tz)}</Td>
                    <Td>
                      <IncidentStatusBadge status={i.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pager total={data.total} offset={f.offset ?? 0} limit={50} onChange={(o) => set('offset', String(o))} />
          </>
        )}
      </Card>
    </>
  );
}
