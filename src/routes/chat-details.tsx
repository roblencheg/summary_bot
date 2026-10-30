import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '~/components/layout/page';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { ErrorNote, Loading, Notice, useToast } from '~/components/ui/feedback';
import { Select, Textarea } from '~/components/ui/form';
import { Table, Td, Th, Tr } from '~/components/ui/table';
import { CategoryChips, ChatStatusBadge } from '~/components/domain-badges';
import { RulesEditor, diffRules } from '~/components/rules-editor';
import { MessageModal } from '~/components/message-modal';
import { useChat, useChatMessages, useChatMutations } from '~/hooks/use-chats';
import { useAppContext, useTimezone } from '~/hooks/use-settings';
import { useDirectorateMutations } from '~/hooks/use-directorates';
import { IMPORTANCE_LABELS, IMPORTANCE_LEVELS } from '~shared/schemas';
import { dt } from '~/lib/format';
import type { ChatRulesDto } from '~shared/schemas';
import { CHANNEL_LABELS, type Channel } from '~shared/domain';

function parseStaff(text: string, channel: Channel): Array<{ telegramUserId: number; label: string | null }> {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [id, ...rest] = l.split(/\s+/);
      const n = Number(id);
      if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`Строка «${l}»: первым должен идти числовой ID (${CHANNEL_LABELS[channel]})`);
      return { telegramUserId: n, label: rest.join(' ') || null };
    });
}

export function ChatDetailsPage() {
  const id = Number(useParams().id);
  const { data: chat, isLoading, error } = useChat(id);
  const ctx = useAppContext();
  const m = useChatMutations(id);
  const tz = useTimezone();
  const toast = useToast();
  const [rules, setRules] = useState<ChatRulesDto | null>(null);
  const [staff, setStaff] = useState('');
  const [offset, setOffset] = useState(0);
  const [openMsg, setOpenMsg] = useState<number | null>(null);
  const messages = useChatMessages(id, offset);

  useEffect(() => {
    if (chat) {
      setRules(chat.effectiveRules);
      setStaff(chat.staff.map((s) => `${s.telegramUserId}${s.label ? ' ' + s.label : ''}`).join('\n'));
    }
  }, [chat]);

  if (isLoading) return <Loading />;
  if (error || !chat) return <ErrorNote error={error} />;
  const defaults = ctx.data?.defaultRules;
  // доступ на чтение: сбор, сотрудники и правила меняет только дирекция-владелец
  const canManage = chat.access !== 'reader';

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={`02 · Чаты · ${chat.id}`}
        title={chat.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ChatStatusBadge status={chat.status} />
            <span className="rounded bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-mute">{CHANNEL_LABELS[chat.channel]}</span>
            <span className="num">
              {chat.type}
              {chat.isForum && ' · форум с темами'}
              {chat.username && ` · @${chat.username}`}
            </span>
          </span>
        }
        actions={
          canManage && (
          <>
            <Button variant="secondary" loading={m.checkRights.isPending} onClick={() => run(() => m.checkRights.mutateAsync(), 'Права проверены')}>
              Проверить права
            </Button>
            {chat.status === 'active' ? (
              <Button variant="danger" loading={m.deactivate.isPending} onClick={() => run(() => m.deactivate.mutateAsync(), 'Сбор выключен')}>
                Выключить сбор
              </Button>
            ) : (
              chat.status !== 'removed' &&
              chat.status !== 'migrated' && (
                <Button variant="signal" loading={m.activate.isPending} onClick={() => run(() => m.activate.mutateAsync(), 'Сбор и анализ включены')}>
                  Активировать сбор
                </Button>
              )
            )}
          </>
          )
        }
      />

      <div className="mb-4 space-y-3">
        <p className="text-[13px] text-ink-soft">
          Дирекция: <b>{chat.ownerDirectorate?.name ?? 'не назначена (неразобранный)'}</b>
          {chat.access === 'reader' && ' · у вашей дирекции доступ на чтение: настройки чата меняет дирекция-владелец'}
        </p>
        {chat.importance && <ImportancePicker chatId={chat.id} value={chat.importance} />}
        {chat.status === 'removed' && (
          <Notice tone="info" title="Чат в архиве">
            Бот удалён из чата или лишён прав: сбор остановлен, подписки получателей на чат сняты. Сообщения и инциденты сохранены. Если вернуть
            бота, чат восстановится, но подписки нужно будет назначить заново.
          </Notice>
        )}
        {chat.rightsError && <Notice tone="danger" title="Ограничение доступа бота">{chat.rightsError}</Notice>}
        {chat.status === 'pending' && (
          <Notice tone="info">Бот уже в чате, но сообщения не собираются, пока вы не нажмёте «Активировать сбор». Подписки на чат не создаются автоматически.</Notice>
        )}
        {chat.migratedTo && (
          <Notice tone="info">
            Группа преобразована в супергруппу:{' '}
            <Link className="font-semibold underline" to={`/chats/${chat.migratedTo}`}>
              новый чат {chat.migratedTo}
            </Link>{' '}
            (настройки и подписки перенесены).
          </Notice>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="animate-rise">
          <CardHeader title="Состояние" />
          <CardBody className="space-y-2 text-sm">
            <Row k="Старт сбора" v={dt(chat.collectionStartedAt, tz)} />
            <Row k="Последнее сообщение" v={dt(chat.lastMessageAt, tz)} />
            <Row k="Последнее событие" v={dt(chat.lastEventAt, tz)} />
            <Row k="Статус бота" v={chat.botMemberStatus ?? '—'} />
            <Row k="Бот — администратор" v={chat.botIsAdmin === null ? '—' : chat.botIsAdmin ? 'да' : 'нет'} />
            <Row k="Видит все сообщения" v={chat.botReadsAll === null ? '—' : chat.botReadsAll ? 'да' : 'нет'} />
            <Row k="Права проверены" v={dt(chat.rightsCheckedAt, tz)} />
            <p className="pt-2 text-[12px] leading-relaxed text-ink-mute">Отсутствие сообщений само по себе не означает сбой — смотрите пробелы сбора в обзоре.</p>
          </CardBody>
        </Card>

        <Card className="animate-rise">
          <CardHeader title="Сотрудники поддержки" hint={`По одному на строку: числовой ID пользователя ${CHANNEL_LABELS[chat.channel]} и подпись. Нужны для «есть ответ / возможно без ответа».`} />
          <CardBody className="space-y-3">
            <Textarea className="num min-h-36" placeholder={'123456789 Сотрудник 01\n987654321 Сотрудник 02'} value={staff} onChange={(e) => setStaff(e.target.value)} />
            <Button
              size="sm"
              disabled={!canManage}
              loading={m.setStaff.isPending}
              onClick={() => run(async () => m.setStaff.mutateAsync(parseStaff(staff, chat.channel)), 'Список сотрудников сохранён')}
            >
              Сохранить список
            </Button>
          </CardBody>
        </Card>

        <Card className="animate-rise">
          <CardHeader title="Кому уходит этот чат" />
          <CardBody className="space-y-4 text-sm">
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Саммари</p>
              {chat.summaryRecipients.length ? chat.summaryRecipients.map((r) => <RecipientLink key={r.id} {...r} />) : <p className="text-ink-mute">никому</p>}
            </div>
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Алерты</p>
              {chat.alertRecipients.length ? chat.alertRecipients.map((r) => <RecipientLink key={r.id} {...r} />) : <p className="text-ink-mute">никому</p>}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4 animate-rise">
        <CardHeader
          title="Правила анализа и алертов для чата"
          hint="Значения, отличающиеся от глобальных, сохраняются как переопределение чата."
          actions={
            rules &&
            defaults &&
            canManage && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setRules(defaults)}>
                  Сбросить к глобальным
                </Button>
                <Button size="sm" loading={m.setRules.isPending} onClick={() => run(() => m.setRules.mutateAsync(diffRules(rules, defaults)), 'Правила чата сохранены')}>
                  Сохранить правила
                </Button>
              </>
            )
          }
        />
        <CardBody>{rules && <RulesEditor value={rules} onChange={setRules} defaults={defaults} />}</CardBody>
      </Card>

      <Card className="mt-4 animate-rise">
        <CardHeader title="Последние сообщения" hint="Исходный текст без маскирования. Нажмите на строку — результат анализа и редакции." />
        {messages.isLoading ? (
          <Loading />
        ) : !messages.data?.length ? (
          <CardBody className="text-sm text-ink-soft">Сообщений нет.</CardBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Время</Th>
                <Th>Автор</Th>
                <Th>Текст</Th>
                <Th>Анализ</Th>
              </tr>
            </thead>
            <tbody>
              {messages.data.map((msg) => (
                <Tr key={msg.id} onClick={() => setOpenMsg(msg.id)}>
                  <Td className="num whitespace-nowrap text-[13px]">{dt(msg.sentAt, tz)}</Td>
                  <Td className="text-[13px]">
                    {msg.authorName}
                    {msg.isStaff && <span className="block text-[11px] font-semibold text-info">поддержка</span>}
                  </Td>
                  <Td className="max-w-md text-[13px]">
                    <p className="line-clamp-2">{msg.hasText ? msg.text : <i className="text-ink-mute">вложение без текста</i>}</p>
                  </Td>
                  <Td className="text-[12px]">
                    {msg.analysisStatus === 'done' ? (
                      msg.categories.length ? (
                        <CategoryChips categories={msg.categories} />
                      ) : (
                        <span className="text-ink-mute">без сигналов</span>
                      )
                    ) : (
                      <span className={msg.analysisStatus === 'failed' ? 'text-danger' : 'text-ink-mute'}>{msg.analysisStatus}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="flex justify-end gap-2 px-4 py-3">
          <Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
            ← Новее
          </Button>
          <Button variant="ghost" size="sm" disabled={(messages.data?.length ?? 0) < 50} onClick={() => setOffset(offset + 50)}>
            Старее →
          </Button>
        </div>
      </Card>
      <MessageModal id={openMsg} onClose={() => setOpenMsg(null)} />
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex justify-between gap-3">
      <span className="text-ink-soft">{k}</span>
      <span className="num text-right">{v}</span>
    </p>
  );
}

function RecipientLink({ id, name }: { id: number; name: string }) {
  return (
    <Link to={`/users/${id}`} className="block py-0.5 font-semibold hover:text-signal">
      {name}
    </Link>
  );
}

/** Важность чата в саммари для дирекции руководителя: важные чаты идут первыми и помечены «★». */
function ImportancePicker({ chatId, value }: { chatId: number; value: (typeof IMPORTANCE_LEVELS)[number] }) {
  const m = useDirectorateMutations();
  const toast = useToast();
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-ink-soft">Важность в саммари:</span>
      <Select
        className="h-8 w-40 text-[13px]"
        value={value}
        disabled={m.setImportance.isPending}
        onChange={(e) =>
          m.setImportance
            .mutateAsync({ chatId, importance: e.target.value as (typeof IMPORTANCE_LEVELS)[number] })
            .then(() => toast('Важность сохранена'), (err) => toast((err as Error).message, 'danger'))
        }
      >
        {IMPORTANCE_LEVELS.map((l) => (
          <option key={l} value={l}>
            {IMPORTANCE_LABELS[l]}
          </option>
        ))}
      </Select>
      <span className="text-ink-mute">важные идут в саммари первыми и помечены «★»</span>
    </div>
  );
}
