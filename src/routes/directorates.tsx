import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '~/components/layout/page';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { Empty, ErrorNote, Loading, Notice, useToast } from '~/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '~/components/ui/form';
import { Table, Td, Th } from '~/components/ui/table';
import { ChatStatusBadge } from '~/components/domain-badges';
import { useDirectorateMutations, useDirectorates } from '~/hooks/use-directorates';
import { useChats } from '~/hooks/use-chats';
import { useMe } from '~/hooks/use-auth';
import { ago } from '~/lib/format';
import { IMPORTANCE_LABELS, IMPORTANCE_LEVELS, QUIET_MODE_LABELS, QUIET_MODES, type DirectoratesOverviewDto } from '~shared/schemas';
import { CHANNEL_LABELS } from '~shared/domain';

function ChannelTag({ channel }: { channel: 'telegram' | 'max' }) {
  return <span className="ml-1.5 rounded bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-mute">{CHANNEL_LABELS[channel]}</span>;
}

type Dir = DirectoratesOverviewDto['directorates'][number];

/** Раздел суперадмина: дирекции, руководители, доступ дирекций к чатам, неразобранные чаты. */
export function DirectoratesPage() {
  const { isSuper } = useMe();
  const { data, isLoading, error } = useDirectorates(isSuper);
  const m = useDirectorateMutations();
  const toast = useToast();
  const [name, setName] = useState('');

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

  if (!isSuper) return <ErrorNote error={new Error('Раздел доступен только суперадмину')} />;
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorNote error={error} />;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => m.create.mutateAsync(name), 'Дирекция создана')) setName('');
  };

  return (
    <>
      <PageHeader
        eyebrow="10 · Дирекции"
        title="Дирекции и руководители"
        description="Руководитель видит только чаты и получателей своих дирекций. Чат принадлежит одной дирекции-владельцу; другим можно открыть доступ на чтение."
      />
      <div className="space-y-4">
        {data.unassigned.length > 0 && <UnassignedCard data={data} run={run} />}

        <ManagersCard data={data} run={run} />

        {data.directorates.map((d) => (
          <DirectorateCard key={d.id} d={d} data={data} run={run} />
        ))}

        <Card className="animate-rise">
          <CardHeader title="Новая дирекция" />
          <CardBody>
            <form className="flex flex-wrap items-end gap-3" onSubmit={create}>
              <Field label="Название" className="min-w-64 flex-1">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Коммерческая дирекция" />
              </Field>
              <Button type="submit" loading={m.create.isPending} disabled={!name.trim()}>
                Создать
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

type Run = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;

function UnassignedCard({ data, run }: { data: DirectoratesOverviewDto; run: Run }) {
  const m = useDirectorateMutations();
  const [target, setTarget] = useState<Record<number, string>>({});
  return (
    <Card className="animate-rise">
      <CardHeader title={`Неразобранные чаты · ${data.unassigned.length}`} hint="Бота добавили без ссылки руководителя. Их не видит ни один руководитель, пока вы не назначите дирекцию." />
      <Table>
        <thead>
          <tr>
            <Th>Чат</Th>
            <Th>Статус</Th>
            <Th>Назначить владельцем</Th>
          </tr>
        </thead>
        <tbody>
          {data.unassigned.map((c) => (
            <tr key={c.id}>
              <Td>
                <Link to={`/chats/${c.id}`} className="font-semibold hover:underline">
                  {c.title}
                </Link>
                <ChannelTag channel={c.channel} />
                <p className="num text-[12px] text-ink-mute">{c.id}</p>
              </Td>
              <Td>
                <ChatStatusBadge status={c.status} />
              </Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  <Select className="h-8 w-56 text-[13px]" value={target[c.id] ?? ''} onChange={(e) => setTarget({ ...target, [c.id]: e.target.value })}>
                    <option value="">— дирекция —</option>
                    {data.directorates.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    disabled={!target[c.id]}
                    onClick={() => run(() => m.setChatAccess.mutateAsync({ chatId: c.id, directorateId: Number(target[c.id]), access: 'owner' }), 'Владелец назначен')}
                  >
                    Назначить
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function DirectorateCard({ d, data, run }: { d: Dir; data: DirectoratesOverviewDto; run: Run }) {
  const m = useDirectorateMutations();
  const chats = useChats();
  const [rename, setRename] = useState<string | null>(null);
  const [add, setAdd] = useState({ chatId: '', access: 'reader' as 'owner' | 'reader' });
  const managers = data.managers.filter((x) => d.managerIds.includes(x.id));
  const present = new Set(d.chats.map((c) => c.chatId));
  const candidates = (chats.data ?? []).filter((c) => !present.has(c.id) && c.status !== 'migrated');

  return (
    <Card className="animate-rise">
      <CardHeader
        title={
          rename === null ? (
            d.name
          ) : (
            <span className="flex gap-2">
              <Input className="h-8 w-64" value={rename} onChange={(e) => setRename(e.target.value)} />
              <Button size="sm" onClick={() => run(() => m.rename.mutateAsync({ id: d.id, name: rename }), 'Переименовано').then((ok) => ok && setRename(null))}>
                Сохранить
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRename(null)}>
                Отмена
              </Button>
            </span>
          )
        }
        hint={`Руководители: ${managers.map((x) => x.login).join(', ') || 'не назначены'} · получателей: ${d.recipients}`}
        actions={
          rename === null && (
            <Button size="sm" variant="ghost" onClick={() => setRename(d.name)}>
              Переименовать
            </Button>
          )
        }
      />
      {d.chats.length === 0 ? (
        <CardBody className="text-sm text-ink-soft">Чатов пока нет. Руководитель подключает свой чат кнопкой «Подключить чат» в разделе «Чаты».</CardBody>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Чат</Th>
              <Th>Статус</Th>
              <Th>Доступ</Th>
              <Th>Важность в саммари</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {d.chats.map((c) => (
              <tr key={c.chatId}>
                <Td>
                  <Link to={`/chats/${c.chatId}`} className="font-semibold hover:underline">
                    {c.title}
                  </Link>
                  <ChannelTag channel={c.channel} />
                </Td>
                <Td>
                  <ChatStatusBadge status={c.status} />
                </Td>
                <Td>{c.access === 'owner' ? <Badge tone="ok">владелец</Badge> : <Badge tone="info">чтение</Badge>}</Td>
                <Td>
                  <Select
                    className="h-8 w-32 text-[13px]"
                    value={c.importance}
                    onChange={(e) =>
                      run(
                        () => m.setImportance.mutateAsync({ chatId: c.chatId, directorateId: d.id, importance: e.target.value as (typeof IMPORTANCE_LEVELS)[number] }),
                        'Важность сохранена',
                      )
                    }
                  >
                    {IMPORTANCE_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {IMPORTANCE_LABELS[l]}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      window.confirm(
                        c.access === 'owner'
                          ? `Убрать «${c.title}» из дирекции «${d.name}»? Чат станет неразобранным, подписки получателей, которым он больше не виден, будут сняты.`
                          : `Закрыть дирекции «${d.name}» доступ к «${c.title}»? Подписки её получателей на этот чат будут сняты.`,
                      ) && run(() => m.setChatAccess.mutateAsync({ chatId: c.chatId, directorateId: d.id, access: null }), 'Доступ отозван')
                    }
                  >
                    Отозвать
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <CardBody className="flex flex-wrap items-center gap-2 border-t border-line/70 text-[13px]">
        <span className="text-ink-soft">Чаты без событий в саммари:</span>
        <Select
          className="h-8 w-64 text-[13px]"
          value={d.quietChats}
          onChange={(e) => run(() => m.setQuietChats.mutateAsync({ id: d.id, mode: e.target.value as (typeof QUIET_MODES)[number] }), 'Сохранено')}
        >
          {QUIET_MODES.map((q) => (
            <option key={q} value={q}>
              {QUIET_MODE_LABELS[q]}
            </option>
          ))}
        </Select>
      </CardBody>
      <CardBody className="flex flex-wrap items-end gap-2 border-t border-line/70">
        <Field label="Дать доступ к чату" className="min-w-56 flex-1">
          <Select value={add.chatId} onChange={(e) => setAdd({ ...add, chatId: e.target.value })}>
            <option value="">— чат —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {CHANNEL_LABELS[c.channel]}
                {c.ownerDirectorate ? ` (владелец: ${c.ownerDirectorate.name})` : ' (неразобранный)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Тип доступа">
          <Select value={add.access} onChange={(e) => setAdd({ ...add, access: e.target.value as 'owner' | 'reader' })}>
            <option value="reader">Чтение</option>
            <option value="owner">Владелец</option>
          </Select>
        </Field>
        <Button
          disabled={!add.chatId}
          loading={m.setChatAccess.isPending}
          onClick={() =>
            run(() => m.setChatAccess.mutateAsync({ chatId: Number(add.chatId), directorateId: d.id, access: add.access }), 'Доступ выдан').then(
              (ok) => ok && setAdd({ chatId: '', access: 'reader' }),
            )
          }
        >
          Дать доступ
        </Button>
      </CardBody>
    </Card>
  );
}

function ManagersCard({ data, run }: { data: DirectoratesOverviewDto; run: Run }) {
  const m = useDirectorateMutations();
  const [form, setForm] = useState({ login: '', password: '', directorateIds: [] as number[] });
  const [editing, setEditing] = useState<{ id: number; ids: number[] } | null>(null);
  const dirName = (id: number) => data.directorates.find((d) => d.id === id)?.name ?? `#${id}`;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => m.createManager.mutateAsync(form), `Руководитель ${form.login} создан`)) setForm({ login: '', password: '', directorateIds: [] });
  };

  const toggle = (ids: number[], id: number, on: boolean) => (on ? [...ids, id] : ids.filter((x) => x !== id));

  return (
    <Card className="animate-rise">
      <CardHeader title="Руководители" hint="Вход в облегчённый интерфейс: обзор, чаты, пользователи, инциденты и отчёты своей дирекции." />
      {data.managers.length === 0 ? (
        <CardBody>
          <Empty title="Руководителей пока нет" hint="Создайте учётную запись ниже — логин и пароль передайте руководителю." />
        </CardBody>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Логин</Th>
              <Th>Дирекции</Th>
              <Th>Последний вход</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.managers.map((x) => (
              <tr key={x.id}>
                <Td>
                  <span className="font-semibold">{x.login}</span>
                  {x.disabled && (
                    <Badge tone="danger" className="ml-2">
                      отключён
                    </Badge>
                  )}
                </Td>
                <Td className="text-[13px]">
                  {editing?.id === x.id ? (
                    <div className="space-y-1">
                      {data.directorates.map((d) => (
                        <Checkbox key={d.id} label={d.name} checked={editing.ids.includes(d.id)} onChange={(on) => setEditing({ ...editing, ids: toggle(editing.ids, d.id, on) })} />
                      ))}
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={() => run(() => m.setManagerDirectorates.mutateAsync(editing), 'Дирекции сохранены').then((ok) => ok && setEditing(null))}>
                          Сохранить
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Отмена
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button className="cursor-pointer text-left hover:underline" onClick={() => setEditing({ id: x.id, ids: x.directorateIds })}>
                      {x.directorateIds.map(dirName).join(', ') || <span className="text-danger">не назначены</span>}
                    </button>
                  )}
                </Td>
                <Td className="text-[13px] text-ink-soft">{x.lastLoginAt ? ago(x.lastLoginAt) : 'не входил'}</Td>
                <Td className="whitespace-nowrap text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const password = window.prompt(`Новый пароль для ${x.login} (не короче 10 символов)`);
                      if (password) run(() => m.managerPassword.mutateAsync({ id: x.id, password }), 'Пароль изменён, сессии руководителя завершены');
                    }}
                  >
                    Пароль
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => run(() => m.managerDisabled.mutateAsync({ id: x.id, disabled: !x.disabled }), x.disabled ? 'Вход разрешён' : 'Вход запрещён')}
                  >
                    {x.disabled ? 'Включить' : 'Отключить'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <CardBody className="border-t border-line/70">
        <form className="space-y-3" onSubmit={create}>
          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink-soft">Новый руководитель</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Логин">
              <Input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} placeholder="klimenko" autoComplete="off" />
            </Field>
            <Field label="Пароль" hint="Не короче 10 символов">
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            {data.directorates.map((d) => (
              <Checkbox key={d.id} label={d.name} checked={form.directorateIds.includes(d.id)} onChange={(on) => setForm({ ...form, directorateIds: toggle(form.directorateIds, d.id, on) })} />
            ))}
          </div>
          {!form.directorateIds.length && <Notice tone="info">Без дирекции руководитель войдёт, но не увидит ни одного чата.</Notice>}
          <Button type="submit" loading={m.createManager.isPending} disabled={!form.login.trim() || form.password.length < 10}>
            Создать руководителя
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
