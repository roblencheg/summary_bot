import React, { useLayoutEffect, useRef, useState } from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { atFrame, segmentById, tg, type At } from '../data';
import type { TgMode } from '../storyboard';
import { C, FONT, MONO } from '../theme';

const TGW = { x: 780, y: 84, w: 1020, h: 891 };
const HEADER = 66;
const PINNED = 54;
const ease = Easing.bezier(0.45, 0, 0.2, 1);

// ⚪ без вариационного селектора рисуется контуром — просим цветную эмодзи
const emoji = (html: string) => html.replace(/⚪(?!\uFE0F)/g, '⚪\uFE0F').replace(/<\/blockquote>\n/g, '</blockquote>');
/** Rich HTML саммари → шапка + разделы по <h3> (для прокрутки и подсветки). */
function sections(html: string): string[] {
  return emoji(html).split(/(?=<h3>)/);
}

const RICH_CSS = `
.tgb { font-family: ${FONT}; color: #0f1419; font-size: 17px; line-height: 1.45; }
.tgb h2 { font-size: 21px; font-weight: 800; margin: 0 0 4px; }
.tgb h3 { font-size: 18.5px; font-weight: 800; margin: 14px 0 6px; }
.tgb p { margin: 4px 0; }
.tgb table { width: 100%; border-collapse: collapse; font-size: 15.5px; margin: 6px 0; }
.tgb th { background: #eef2f5; text-align: left; font-weight: 700; padding: 6px 9px; border: 1px solid #d5dde4; }
.tgb td { padding: 6px 9px; border: 1px solid #d5dde4; vertical-align: top; }
.tgb tr:nth-child(odd) td { background: #f8fafb; }
.tgb ul { margin: 4px 0; padding-left: 22px; }
.tgb li { margin: 3px 0; }
.tgb a { color: #2f7bc4; text-decoration: none; }
.tgb details { border: 1px solid #d5dde4; border-radius: 10px; padding: 7px 12px; margin: 6px 0; }
.tgb details > *:not(summary) { display: none; }
.tgb summary { list-style: none; }
.tgb summary::before { content: '▸ '; color: #7a8794; }
.tgb blockquote { margin: 6px 0; padding: 4px 12px; border-left: 3px solid #2f7bc4; background: #eef5fc; border-radius: 4px; }
.tgb i { color: #5c6b78; }
`;

type BubbleKey = 'summary' | 'alert' | 'menu' | 'ondemand';

const Bubble: React.FC<{ id: BubbleKey; time: string; html?: string[]; text?: string; buttons?: string[][]; hi?: number | null; hiButton?: string | null; appear: number }> = ({
  id,
  time,
  html,
  text,
  buttons,
  hi,
  hiButton,
  appear,
}) => (
  <div data-b={id} style={{ opacity: appear, transform: `translateY(${(1 - appear) * 40}px)`, marginBottom: 14, maxWidth: 880 }}>
    <div style={{ background: '#fff', borderRadius: '18px 18px 18px 6px', padding: '14px 18px 10px', boxShadow: '0 1px 2px rgba(0,0,0,.12)' }}>
      <div className="tgb">
        {html?.map((h, i) => (
          <div
            key={i}
            data-sec={`${id}:${i}`}
            style={{
              borderRadius: 10,
              margin: '0 -8px',
              padding: '0 8px',
              background: hi === i ? 'rgba(217,130,43,.10)' : 'transparent',
              boxShadow: hi === i ? `inset 0 0 0 2px ${C.signal}` : 'none',
            }}
            dangerouslySetInnerHTML={{ __html: h }}
          />
        ))}
        {text && <div style={{ whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: emoji(text) }} />}
      </div>
      <div style={{ textAlign: 'right', fontSize: 13, color: '#8a98a5', marginTop: 4 }}>{time}</div>
    </div>
    {buttons?.map((row, r) => (
      <div key={r} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {row.map((b) => (
          <div
            key={b}
            data-btn={b}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '11px 10px',
              borderRadius: 12,
              color: '#fff',
              fontFamily: FONT,
              fontWeight: 600,
              fontSize: 16,
              background: hiButton === b ? 'rgba(217,130,43,.92)' : 'rgba(84,110,70,.55)',
              boxShadow: hiButton === b ? `0 0 0 3px ${C.signal}55` : 'none',
            }}
          >
            {b}
          </div>
        ))}
      </div>
    ))}
  </div>
);

/** Положения разделов и кнопок внутри ленты сообщений (меряем после раскладки). */
function useOffsets(ref: React.RefObject<HTMLDivElement | null>) {
  const [map, setMap] = useState<Record<string, { top: number; h: number; left: number; w: number }>>({});
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    // AICODE-NOTE: offsetTop/offsetLeft, а не getBoundingClientRect: не зависят от анимаций transform и
    // дают целые числа — иначе замер «дрожит» между кадрами и setState уходит в бесконечный цикл (React #185).
    const rel = (el: HTMLElement) => {
      let top = 0;
      let left = 0;
      let cur: HTMLElement | null = el;
      while (cur && cur !== root) {
        top += cur.offsetTop;
        left += cur.offsetLeft;
        cur = cur.offsetParent as HTMLElement | null;
      }
      return { top, left };
    };
    const next: typeof map = {};
    root.querySelectorAll<HTMLElement>('[data-sec],[data-b],[data-btn]').forEach((el) => {
      const key = el.dataset.sec ?? (el.dataset.b ? `b:${el.dataset.b}` : `btn:${el.dataset.btn}`);
      next[key] = { ...rel(el), h: el.offsetHeight, w: el.offsetWidth };
    });
    if (JSON.stringify(next) !== JSON.stringify(map)) setMap(next);
  });
  return map;
}

type Plan = {
  bubbles: Array<{ id: BubbleKey; appearAt: At | null }>;
  scroll: Array<{ at: At; to: string; offset?: number }>;
  hi: Array<{ at: At; sec: string | null }>;
  hiButton?: Array<{ at: At; btn: string | null }>;
  pinned: boolean;
  side: { title: string; items: Array<{ at: At; icon: string; text: string }> };
};

const BTN_NOW = '📍 Что сейчас происходит';
const BTN_SET = '⚙️ Настройки инцидентов';

const PLANS: Record<TgMode, Plan> = {
  summary: {
    bubbles: [{ id: 'summary', appearAt: 0.6 }],
    scroll: [{ at: 0, to: 'summary:0' }],
    hi: [{ at: 'w:дважды', sec: 'summary:0' }],
    pinned: false,
    side: {
      title: 'Саммари — дважды в день',
      items: [
        { at: 'w:восемь', icon: '🌙', text: '08:00 — за ночь' },
        { at: 'w:десять', icon: '☀️', text: '22:00 — за день' },
        { at: 'w:присылает', icon: '✉️', text: 'Одно сообщение по всем вашим чатам' },
      ],
    },
  },
  situation: {
    bubbles: [{ id: 'summary', appearAt: null }],
    scroll: [{ at: 0, to: 'summary:1', offset: -20 }],
    hi: [{ at: 0.3, sec: 'summary:1' }],
    pinned: false,
    side: {
      title: '🚦 Обстановка',
      items: [
        { at: 'w:красный', icon: '🔴', text: 'тревожно' },
        { at: 'w:жёлтый', icon: '🟡', text: 'есть вопросы' },
        { at: 'w:зелёный', icon: '🟢', text: 'спокойно' },
        { at: 'w:белый', icon: '⚪️', text: 'сообщений не было' },
      ],
    },
  },
  decide: {
    bubbles: [{ id: 'summary', appearAt: null }],
    scroll: [
      { at: 0, to: 'summary:2', offset: -20 },
      { at: 'w:краткая', to: 'summary:3', offset: -20 },
      { at: 'w:подробности', to: 'summary:4', offset: -280 },
    ],
    hi: [
      { at: 0.2, sec: 'summary:2' },
      { at: 'w:краткая', sec: 'summary:3' },
      { at: 'w:подробности', sec: 'summary:4' },
    ],
    pinned: false,
    side: {
      title: '🔥 Требует решения',
      items: [
        { at: 'w:кто', icon: '👤', text: 'Кто и где' },
        { at: 'w:случилось-0.2', icon: '❗', text: 'Что случилось' },
        { at: 'w:ответила', icon: '💬', text: 'Ответила ли поддержка' },
        { at: 'w:краткая', icon: '📋', text: 'Краткая картина и чаты подробно' },
      ],
    },
  },
  alert: {
    bubbles: [
      { id: 'summary', appearAt: null },
      { id: 'alert', appearAt: 'w:алерт-0.3' },
    ],
    scroll: [{ at: 0, to: 'summary:1', offset: -20 }, { at: 'w:алерт-0.3', to: 'b:alert', offset: -40 }],
    hi: [],
    hiButton: [{ at: 'w:полезный', btn: '👍 Полезный сигнал' }, { at: 'w:ложное', btn: '👎 Ложное срабатывание' }, { at: 'end-0.4', btn: null }],
    pinned: false,
    side: {
      title: '⚡ Алерт — сразу',
      items: [
        { at: 'w:насколько', icon: '🔴', text: 'Насколько серьёзно' },
        { at: 'w:кого', icon: '👤', text: 'У кого и в каком чате' },
        { at: 'w:написал', icon: '❝', text: 'Что написал клиент' },
        { at: 'w:кнопками', icon: '👍', text: 'Ваша оценка улучшает анализ' },
      ],
    },
  },
  menu: {
    bubbles: [
      { id: 'alert', appearAt: null },
      { id: 'menu', appearAt: 0.4 },
      { id: 'ondemand', appearAt: 'w:сводка' },
    ],
    scroll: [
      { at: 0.2, to: 'b:menu', offset: -30 },
      { at: 'w:сводка+0.1', to: 'b:ondemand', offset: -30 },
      { at: 'w:настройки-0.3', to: 'b:menu', offset: -30 },
    ],
    hi: [],
    hiButton: [
      { at: 'w:что', btn: BTN_NOW },
      { at: 'w:сводка', btn: null },
      { at: 'w:настройки', btn: BTN_SET },
    ],
    pinned: true,
    side: {
      title: '📌 Закреплённое меню',
      items: [
        { at: 'w:что', icon: '📍', text: 'Что сейчас происходит — сводка с последнего саммари' },
        { at: 'w:настройки', icon: '⚙️', text: 'Настройки инцидентов — темы и серьёзность алертов' },
      ],
    },
  },
};

function lastAt<T extends { at: At }>(list: T[], f: number, toF: (a: At) => number): { prev: T | null; cur: T | null; from: number } {
  let cur: T | null = null;
  let prev: T | null = null;
  let from = 0;
  for (const x of list) {
    const xf = toF(x.at);
    if (xf <= f) {
      prev = cur;
      cur = x;
      from = xf;
    }
  }
  return { prev, cur, from };
}

export const TgScene: React.FC<{ segId: string; mode: TgMode }> = ({ segId, mode }) => {
  const f = useCurrentFrame();
  const seg = segmentById(segId);
  const toF = (a: At) => atFrame(seg, a);
  const plan = PLANS[mode];
  const stackRef = useRef<HTMLDivElement>(null);
  const off = useOffsets(stackRef);

  const viewH = TGW.h - HEADER - (plan.pinned ? PINNED : 0);
  const posOf = (s: { to: string; offset?: number }) => Math.max(0, (off[s.to]?.top ?? 0) + (s.offset ?? 0));
  const sc = lastAt(plan.scroll, f, toF);
  const scrollT = sc.prev ? ease(interpolate(f, [sc.from, sc.from + 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })) : 1;
  const firstScroll = plan.scroll[0];
  const scroll = sc.cur ? (sc.prev ? posOf(sc.prev) + (posOf(sc.cur) - posOf(sc.prev)) * scrollT : posOf(sc.cur)) : posOf(firstScroll);

  const hi = lastAt(plan.hi, f, toF).cur?.sec ?? null;
  const hiBtn = plan.hiButton ? (lastAt(plan.hiButton, f, toF).cur?.btn ?? null) : null;
  const appear = (a: At | null) => (a === null ? 1 : interpolate(f, [toF(a), toF(a) + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }));

  const content: Record<BubbleKey, React.ReactNode> = {
    summary: <Bubble key="summary" id="summary" time="22:00" html={sections(tg.summaryDay)} hi={hi?.startsWith('summary:') ? Number(hi.split(':')[1]) : null} appear={1} />,
    alert: <Bubble key="alert" id="alert" time="10:05" text={tg.alert} buttons={tg.alertButtons.inline_keyboard.map((r) => r.map((b) => b.text))} hiButton={hiBtn} appear={1} />,
    menu: <Bubble key="menu" id="menu" time="08:01" text={tg.menu.text} buttons={tg.menu.replyMarkup.inline_keyboard.map((r) => r.map((b) => b.text))} hiButton={hiBtn} appear={1} />,
    ondemand: <Bubble key="ondemand" id="ondemand" time="11:30" html={sections(tg.onDemand)} appear={1} />,
  };

  const sideIn = interpolate(f, [0, 14], [0, 1], { extrapolateRight: 'clamp', easing: ease });
  const winIn = seg.id === 'tg-summary' ? interpolate(f, [0, 16], [0, 1], { extrapolateRight: 'clamp', easing: ease }) : 1;

  return (
    <AbsoluteFill>
      <style>{RICH_CSS}</style>
      {/* пояснения слева */}
      <div style={{ position: 'absolute', left: 120, top: 210, width: 600, fontFamily: FONT, opacity: sideIn, transform: `translateX(${(1 - sideIn) * -30}px)` }}>
        <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: 4, color: C.signal, textTransform: 'uppercase', marginBottom: 14 }}>Telegram</div>
        <div style={{ fontSize: 50, fontWeight: 800, color: C.ink, lineHeight: 1.1, letterSpacing: -1 }}>{plan.side.title}</div>
        <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {plan.side.items.map((it) => {
            const a = interpolate(f, [toF(it.at), toF(it.at) + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
            return (
              <div
                key={it.text}
                style={{
                  opacity: a,
                  transform: `translateY(${(1 - a) * 16}px)`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  background: C.surface,
                  border: `1px solid ${C.line}`,
                  borderRadius: 16,
                  padding: '16px 20px',
                  fontSize: 25,
                  fontWeight: 600,
                  color: C.ink,
                  boxShadow: '0 6px 18px rgba(18,24,38,.06)',
                }}
              >
                <span style={{ fontSize: 30, width: 38, textAlign: 'center' }}>{it.icon}</span>
                <span>{it.text}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* окно Telegram */}
      <div
        style={{
          position: 'absolute',
          left: TGW.x,
          top: TGW.y,
          width: TGW.w,
          height: TGW.h,
          borderRadius: 18,
          overflow: 'hidden',
          boxShadow: '0 30px 80px rgba(18,24,38,.28), 0 0 0 1px rgba(18,24,38,.12)',
          opacity: winIn,
          transform: `translateY(${(1 - winIn) * 30}px)`,
          fontFamily: FONT,
        }}
      >
        <div style={{ height: HEADER, background: '#fff', display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px', borderBottom: '1px solid #e3e7ea' }}>
          <div style={{ width: 42, height: 42, borderRadius: 21, background: C.signal, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 16 }}>TG</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#0f1419' }}>Мониторинг поддержки</div>
            <div style={{ fontSize: 14, color: '#8a98a5' }}>бот</div>
          </div>
        </div>
        {plan.pinned && (
          <div style={{ height: PINNED, background: '#fff', borderBottom: '1px solid #e3e7ea', display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px' }}>
            <div style={{ width: 3, height: 34, background: '#2f7bc4', borderRadius: 2 }} />
            <div>
              <div style={{ color: '#2f7bc4', fontWeight: 700, fontSize: 14 }}>Закреплённое сообщение</div>
              <div style={{ color: '#0f1419', fontSize: 15 }}>📌 Меню мониторинга поддержки</div>
            </div>
          </div>
        )}
        <div
          style={{
            position: 'relative',
            height: viewH,
            overflow: 'hidden',
            background: 'radial-gradient(circle at 1px 1px, rgba(60,90,40,.13) 1.2px, transparent 0) 0 0/26px 26px, linear-gradient(160deg, #dfe9c8 0%, #c5d9a8 55%, #b3cd98 100%)',
          }}
        >
          <div ref={stackRef} style={{ position: 'absolute', left: 26, right: 26, top: 22, transform: `translateY(${-scroll}px)` }}>
            {plan.bubbles.map((b) => (
              <div key={b.id} style={{ opacity: appear(b.appearAt), transform: `translateY(${(1 - appear(b.appearAt)) * 40}px)` }}>
                {content[b.id]}
              </div>
            ))}
            <div style={{ height: viewH }} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
