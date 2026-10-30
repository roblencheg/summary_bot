import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '~/components/ui/button';
import { PageHeader } from '~/components/layout/page';
import { Card } from '~/components/ui/card';
import { Empty, ErrorNote, Loading, Modal, Notice, useToast } from '~/components/ui/feedback';
import { Field, Select } from '~/components/ui/form';
import { Table, Td, Th, Tr } from '~/components/ui/table';
import { ChatStatusBadge } from '~/components/domain-badges';
import { useChats } from '~/hooks/use-chats';
import { useAppContext, useTimezone } from '~/hooks/use-settings';
import { useMe } from '~/hooks/use-auth';
import { useClaimLink, useDirectorateMutations, useDirectorates } from '~/hooks/use-directorates';
import { ago, dt } from '~/lib/format';
import { CHANNELS, CHANNEL_LABELS, type Channel, type ChatStatus } from '~shared/domain';
import { QUIET_MODE_LABELS, QUIET_MODES, type ClaimLinkDto } from '~shared/schemas';

// бот удалён или группа перенесена в супергруппу — сбора нет, подписки сняты, история доступна
const ARCHIVED: ChatStatus[] = ['removed', 'migrated'];

export function ChatsPage() {
  const { data, isLoading, error } = useChats();
  const ctx = useAppContext();
  const { me, isSuper } = useMe();
  const tz = useTimezone();
  const nav = useNavigate();
  const bot = ctx.data?.botUsername;
  const [claimOpen, setClaimOpen] = useState(false);
  const [tab, setTab] = useState<'active' | 'archive'>('active');
  const archived = data?.filter((c) => ARCHIVED.includes(c.status)) ?? [];
  const working = data?.filter((c) => !ARCHIVED.includes(c.status)) ?? [];
  const rows = tab === 'active' ? working : archived;

  return (
    <>
      <PageHeader
        eyebrow="02 · Чаты"
        title="Чаты поддержки"
        description={
          isSuper
            ? 'Все чаты системы. Чат, добавленный по ссылке руководителя, сразу закрепляется за его дирекцией; без ссылки — попадает в «Неразобранные» (раздел «Дирекции»).'
            : 'Чаты вашей дирекции и чаты, к которым вам открыт доступ на чтение.'
        }
        actions={(isSuper || (me?.directorates.length ?? 0) > 0) && <Button onClick={() => setClaimOpen(true)}>Подключить чат</Button>}
      />
      <div className="mb-4">
        <Notice tone="info" title="Как подключить чат">
          1. Нажмите «Подключить чат», выберите канал и дирекцию. <b>Telegram</b> — откройте полученную ссылку, Telegram предложит выбрать группу, бот добавится в неё сам и закрепит
          чат за дирекцией. <b>MAX</b> — добавьте бота в группу вручную и отправьте в ней команду из модального окна (<span className="font-mono">/connect &lt;код&gt;</span>).
          Сбор начнётся сразу после подключения. История до подключения недоступна.
          <br />
          2. Чтобы бот Telegram видел все сообщения, назначьте его администратором группы или отключите privacy mode в @BotFather:{' '}
          <span className="font-mono">/setprivacy → {bot ? '@' + bot : 'бот'} → Disable</span>.
        </Notice>
      </div>
      <ClaimModal open={claimOpen} onClose={() => setClaimOpen(false)} />
      {!isSuper && <QuietChatsSetting />}
      <div className="mb-3 flex gap-2">
        <Button size="sm" variant={tab === 'active' ? 'primary' : 'ghost'} onClick={() => setTab('active')}>
          Активные · {working.length}
        </Button>
        <Button size="sm" variant={tab === 'archive' ? 'primary' : 'ghost'} onClick={() => setTab('archive')}>
          Архив · {archived.length}
        </Button>
      </div>
      <Card className="animate-rise">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <div className="p-5">
            <ErrorNote error={error} />
          </div>
        ) : !rows.length ? (
          tab === 'active' ? (
            <Empty title="Чатов пока нет" hint="Добавьте бота в групповой чат Telegram — он появится в этом списке со статусом «Ожидает подключения»." />
          ) : (
            <Empty title="Архив пуст" hint="Сюда автоматически попадают чаты, из которых удалили бота. Их история сохраняется." />
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Чат</Th>
                <Th>Дирекция</Th>
                <Th>Статус</Th>
                <Th>Видимость</Th>
                <Th>Старт сбора</Th>
                <Th>Последнее сообщение</Th>
                <Th>Последнее событие</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Tr key={c.id} onClick={() => nav(`/chats/${c.id}`)}>
                  <Td>
                    <p className="font-semibold">
                      {c.title} <span className="rounded bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-mute">{CHANNEL_LABELS[c.channel]}</span>
                    </p>
                    <p className="num text-[12px] text-ink-mute">
                      {c.id} · {c.type}
                      {c.isForum && ' · форум'}
                      {c.username && ` · @${c.username}`}
                    </p>
                  </Td>
                  <Td className="text-[13px]">
                    {c.ownerDirectorate ? c.ownerDirectorate.name : <span className="font-semibold text-signal">неразобранный</span>}
                    {c.access === 'reader' && <span className="block text-ink-mute">доступ на чтение</span>}
                  </Td>
                  <Td>
                    <ChatStatusBadge status={c.status} />
                  </Td>
                  <Td className="text-[13px]">
                    {c.botReadsAll === null ? (
                      <span className="text-ink-mute">не проверено</span>
                    ) : c.botReadsAll ? (
                      <span className="text-ok">все сообщения{c.botIsAdmin ? ' · админ' : ''}</span>
                    ) : (
                      <span className="font-semibold text-danger">только команды</span>
                    )}
                  </Td>
                  <Td className="num text-[13px]">{dt(c.collectionStartedAt, tz)}</Td>
                  <Td className="text-[13px]">
                    {c.lastMessageAt ? (
                      <>
                        <span className="num">{dt(c.lastMessageAt, tz)}</span>
                        <span className="block text-ink-mute">{ago(c.lastMessageAt)}</span>
                      </>
                    ) : (
                      <span className="text-ink-mute">—</span>
                    )}
                  </Td>
                  <Td className="text-[13px] text-ink-soft">{ago(c.lastEventAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

/** Одноразовая ссылка: бот добавляется в выбранную группу и закрепляет её за дирекцией. */
function ClaimModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, isSuper } = useMe();
  const claim = useClaimLink();
  const toast = useToast();
  const [directorateId, setDirectorateId] = useState('');
  const [channel, setChannel] = useState<Channel>('telegram');
  const [link, setLink] = useState<ClaimLinkDto | null>(null);
  const all = useDirectorates(isSuper && open);
  const dirs = isSuper ? (all.data?.directorates ?? []) : (me?.directorates ?? []);

  const issue = async () => {
    try {
      setLink(await claim.mutateAsync({ directorateId: directorateId ? Number(directorateId) : undefined, channel }));
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };
  const close = () => {
    setLink(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title="Подключить чат">
      {link ? (
        <div className="space-y-3 text-sm">
          <p>
            Код для дирекции <b>{link.directorate}</b> ({CHANNEL_LABELS[link.channel]}). Действует до {new Date(link.expiresAt).toLocaleString('ru-RU')}.
          </p>
          {link.link ? (
            <>
              <p>Откройте ссылку — Telegram предложит выбрать группу, бот добавится и начнёт сбор сразу.</p>
              <div className="flex gap-2">
                <input readOnly value={link.link} className="num h-10 flex-1 rounded-lg border border-line-strong bg-sunken px-3 text-[13px]" onFocus={(e) => e.target.select()} />
                <Button variant="secondary" onClick={() => navigator.clipboard.writeText(link.link!).then(() => toast('Ссылка скопирована'))}>
                  Копировать
                </Button>
              </div>
              <p className="text-ink-soft">
                Если бот уже в группе, отправьте в ней команду <span className="num font-semibold">/connect {link.code}</span>.
              </p>
            </>
          ) : (
            <p className="text-ink-soft">
              Добавьте бота {CHANNEL_LABELS[link.channel]} в группу и отправьте в ней команду <span className="num font-semibold">/connect {link.code}</span>.
            </p>
          )}
          <Button className="w-full" onClick={close}>
            Готово
          </Button>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p>Сгенерируем одноразовый код. Чат, в который вы добавите бота по нему, будет виден только вашей дирекции.</p>
          <Field label="Канал">
            <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {CHANNEL_LABELS[ch]}
                </option>
              ))}
            </Select>
          </Field>
          {(isSuper || dirs.length > 1) && (
            <Field label="Дирекция" hint={isSuper ? 'По умолчанию — первая дирекция в системе' : undefined}>
              <Select value={directorateId} onChange={(e) => setDirectorateId(e.target.value)}>
                {isSuper && <option value="">— по умолчанию —</option>}
                {dirs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button className="w-full" loading={claim.isPending} onClick={issue}>
            Получить код
          </Button>
        </div>
      )}
    </Modal>
  );
}

/** Режим чатов без событий в саммари — настройка дирекции руководителя. */
function QuietChatsSetting() {
  const { me } = useMe();
  const m = useDirectorateMutations();
  const toast = useToast();
  if (!me?.directorates.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]">
      <span className="font-semibold">Чаты без событий в саммари</span>
      {me.directorates.map((d) => (
        <label key={d.id} className="flex items-center gap-2">
          {me.directorates.length > 1 && <span className="text-ink-soft">{d.name}:</span>}
          <Select
            className="h-8 w-64 text-[13px]"
            value={d.quietChats}
            onChange={(e) =>
              m.setQuietChats
                .mutateAsync({ id: d.id, mode: e.target.value as (typeof QUIET_MODES)[number] })
                .then(() => toast('Сохранено'), (err) => toast((err as Error).message, 'danger'))
            }
          >
            {QUIET_MODES.map((q) => (
              <option key={q} value={q}>
                {QUIET_MODE_LABELS[q]}
              </option>
            ))}
          </Select>
        </label>
      ))}
      <span className="text-ink-mute">порядок чатов в саммари — по важности, она задаётся в карточке чата</span>
    </div>
  );
}
