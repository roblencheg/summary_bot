import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '~/components/layout/page';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { ErrorNote, Loading, Notice } from '~/components/ui/feedback';
import { Select } from '~/components/ui/form';
import { Stat, StatusLine } from '~/components/stat';
import { useOverview } from '~/hooks/use-overview';
import { useChats } from '~/hooks/use-chats';
import { useTimezone } from '~/hooks/use-settings';
import { useMe } from '~/hooks/use-auth';
import { ago, bytes, dt, num } from '~/lib/format';
import { CHAT_STATUS_LABELS, DELIVERY_STATUS_LABELS, type ChatStatus, type DeliveryStatus } from '~shared/domain';

const GAP_LABELS: Record<string, string> = {
  service_down: 'сервис не работал',
  intake_error: 'ошибки приёма Telegram',
  intake_error_max: 'ошибки приёма MAX',
  bot_removed: 'бот удалён / нет прав',
};

export function OverviewPage() {
  const [hours, setHours] = useState(24);
  const tz = useTimezone();
  const { data: o, isLoading, error } = useOverview(hours);
  const chats = useChats();
  // руководителю — только обстановка по своим чатам, без технического состояния системы
  const { isSuper } = useMe();

  if (isLoading) return <Loading />;
  if (error || !o) return <ErrorNote error={error} />;

  const s = o.service;
  const intakeOk = s.telegramConfigured && s.intake.mode !== 'off' && !s.intake.failingSince;
  const maxIntakeOk = s.maxConfigured && s.maxIntake.mode !== 'off' && !s.maxIntake.failingSince;
  const aiOk = s.ai.configured && !s.ai.failingSince;
  const lagMin = o.analysis.oldestPendingAt ? Math.round((Date.now() - new Date(o.analysis.oldestPendingAt).getTime()) / 60000) : 0;
  const chatTitle = (id: number) => chats.data?.find((c) => c.id === id)?.title ?? `чат ${id}`;
  const privacyIssue = chats.data?.filter((c) => c.status === 'active' && c.botReadsAll === false) ?? [];
  const pendingChats = chats.data?.filter((c) => c.status === 'pending') ?? [];

  return (
    <>
      <PageHeader
        eyebrow="01 · Обзор"
        title="Состояние мониторинга"
        description={`Данные на ${dt(o.generatedAt, tz, true)} (${tz}). Обновляется каждые 30 секунд.`}
        actions={
          <Select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-44">
            <option value={1}>За последний час</option>
            <option value={24}>За 24 часа</option>
            <option value={168}>За 7 дней</option>
          </Select>
        }
      />

      <div className="mb-6 space-y-3">
        {isSuper && !s.telegramConfigured && <Notice tone="danger" title="Бот Telegram не настроен">Задайте секрет TELEGRAM_BOT_TOKEN в настройках проекта.</Notice>}
        {isSuper && s.telegramConfigured && s.intake.mode === 'off' && (
          <Notice tone="info" title="Приём Telegram выключен в этом окружении">
            В dev-окружении приём выключен, чтобы не мешать prod-webhook. Сообщения принимает опубликованная версия.
          </Notice>
        )}
        {isSuper && !s.maxConfigured && <Notice tone="info" title="Бот MAX не настроен">Задайте секрет MAX_BOT_TOKEN в настройках проекта, если нужен канал MAX.</Notice>}
        {isSuper && s.maxConfigured && s.maxIntake.mode === 'off' && (
          <Notice tone="info" title="Приём MAX выключен в этом окружении">
            В dev-окружении приём выключен, чтобы не мешать prod-polling. Сообщения принимает опубликованная версия.
          </Notice>
        )}
        {isSuper && s.bot.readsAll === false && (
          <Notice title="Privacy mode бота включён">
            Бот видит в группах только команды и ответы на свои сообщения. Отключите privacy mode в @BotFather (/setprivacy → Disable) и добавьте бота в чаты заново —
            или назначьте бота администратором групп.
          </Notice>
        )}
        {privacyIssue.length > 0 && (
          <Notice tone="danger" title="Ограниченная видимость в активных чатах">
            {privacyIssue.map((c) => c.title).join(', ')} — бот не видит обычные сообщения. Нулевая активность в этих чатах не означает отсутствие обращений.
          </Notice>
        )}
        {pendingChats.length > 0 && (
          <Notice tone="info" title={`Новые чаты ждут подключения: ${pendingChats.length}`}>
            <Link to="/chats" className="font-semibold underline">
              Перейти к чатам
            </Link>{' '}
            {isSuper ? 'и активировать сбор или назначить дирекцию.' : 'и активировать сбор.'}
          </Notice>
        )}
      </div>

      <div className={`stagger mb-6 grid grid-cols-2 gap-3 ${isSuper ? 'lg:grid-cols-4' : ''}`}>
        <Stat label="Сообщений" value={num(o.messages.messages)} hint={`${o.messages.chats} чатов · ${o.messages.authors} авторов · пик ${o.messages.peakPerMinute}/мин`} />
        <Stat
          label="Активные инциденты"
          value={num(o.incidents.open)}
          tone={o.incidents.open ? 'signal' : 'ok'}
          hint={
            <>
              новых {o.incidents.newCount} · <Link to="/incidents?borderline=true" className="underline">пограничных {o.incidents.borderline}</Link>
            </>
          }
        />
        {isSuper && (
        <Stat
          label="Очередь анализа"
          value={num(o.analysis.pending)}
          tone={lagMin > 5 ? 'danger' : o.analysis.pending ? 'signal' : 'ok'}
          hint={o.analysis.pending ? `отставание ${lagMin} мин · ошибок ${o.analysis.failed}` : `ошибок анализа: ${o.analysis.failed}`}
        />
        )}
        {isSuper && (
        <Stat
          label="Очередь отправок"
          value={num(o.delivery.pending)}
          tone={o.delivery.failed ? 'danger' : 'ok'}
          hint={`ошибок ${o.delivery.failed} · с неопределённым результатом ${o.delivery.uncertain}`}
        />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        {isSuper && (
        <Card className="animate-rise">
          <CardHeader title="Компоненты" hint="Health/readiness и состояние внешних сервисов" />
          <CardBody className="divide-y divide-line/70 py-1">
            <StatusLine
              ok={intakeOk}
              warn={s.intake.mode === 'off'}
              label={`Приём Telegram · ${s.intake.mode}`}
              detail={
                s.intake.failingSince
                  ? `Ошибки с ${dt(s.intake.failingSince, tz)}: ${s.intake.lastErrorMessage ?? ''}`
                  : s.intake.mode === 'webhook'
                    ? `${s.intake.webhookUrl ?? 'webhook не зарегистрирован'} · в очереди Telegram: ${s.intake.pendingUpdateCount ?? '—'}`
                    : s.intake.mode === 'off'
                      ? 'Выключен в этом окружении'
                      : `Последний успешный опрос ${ago(s.intake.lastOkAt)}`
              }
            />
            <StatusLine
              ok={Boolean(s.bot.lastGetMeOkAt)}
              label={`Бот Telegram ${s.bot.username ? '@' + s.bot.username : ''}`}
              detail={s.bot.error ?? `getMe ${ago(s.bot.lastGetMeOkAt)} · видит все сообщения групп: ${s.bot.readsAll === null ? '—' : s.bot.readsAll ? 'да' : 'нет'}`}
            />
            {s.maxConfigured && (
              <>
                <StatusLine
                  ok={maxIntakeOk}
                  warn={s.maxIntake.mode === 'off'}
                  label={`Приём MAX · ${s.maxIntake.mode}`}
                  detail={
                    s.maxIntake.failingSince
                      ? `Ошибки с ${dt(s.maxIntake.failingSince, tz)}: ${s.maxIntake.lastErrorMessage ?? ''}`
                      : s.maxIntake.mode === 'off'
                        ? 'Выключен в этом окружении'
                        : `Последний успешный опрос ${ago(s.maxIntake.lastOkAt)}`
                  }
                />
                <StatusLine ok={Boolean(s.maxBot.lastGetMeOkAt)} label={`Бот MAX ${s.maxBot.username ? '@' + s.maxBot.username : ''}`} detail={s.maxBot.error ?? `getMe ${ago(s.maxBot.lastGetMeOkAt)}`} />
              </>
            )}
            <StatusLine
              ok={aiOk}
              label="AI-анализ"
              detail={
                !s.ai.configured
                  ? 'AI-прокси не настроен'
                  : s.ai.failingSince
                    ? `Недоступен с ${dt(s.ai.failingSince, tz)}: ${s.ai.lastError ?? ''}. Сообщения сохраняются и будут доанализированы.`
                    : `Последний успешный вызов ${ago(s.ai.lastOkAt)} · вызовов ${o.analysis.usage.calls}, ср. ${o.analysis.usage.avgMs} мс`
              }
            />
            <StatusLine
              ok={s.staleWorkers.length === 0}
              label="Фоновые воркеры"
              detail={
                s.staleWorkers.length
                  ? `Нет heartbeat: ${s.staleWorkers.join(', ')}`
                  : Object.entries(s.heartbeats)
                      .map(([k, v]) => `${k} ${v} с`)
                      .join(' · ')
              }
            />
            <StatusLine ok label="База данных" detail={`Размер ${bytes(s.dbSizeBytes)} · сервис запущен ${dt(s.startedAt, tz)}`} />
          </CardBody>
        </Card>
        )}

        {isSuper && (
        <Card className="animate-rise">
          <CardHeader title="Задержки и расход" hint="Считаются по журналу в БД" />
          <CardBody className="space-y-4 text-sm">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
              <dt className="text-ink-soft">Telegram → получение</dt>
              <dd className="num">{o.delivery.latency.avgTelegramToReceive ?? '—'} с</dd>
              <dt className="text-ink-soft">Получение → анализ</dt>
              <dd className="num">{o.delivery.latency.avgReceiveToAnalyze ?? '—'} с</dd>
              <dt className="text-ink-soft">Получение → алерт (ср./макс.)</dt>
              <dd className="num">
                {o.delivery.latency.avgReceiveToSent ?? '—'} / {o.delivery.latency.maxReceiveToSent ?? '—'} с
              </dd>
              <dt className="text-ink-soft">Саммари после границы (ср./макс.)</dt>
              <dd className="num">
                {o.delivery.summaryLatency.avgAfterBoundary ?? '—'} / {o.delivery.summaryLatency.maxAfterBoundary ?? '—'} с
              </dd>
              <dt className="text-ink-soft">Токены AI (вход / выход)</dt>
              <dd className="num">
                {num(o.analysis.usage.inputTokens)} / {num(o.analysis.usage.outputTokens)}
              </dd>
              <dt className="text-ink-soft">Ошибок AI</dt>
              <dd className="num">{o.analysis.usage.failed}</dd>
              <dt className="text-ink-soft">Оценки: полезно / ложно</dt>
              <dd className="num">
                {o.feedback.useful} / {o.feedback.falsePositive}
                {o.feedback.falseShare !== null && ` (${Math.round(o.feedback.falseShare * 100)}% ложных)`}
              </dd>
              <dt className="text-ink-soft">Инцидентов / повторов / всплесков</dt>
              <dd className="num">
                {o.incidents.incidents} / {o.incidents.repeats} / {o.incidents.spikes}
              </dd>
            </dl>
          </CardBody>
        </Card>
        )}

        <Card className="animate-rise">
          <CardHeader title="Чаты и получатели" />
          <CardBody className="grid gap-5 text-sm sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Чаты</p>
              {o.chats.length === 0 && <p className="text-ink-soft">Бот пока не добавлен ни в один чат.</p>}
              {o.chats.map((c) => (
                <p key={c.status} className="flex justify-between py-0.5">
                  <span>{CHAT_STATUS_LABELS[c.status as ChatStatus] ?? c.status}</span>
                  <span className="num">{c.n}</span>
                </p>
              ))}
              <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Сообщений по чатам</p>
              {o.messages.perChat.slice(0, 6).map((c) => (
                <p key={c.chatId} className="flex justify-between gap-3 py-0.5">
                  <span className="truncate">{chatTitle(c.chatId)}</span>
                  <span className="num">{c.n}</span>
                </p>
              ))}
              {o.messages.perChat.length === 0 && <p className="text-ink-soft">Сообщений за период нет.</p>}
            </div>
            {isSuper && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-soft">Рассылки за период</p>
              {o.delivery.byStatus.length === 0 && <p className="text-ink-soft">Отправок не было.</p>}
              {o.delivery.byStatus.map((d) => (
                <p key={d.status} className="flex justify-between py-0.5">
                  <span>{DELIVERY_STATUS_LABELS[d.status as DeliveryStatus] ?? d.status}</span>
                  <span className="num">{d.n}</span>
                </p>
              ))}
            </div>
            )}
          </CardBody>
        </Card>

        {isSuper && (
        <Card className="animate-rise">
          <CardHeader title="Пробелы сбора" hint="Интервалы, когда данные могли не поступать. Это не «сообщений не было»." />
          <CardBody className="text-sm">
            {o.gaps.length === 0 ? (
              <p className="text-ink-soft">Пробелов не зафиксировано.</p>
            ) : (
              <ul className="space-y-2">
                {o.gaps.map((g) => (
                  <li key={g.id} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {GAP_LABELS[g.reason] ?? g.reason}
                      {g.chatId && ` · ${chatTitle(g.chatId)}`}
                      {g.recovered && <span className="text-ok"> · данные дослал {g.reason === 'intake_error_max' ? 'MAX' : 'Telegram'}</span>}
                    </span>
                    <span className="num text-ink-soft">
                      {dt(g.startedAt, tz)} – {g.endedAt ? dt(g.endedAt, tz) : 'сейчас'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        )}
      </div>
    </>
  );
}
