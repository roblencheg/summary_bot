import { Link } from 'react-router-dom';
import { PageHeader } from '~/components/layout/page';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { Loading } from '~/components/ui/feedback';
import { Table, Td, Th, Tr } from '~/components/ui/table';
import { CategoryChips, SeverityBadge } from '~/components/domain-badges';
import { SubscriptionMatrix } from '~/components/subscription-matrix';
import { useRecipients } from '~/hooks/use-recipients';
import { useSettings } from '~/hooks/use-settings';
import { useChats } from '~/hooks/use-chats';
import { CHANNEL_LABELS } from '~shared/domain';

export function AlertsPage() {
  const recipients = useRecipients();
  const settings = useSettings();
  const chats = useChats();
  const r = settings.data?.settings.rules;

  return (
    <>
      <PageHeader
        eyebrow="05 · Алерты"
        title="Оперативные алерты"
        description="Круглосуточно. Получатель видит алерт, если чат в его назначениях, категория в его списке и серьёзность не ниже его минимума и минимума чата."
      />
      <div className="space-y-4">
        <SubscriptionMatrix kind="alert" />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="animate-rise">
            <CardHeader title="Фильтры получателей" hint="Меняются в карточке пользователя" />
            {recipients.isLoading ? (
              <Loading />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Получатель</Th>
                    <Th>Категории</Th>
                    <Th>Мин.</Th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.data?.map((x) => (
                    <Tr key={x.id}>
                      <Td>
                        <Link to={`/users/${x.id}`} className="font-semibold hover:text-signal">
                          {x.name}
                        </Link>
                      </Td>
                      <Td>
                        {x.alertCategories.length === 7 ? <span className="text-[13px] text-ink-soft">все</span> : <CategoryChips categories={x.alertCategories} />}
                      </Td>
                      <Td>
                        <SeverityBadge severity={x.alertMinSeverity} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card className="animate-rise">
            <CardHeader title="Правила по умолчанию" hint={<Link to="/settings" className="font-semibold text-signal">Изменить в настройках →</Link>} />
            {r ? (
              <CardBody className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13.5px]">
                <span className="text-ink-soft">Мин. серьёзность чата</span>
                <SeverityBadge severity={r.minSeverity} />
                <span className="text-ink-soft">Порог уверенности</span>
                <span className="num">{r.minConfidence}</span>
                <span className="text-ink-soft">Пауза между уведомлениями</span>
                <span className="num">{r.cooldownMin} мин</span>
                <span className="text-ink-soft">Повтор</span>
                <span className="num">
                  {r.repeatCount} за {r.repeatWindowMin} мин · автор {r.authorRepeatHours} ч
                </span>
                <span className="text-ink-soft">Массовая</span>
                <span className="num">
                  {r.massAuthors} авторов за {r.massWindowMin} мин
                </span>
                <span className="text-ink-soft">Всплеск</span>
                <span className="num">
                  ≥{r.spikeMinMessages} за {r.spikeWindowMin} мин и ×{r.spikeRatio}
                </span>
                <span className="text-ink-soft">История базы</span>
                <span className="num">{r.historyDays} дн</span>
              </CardBody>
            ) : (
              <Loading />
            )}
            <CardBody className="border-t border-line text-[13px] text-ink-soft">
              Переопределения по чатам:{' '}
              {chats.data
                ?.filter((c) => c.status === 'active')
                .map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ', '}
                    <Link to={`/chats/${c.id}`} className="font-semibold text-ink hover:text-signal">
                      {c.title}
                    </Link>{' '}
                    <span className="text-[11px] text-ink-mute">({CHANNEL_LABELS[c.channel]})</span>
                  </span>
                ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
