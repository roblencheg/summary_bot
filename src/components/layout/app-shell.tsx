import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '~/lib/utils';
import { UNAUTHORIZED_EVENT } from '~/lib/api';
import { AUTH_KEY, consumeFirstLoginFlag, useLogout } from '~/hooks/use-auth';
import { Modal } from '~/components/ui/feedback';
import { GuideVideo } from '~/components/guide-video';

const NAV_SUPER = [
  { to: '/', label: 'Обзор', code: '01' },
  { to: '/chats', label: 'Чаты', code: '02' },
  { to: '/users', label: 'Пользователи', code: '03' },
  { to: '/summaries', label: 'Саммари', code: '04' },
  { to: '/alerts', label: 'Алерты', code: '05' },
  { to: '/incidents', label: 'Инциденты', code: '06' },
  { to: '/deliveries', label: 'Журнал отправок', code: '07' },
  { to: '/settings', label: 'Настройки', code: '08' },
  { to: '/audit', label: 'Аудит', code: '09' },
  { to: '/directorates', label: 'Дирекции', code: '10' },
  { to: '/guide', label: 'Как это устроено', code: '11' },
];

// облегчённый интерфейс руководителя: только своя дирекция, без настроек системы
const NAV_MANAGER = [
  { to: '/', label: 'Обзор', code: '01' },
  { to: '/chats', label: 'Чаты', code: '02' },
  { to: '/users', label: 'Пользователи', code: '03' },
  { to: '/incidents', label: 'Инциденты', code: '04' },
  { to: '/summaries', label: 'Отчёты', code: '05' },
  { to: '/guide', label: 'Как это устроено', code: '06' },
];

export function AppShell({ login, subtitle, isSuper, children }: { login: string; subtitle: string; isSuper: boolean; children: ReactNode }) {
  const NAV = isSuper ? NAV_SUPER : NAV_MANAGER;
  const [open, setOpen] = useState(false);
  const [showGuide, setShowGuide] = useState(consumeFirstLoginFlag);
  const logout = useLogout();
  const qc = useQueryClient();
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const onUnauthorized = () => qc.invalidateQueries({ queryKey: AUTH_KEY });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [qc]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col bg-night text-[#c9cfdb] transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ backgroundImage: 'linear-gradient(180deg, rgb(217 130 43 / 0.10), transparent 220px)' }}
      >
        <div className="px-5 pb-5 pt-6">
          <div className="flex items-center gap-2.5">
            <span className="relative grid size-9 place-items-center rounded-xl bg-signal font-mono text-sm font-bold text-night">
              TG
              <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-pulse rounded-full border-2 border-night bg-ok" />
            </span>
            <div className="leading-tight">
              <p className="text-[15px] font-extrabold tracking-tight text-white">Пульт поддержки</p>
              <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#7d8699]">monitoring</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-semibold transition-colors',
                  isActive ? 'bg-night-2 text-white shadow-[inset_2px_0_0_var(--color-signal)]' : 'hover:bg-night-2/60 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('font-mono text-[10.5px]', isActive ? 'text-signal' : 'text-[#5d6679]')}>{n.code}</span>
                  {n.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-night-line px-5 py-4 text-[13px]">
          <p className="truncate text-[#9aa3b5]">
            Вход: <span className="font-semibold text-white">{login}</span>
          </p>
          <p className="truncate text-[12px] text-[#7d8699]">{subtitle}</p>
          <button className="mt-2 cursor-pointer font-semibold text-signal hover:underline" onClick={() => logout.mutate()}>
            Выйти
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-night/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="min-w-0">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-paper/90 px-4 py-3 backdrop-blur lg:hidden">
          <button className="grid size-9 cursor-pointer place-items-center rounded-lg border border-line bg-surface" onClick={() => setOpen(true)} aria-label="Меню">
            ☰
          </button>
          <span className="font-extrabold tracking-tight">Пульт поддержки</span>
        </div>
        <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>

      <Modal open={showGuide} onClose={() => setShowGuide(false)} title="Добро пожаловать! Короткая инструкция" wide>
        <GuideVideo />
      </Modal>
    </div>
  );
}
