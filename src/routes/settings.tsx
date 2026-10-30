import { useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '~/components/layout/page';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { ErrorNote, Loading, Notice, useToast } from '~/components/ui/feedback';
import { Field, Input, Textarea } from '~/components/ui/form';
import { Badge } from '~/components/ui/badge';
import { RulesEditor } from '~/components/rules-editor';
import { useSettings, useSettingsMutations } from '~/hooks/use-settings';
import { useAdminMutations, useAdmins } from '~/hooks/use-auth';
import { useFailedMessages, useRequeue } from '~/hooks/use-chats';
import { dt } from '~/lib/format';
import type { GlobalSettingsDto } from '~shared/schemas';

type NumKey = 'contextWindowHours' | 'catchupMaxReports' | 'delayedThresholdMin' | 'retentionMessagesDays' | 'retentionReportsDays' | 'retentionTechDays' | 'backupKeep';
const NUMS: Array<{ k: NumKey; label: string; hint: string }> = [
  { k: 'retentionMessagesDays', label: 'Хранение сообщений, дн', hint: 'Исходные сообщения, редакции, анализ' },
  { k: 'retentionReportsDays', label: 'Хранение отчётов и инцидентов, дн', hint: 'Отчёты, дайджесты, инциденты, аудит' },
  { k: 'retentionTechDays', label: 'Хранение технических логов, дн', hint: 'Журнал попыток, сырые апдейты, вызовы AI' },
  { k: 'backupKeep', label: 'Резервных копий', hint: 'Ежесуточно в хранилище проекта' },
  { k: 'catchupMaxReports', label: 'Догоняющих отчётов', hint: 'Сколько последних пропущенных периодов отправлять после простоя' },
  { k: 'delayedThresholdMin', label: 'Порог «с задержкой», мин', hint: 'После границы периода' },
  { k: 'contextWindowHours', label: 'Окно контекста, ч', hint: 'Предыдущие сообщения для анализа повторов' },
];

export function SettingsPage() {
  const { data, isLoading, error } = useSettings();
  const m = useSettingsMutations();
  const toast = useToast();
  const [s, setS] = useState<GlobalSettingsDto | null>(null);
  const [topics, setTopics] = useState('');

  useEffect(() => {
    if (data) {
      setS(data.settings);
      setTopics(data.settings.topics.join('\n'));
    }
  }, [data]);

  if (isLoading) return <Loading />;
  if (error || !data || !s) return <ErrorNote error={error} />;

  const save = async () => {
    try {
      await m.save.mutateAsync({ ...s, topics: topics.split('\n').map((t) => t.trim()).filter(Boolean) });
      toast('Настройки сохранены и применяются к новым событиям');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  const rt = data.runtime;
  return (
    <>
      <PageHeader
        eyebrow="08 · Настройки"
        title="Системные настройки"
        description="Значения пилота по умолчанию можно менять. Секреты задаются в .env на сервере и здесь не отображаются."
        actions={
          <>
            <Button variant="ghost" onClick={() => (setS(data.defaults), setTopics(data.defaults.topics.join('\n')))}>
              Значения по умолчанию
            </Button>
            <Button onClick={save} loading={m.save.isPending}>
              Сохранить
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="animate-rise">
          <CardHeader title="Расписание и AI" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Часовой пояс (IANA)" hint="Не зависит от часового пояса сервера">
              <Input value={s.timezone} onChange={(e) => setS({ ...s, timezone: e.target.value })} />
            </Field>
            <Field label="Модель AI" hint="OpenAI-совместимый Responses API">
              <Input value={s.aiModel} onChange={(e) => setS({ ...s, aiModel: e.target.value })} />
            </Field>
            <Field label="Начало дня" hint="Отправка ночного саммари">
              <Input type="time" value={s.dayStart} onChange={(e) => setS({ ...s, dayStart: e.target.value })} />
            </Field>
            <Field label="Начало ночи" hint="Отправка дневного саммари">
              <Input type="time" value={s.nightStart} onChange={(e) => setS({ ...s, nightStart: e.target.value })} />
            </Field>
            <Field label="Темы обращений" hint="По одной на строку; «прочее/не определено» добавляется автоматически" className="sm:col-span-2">
              <Textarea value={topics} onChange={(e) => setTopics(e.target.value)} className="min-h-40" />
            </Field>
          </CardBody>
        </Card>

        <Card className="animate-rise">
          <CardHeader title="Хранение и рассылка" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {NUMS.map((f) => (
              <Field key={f.k} label={f.label} hint={`${f.hint} · по умолчанию ${data.defaults[f.k]}`}>
                <Input type="number" className="num" value={s[f.k]} onChange={(e) => setS({ ...s, [f.k]: Number(e.target.value) })} />
              </Field>
            ))}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4 animate-rise">
        <CardHeader title="Правила по умолчанию для всех чатов" hint="Чат может переопределить любое значение в своей карточке" />
        <CardBody>
          <RulesEditor value={s.rules} onChange={(rules) => setS({ ...s, rules })} defaults={data.defaults.rules} />
        </CardBody>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="animate-rise">
          <CardHeader title="Окружение" hint="Только признак наличия секретов — значения не покидают сервер" />
          <CardBody className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {data.secrets.map((x) => (
                <Badge key={x.name} tone={x.set ? 'ok' : 'neutral'}>
                  <span className="font-mono">{x.name}</span>: {x.set ? 'задан' : 'не задан'}
                </Badge>
              ))}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-ink-soft">Режим приёма Telegram</dt>
              <dd className="font-mono">{rt.telegramMode}</dd>
              <dt className="text-ink-soft">Webhook</dt>
              <dd className="font-mono break-all">{rt.webhookUrl ?? '—'}</dd>
              <dt className="text-ink-soft">Публичный адрес</dt>
              <dd className="font-mono break-all">{rt.publicBaseUrl}</dd>
              <dt className="text-ink-soft">Бот Telegram</dt>
              <dd>{rt.botUsername ? `@${rt.botUsername}` : '—'}</dd>
              <dt className="text-ink-soft">Privacy mode</dt>
              <dd>{rt.botReadsAllGroupMessages === null ? '—' : rt.botReadsAllGroupMessages ? 'выключен (видит все сообщения)' : 'включён — отключите в @BotFather'}</dd>
              <dt className="text-ink-soft">Режим приёма MAX</dt>
              <dd className="font-mono">{rt.maxMode}</dd>
              <dt className="text-ink-soft">Бот MAX</dt>
              <dd>{rt.maxBotUsername ? `@${rt.maxBotUsername}` : '—'}</dd>
              <dt className="text-ink-soft">AI-прокси</dt>
              <dd>{rt.aiConfigured ? 'настроен' : 'не настроен'}</dd>
            </dl>
          </CardBody>
        </Card>
        <BackupCard backups={data.backups} />
        <FailedAnalysisCard />
        <AdminsCard />
      </div>
    </>
  );
}

function BackupCard({ backups }: { backups: string[] }) {
  const m = useSettingsMutations();
  const toast = useToast();
  return (
    <Card className="animate-rise">
      <CardHeader
        title="Резервные копии"
        hint="Ежесуточно после 04:00, NDJSON в хранилище проекта. Восстановление — scripts/restore.ts (см. README)."
        actions={
          <Button size="sm" variant="secondary" loading={m.backup.isPending} onClick={() => m.backup.mutateAsync().then((r) => toast(`Копия ${r.prefix} создана`), (e) => toast(e.message, 'danger'))}>
            Сделать копию сейчас
          </Button>
        }
      />
      <CardBody className="space-y-1 text-[13px]">
        {backups.length ? backups.slice().reverse().map((b) => <p key={b} className="font-mono">{b}</p>) : <p className="text-ink-soft">Копий ещё нет.</p>}
      </CardBody>
    </Card>
  );
}

function FailedAnalysisCard() {
  const failed = useFailedMessages();
  const requeue = useRequeue();
  const toast = useToast();
  return (
    <Card className="animate-rise">
      <CardHeader
        title="Сообщения с неудачным анализом"
        hint="После 3 невалидных ответов модели. Сбой доступности AI сюда не попадает — такие сообщения ждут в очереди."
        actions={
          <Button size="sm" variant="secondary" disabled={!failed.data?.length} loading={requeue.isPending} onClick={() => requeue.mutateAsync(null).then((r) => toast(`В очередь возвращено: ${r.requeued}`), (e) => toast(e.message, 'danger'))}>
            Повторить анализ
          </Button>
        }
      />
      <CardBody className="space-y-1 text-[13px]">
        {failed.data?.length ? (
          failed.data.slice(0, 10).map((m) => (
            <p key={m.id} className="truncate">
              <span className="num text-ink-mute">#{m.messageId}</span> {m.text} <span className="text-danger">— {m.analysisError}</span>
            </p>
          ))
        ) : (
          <p className="text-ink-soft">Нет.</p>
        )}
      </CardBody>
    </Card>
  );
}

function AdminsCard() {
  const { data } = useAdmins();
  const m = useAdminMutations();
  const toast = useToast();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await m.create.mutateAsync({ login, password });
      toast(`Администратор ${login} создан`);
      setLogin('');
      setPassword('');
    } catch (err) {
      toast((err as Error).message, 'danger');
    }
  };
  return (
    <Card className="animate-rise">
      <CardHeader title="Администраторы" />
      <CardBody className="space-y-4 text-sm">
        {data?.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>{a.login}</b> {a.role === 'manager' && <Badge tone="info">руководитель</Badge>} {a.disabled && <Badge tone="neutral">отключён</Badge>}
              <span className="block text-[12px] text-ink-mute">вход: {dt(a.lastLoginAt, 'Asia/Novosibirsk')}</span>
            </span>
            <span className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const p = prompt(`Новый пароль для ${a.login} (не короче 10 символов)`);
                  if (p) m.password.mutateAsync({ id: a.id, password: p }).then(() => toast('Пароль изменён, сессии сброшены'), (e) => toast(e.message, 'danger'));
                }}
              >
                Пароль
              </Button>
              <Button size="sm" variant="ghost" onClick={() => m.setDisabled.mutateAsync({ id: a.id, disabled: !a.disabled }).then(() => toast('Готово'), (e) => toast(e.message, 'danger'))}>
                {a.disabled ? 'Включить' : 'Отключить'}
              </Button>
            </span>
          </div>
        ))}
        <form onSubmit={create} className="grid gap-2 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto]">
          <Input placeholder="логин" value={login} onChange={(e) => setLogin(e.target.value)} required />
          <Input placeholder="пароль ≥ 10 символов" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
          <Button type="submit" loading={m.create.isPending}>
            Добавить
          </Button>
        </form>
        <Notice tone="info">Все действия администраторов фиксируются в аудите.</Notice>
      </CardBody>
    </Card>
  );
}
