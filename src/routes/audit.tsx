import { useState } from 'react';
import { PageHeader } from '~/components/layout/page';
import { Card } from '~/components/ui/card';
import { Empty, Loading, Pager } from '~/components/ui/feedback';
import { Input, Select } from '~/components/ui/form';
import { Table, Td, Th } from '~/components/ui/table';
import { useAudit } from '~/hooks/use-audit';
import { useTimezone } from '~/hooks/use-settings';
import { dt } from '~/lib/format';

const ENTITIES: Record<string, string> = {
  recipient: 'Получатели и подписки',
  chat: 'Чаты и правила',
  incident: 'Инциденты',
  settings: 'Настройки',
  admin: 'Администраторы',
  delivery: 'Отправки',
  report: 'Отчёты',
};

function Json({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-ink-mute">—</span>;
  return <pre className="max-h-40 max-w-sm overflow-auto whitespace-pre-wrap break-all font-mono text-[11.5px] leading-snug text-ink-soft">{JSON.stringify(v, null, 1)}</pre>;
}

export function AuditPage() {
  const [entity, setEntity] = useState('');
  const [actor, setActor] = useState('');
  const [offset, setOffset] = useState(0);
  const tz = useTimezone();
  const { data, isLoading } = useAudit({ entity: entity || undefined, actor: actor || undefined, offset });

  return (
    <>
      <PageHeader eyebrow="09 · Аудит" title="Журнал изменений" description="Кто и когда изменил права, правила, подписки и статусы. Секреты и пароли в журнал не попадают." />
      <Card className="mb-4 animate-rise p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select value={entity} onChange={(e) => (setEntity(e.target.value), setOffset(0))}>
            <option value="">Все объекты</option>
            {Object.entries(ENTITIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input placeholder="Автор (логин, telegram:ID, max:ID, system)" value={actor} onChange={(e) => (setActor(e.target.value), setOffset(0))} />
        </div>
      </Card>
      <Card className="animate-rise">
        {isLoading ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty title="Записей нет" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Время</Th>
                  <Th>Кто</Th>
                  <Th>Действие</Th>
                  <Th>Было</Th>
                  <Th>Стало</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <Td className="num whitespace-nowrap text-[12.5px]">{dt(a.at, tz, true)}</Td>
                    <Td className="text-[13px] font-semibold">{a.actor}</Td>
                    <Td className="text-[13px]">
                      <span className="font-mono text-[12px]">{a.action}</span>
                      <span className="block text-ink-mute">
                        {ENTITIES[a.entity] ?? a.entity}
                        {a.entityId && ` · ${a.entityId}`}
                      </span>
                    </Td>
                    <Td>
                      <Json v={a.oldValue} />
                    </Td>
                    <Td>
                      <Json v={a.newValue} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager total={data.total} offset={offset} limit={50} onChange={setOffset} />
          </>
        )}
      </Card>
    </>
  );
}
