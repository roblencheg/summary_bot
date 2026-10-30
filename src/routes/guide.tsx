import { PageHeader } from '~/components/layout/page';
import { Card, CardBody } from '~/components/ui/card';
import { GuideVideo } from '~/components/guide-video';

export function GuidePage() {
  return (
    <>
      <PageHeader eyebrow="Как это устроено" title="Инструкция руководителя" description="Короткий обзор пульта: вход, Telegram и MAX, подключение чатов, пользователи, инциденты и отчёты." />
      <Card className="animate-rise">
        <CardBody>
          <GuideVideo />
        </CardBody>
      </Card>
    </>
  );
}
