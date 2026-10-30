import { Outlet, createBrowserRouter } from 'react-router-dom';
import { AppShell } from '~/components/layout/app-shell';
import { Loading } from '~/components/ui/feedback';
import { useAuthStatus } from '~/hooks/use-auth';
import { LoginPage } from '~/routes/login';
import { OverviewPage } from '~/routes/overview';
import { ChatsPage } from '~/routes/chats';
import { ChatDetailsPage } from '~/routes/chat-details';
import { UsersPage } from '~/routes/users';
import { UserDetailsPage } from '~/routes/user-details';
import { SummariesPage } from '~/routes/summaries';
import { AlertsPage } from '~/routes/alerts';
import { IncidentsPage } from '~/routes/incidents';
import { IncidentDetailsPage } from '~/routes/incident-details';
import { DeliveriesPage } from '~/routes/deliveries';
import { SettingsPage } from '~/routes/settings';
import { AuditPage } from '~/routes/audit';
import { DirectoratesPage } from '~/routes/directorates';
import { GuidePage } from '~/routes/guide';

/** Все разделы — только после входа администратора; права дополнительно проверяет backend. */
function Protected() {
  const { data, isLoading } = useAuthStatus();
  if (isLoading) return <Loading label="Проверка сессии…" />;
  if (!data?.authenticated || !data.admin) return <LoginPage bootstrapNeeded={data?.bootstrapNeeded ?? false} />;
  const isSuper = data.admin.role === 'superadmin';
  const subtitle = isSuper ? 'Суперадмин' : `Руководитель · ${data.admin.directorates.map((d) => d.name).join(', ') || 'без дирекции'}`;
  return (
    <AppShell login={data.admin.login} subtitle={subtitle} isSuper={isSuper}>
      <Outlet />
    </AppShell>
  );
}

export const router = createBrowserRouter([
  {
    element: <Protected />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/chats', element: <ChatsPage /> },
      { path: '/chats/:id', element: <ChatDetailsPage /> },
      { path: '/users', element: <UsersPage /> },
      { path: '/users/:id', element: <UserDetailsPage /> },
      { path: '/summaries', element: <SummariesPage /> },
      { path: '/alerts', element: <AlertsPage /> },
      { path: '/incidents', element: <IncidentsPage /> },
      { path: '/incidents/:id', element: <IncidentDetailsPage /> },
      { path: '/deliveries', element: <DeliveriesPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/audit', element: <AuditPage /> },
      { path: '/directorates', element: <DirectoratesPage /> },
      { path: '/guide', element: <GuidePage /> },
      { path: '*', element: <OverviewPage /> },
    ],
  },
]);
