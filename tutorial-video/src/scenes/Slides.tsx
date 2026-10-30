import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { atFrame, segmentById, type At } from '../data';
import { C, FONT, MONO } from '../theme';

const ease = Easing.bezier(0.2, 0.7, 0.2, 1);
const useIn = (from: number, dur = 16) => {
  const f = useCurrentFrame();
  return interpolate(f, [from, from + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
};

const Node: React.FC<{ icon: string; title: string; sub: string; dark?: boolean; a: number }> = ({ icon, title, sub, dark, a }) => (
  <div
    style={{
      width: 330,
      padding: '28px 30px',
      borderRadius: 24,
      background: dark ? C.night : C.surface,
      border: `1px solid ${dark ? C.nightLine : C.line}`,
      boxShadow: '0 20px 50px rgba(18,24,38,.12)',
      opacity: a,
      transform: `translateY(${(1 - a) * 30}px) scale(${0.94 + a * 0.06})`,
    }}
  >
    <div style={{ fontSize: 46 }}>{icon}</div>
    <div style={{ marginTop: 14, fontSize: 30, fontWeight: 800, color: dark ? '#fff' : C.ink, letterSpacing: -0.5 }}>{title}</div>
    <div style={{ marginTop: 8, fontSize: 21, color: dark ? '#aeb6c6' : C.inkSoft, lineHeight: 1.35 }}>{sub}</div>
  </div>
);

const Arrow: React.FC<{ a: number }> = ({ a }) => (
  <div style={{ width: 90, height: 4, background: C.signal, borderRadius: 2, transformOrigin: 'left', transform: `scaleX(${a})`, position: 'relative' }}>
    <div style={{ position: 'absolute', right: -4, top: -7, width: 0, height: 0, borderLeft: `14px solid ${C.signal}`, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', opacity: a }} />
  </div>
);

export const Intro: React.FC = () => {
  const seg = segmentById('intro');
  const t = (a: At) => atFrame(seg, a);
  const title = useIn(4, 22);
  const n1 = useIn(t('w:чатами-0.3'));
  const a1 = useIn(t('w:собирает'), 12);
  const n2 = useIn(t('w:собирает+0.3'));
  const a2 = useIn(t('w:присылает-0.4'), 12);
  const n3 = useIn(t('w:присылает'));
  const tag = useIn(t('w:разберём'));
  return (
    <AbsoluteFill style={{ fontFamily: FONT, alignItems: 'center' }}>
      <div style={{ marginTop: 150, textAlign: 'center', opacity: title, transform: `translateY(${(1 - title) * 24}px)` }}>
        <div style={{ fontFamily: MONO, fontSize: 20, letterSpacing: 6, color: C.signal }}>TELEGRAM · MAX · ПОДДЕРЖКА · СИГНАЛЫ</div>
        <div style={{ marginTop: 18, fontSize: 84, fontWeight: 800, color: C.ink, letterSpacing: -2.5, lineHeight: 1.02 }}>Пульт мониторинга<br />чатов поддержки</div>
      </div>
      <div style={{ marginTop: 70, display: 'flex', alignItems: 'center', gap: 30 }}>
        <Node icon="💬" title="Ваши чаты" sub="Группы поддержки клиентов в Telegram и MAX" a={n1} />
        <Arrow a={a1} />
        <Node icon="🤖" title="Бот и AI" sub="Собирает сообщения и находит проблемы" dark a={n2} />
        <Arrow a={a2} />
        <Node icon="🔔" title="Вам" sub="Саммари в 08:00 и 22:00, алерты сразу" a={n3} />
      </div>
      <div
        style={{
          marginTop: 60,
          padding: '14px 28px',
          borderRadius: 40,
          background: C.signalSoft,
          color: '#8a4a10',
          fontSize: 26,
          fontWeight: 700,
          opacity: tag,
          transform: `translateY(${(1 - tag) * 16}px)`,
        }}
      >
        Инструкция руководителя дирекции
      </div>
    </AbsoluteFill>
  );
};

const HELP: Array<{ at: At; q: string; a: string; icon: string }> = [
  { at: 'w:приходят-0.3', icon: '📭', q: 'Не приходят сообщения', a: 'Статус «Активен» у канала → «Тестовое уведомление». Если бот заблокирован — открыть бота этого канала и нажать «Запустить».' },
  { at: 'w:пропало-0.2', icon: '📌', q: 'Пропало меню', a: 'Карточка пользователя → «Отправить меню» у нужного канала.' },
  { at: 'w:вопросы-0.2', icon: '🔑', q: 'Доступы и пароль', a: 'Только через администратора. Он же закрепит чат, подключённый не по вашей ссылке.' },
];

export const Help: React.FC = () => {
  const seg = segmentById('help');
  const head = useIn(0);
  return (
    <AbsoluteFill style={{ fontFamily: FONT, padding: '150px 200px 0' }}>
      <div style={{ opacity: head, fontSize: 64, fontWeight: 800, color: C.ink, letterSpacing: -1.5 }}>Если что-то не так</div>
      <div style={{ marginTop: 50, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {HELP.map((h) => (
          <HelpRow key={h.q} {...h} from={atFrame(seg, h.at)} />
        ))}
      </div>
    </AbsoluteFill>
  );
};
const HelpRow: React.FC<{ icon: string; q: string; a: string; from: number }> = ({ icon, q, a, from }) => {
  const v = useIn(from);
  return (
    <div
      style={{
        display: 'flex',
        gap: 28,
        alignItems: 'center',
        padding: '26px 34px',
        borderRadius: 22,
        background: C.surface,
        border: `1px solid ${C.line}`,
        boxShadow: '0 10px 30px rgba(18,24,38,.07)',
        opacity: v,
        transform: `translateX(${(1 - v) * -40}px)`,
      }}
    >
      <div style={{ fontSize: 48 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 32, fontWeight: 800, color: C.ink }}>{q}</div>
        <div style={{ marginTop: 6, fontSize: 25, color: C.inkSoft }}>{a}</div>
      </div>
    </div>
  );
};

export const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - 4, fps, config: { damping: 14 } });
  const sub = useIn(24);
  return (
    <AbsoluteFill style={{ fontFamily: FONT, alignItems: 'center', justifyContent: 'center', background: C.night }}>
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 30,
          background: C.signal,
          color: '#fff',
          display: 'grid',
          placeItems: 'center',
          fontSize: 56,
          fontWeight: 800,
          transform: `scale(${s})`,
        }}
      >
        ✓
      </div>
      <div style={{ marginTop: 40, fontSize: 70, fontWeight: 800, color: '#fff', letterSpacing: -1.5, transform: `scale(${0.9 + s * 0.1})`, opacity: s }}>Удачной работы!</div>
      <div style={{ marginTop: 18, fontSize: 28, color: '#aeb6c6', opacity: sub }}>Пульт мониторинга чатов поддержки · вопросы — к администратору</div>
    </AbsoluteFill>
  );
};
