import { useState, type FormEvent } from 'react';
import { Button } from '~/components/ui/button';
import { Field, Input } from '~/components/ui/form';
import { ErrorNote, Notice } from '~/components/ui/feedback';
import { useLogin } from '~/hooks/use-auth';

export function LoginPage({ bootstrapNeeded }: { bootstrapNeeded: boolean }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const m = useLogin();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate({ login, password });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-night p-12 text-[#c9cfdb] lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'radial-gradient(600px 300px at 20% 10%, rgb(217 130 43 / 0.28), transparent 60%), linear-gradient(rgb(255 255 255 / 0.04) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.04) 1px, transparent 1px)',
            backgroundSize: '100% 100%, 32px 32px, 32px 32px',
          }}
        />
        <div className="relative">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">Telegram · MAX · поддержка · сигналы</p>
          <h1 className="mt-4 max-w-md text-[44px] font-extrabold leading-[1.05] tracking-tight text-white">Пульт мониторинга чатов поддержки</h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#9aa3b5]">
            Бот собирает сообщения подключённых групп, AI выделяет обращения и проблемы, а нужные люди получают саммари в 08:00 и 22:00 и алерты — круглосуточно.
          </p>
        </div>
        <div className="relative grid max-w-md grid-cols-3 gap-3 font-mono text-[12px]">
          {[
            ['22:00', 'дневное саммари'],
            ['08:00', 'ночное саммари'],
            ['24/7', 'алерты'],
          ].map(([a, b]) => (
            <div key={a} className="rounded-xl border border-night-line bg-night-2/70 p-3">
              <p className="text-lg font-medium text-white">{a}</p>
              <p className="text-[#7d8699]">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5 animate-rise">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-signal lg:hidden">Пульт поддержки</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight">Вход администратора</h2>
            <p className="mt-1 text-sm text-ink-soft">Доступ только для администраторов мониторинга.</p>
          </div>
          {bootstrapNeeded && (
            <Notice tone="signal" title="Администратор ещё не создан">
              Задайте секреты <code className="font-mono">ADMIN_INITIAL_LOGIN</code> и <code className="font-mono">ADMIN_INITIAL_PASSWORD</code> в файле .env на сервере и перезапустите сервис.
            </Notice>
          )}
          <Field label="Логин">
            <Input autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
          </Field>
          <Field label="Пароль">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <ErrorNote error={m.error} />
          <Button type="submit" className="w-full" loading={m.isPending}>
            Войти
          </Button>
        </form>
      </section>
    </div>
  );
}
