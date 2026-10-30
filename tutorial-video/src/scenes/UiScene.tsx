import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { atFrame, segmentById, segments, shots, type Box } from '../data';
import { STORY, type UiBeat } from '../storyboard';
import { C, MONO } from '../theme';

// Окно браузера на кадре 1920×1080
export const WIN = { x: 220, y: 80, w: 1480, bar: 36 };
const VIEW = { w: 1600, h: 900 }; // CSS-вьюпорт снимков
const CONTENT_H = (WIN.w * VIEW.h) / VIEW.w; // 855

const MOVE = 22; // кадров на перелёт камеры
const CURSOR_MOVE = 18;
const FADE = 8;
const ease = Easing.bezier(0.45, 0, 0.2, 1);

type Rect = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };
const FULL: Rect = { x: 0, y: 0, w: VIEW.w, h: VIEW.h };

const PATHS: Record<string, string> = {
  login: '/login',
  'login-filled': '/login',
  overview: '/',
  chats: '/chats',
  'connect-dialog': '/chats',
  'connect-link': '/chats',
  'chats-archive': '/chats',
  'chat-a': '/chats/-1005550001',
  users: '/users',
  'users-typed': '/users',
  'users-matrix': '/users',
  'user-new': '/users/11',
  'user-new-link': '/users/11',
  'user-maria': '/users/7',
  incidents: '/incidents',
  incident: '/incidents/8',
  summaries: '/summaries',
  report: '/summaries',
  'report-rich': '/summaries',
};

const target = (shot: string, name: string): Box | null => shots[shot]?.targets[name] ?? null;
const union = (bs: Box[]): Box => {
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
};
function focusBox(shot: string, focus: UiBeat['focus']): Box | null {
  if (!focus) return null;
  const bs = (Array.isArray(focus) ? focus : [focus]).map((n) => target(shot, n)).filter((b): b is Box => Boolean(b));
  return bs.length ? union(bs) : null;
}
function rectFor(shot: string, box: Box | null): Rect {
  if (!box) return FULL;
  const pageH = shots[shot].h;
  const pad = 56;
  let w = Math.max(box.w + pad * 2, ((box.h + pad * 2) * 16) / 9, 820);
  w = Math.min(w, VIEW.w);
  const h = (w * 9) / 16;
  const x = Math.min(Math.max(box.x + box.w / 2 - w / 2, 0), VIEW.w - w);
  const y = Math.min(Math.max(box.y + box.h / 2 - h / 2, 0), Math.max(pageH - h, 0));
  return { x, y, w, h };
}
const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });

type Key<T> = { f: number; v: T };
type Timeline = {
  shots: Key<string>[];
  cams: Key<{ rect: Rect; box: Box | null }>[];
  cursors: Key<Pt>[];
  clicks: number[];
  frames: number;
};

const cache = new Map<string, Timeline>();
function timeline(segId: string): Timeline {
  const hit = cache.get(segId);
  if (hit) return hit;
  const seg = segmentById(segId);
  const story = STORY[segId];
  if (story.kind !== 'ui') throw new Error(`${segId} — не сцена интерфейса`);
  const beats = story.beats.map((b) => ({ ...b, f: Math.max(0, atFrame(seg, b.at)) })).sort((a, b) => a.f - b.f);

  // начальное состояние — конец предыдущей сцены интерфейса на том же снимке (без скачка камеры)
  const prev = segments[seg.index - 1];
  const prevTl = prev && STORY[prev.id]?.kind === 'ui' ? timeline(prev.id) : null;
  const first = beats.find((b) => b.shot)!.shot!;
  const tl: Timeline = { shots: [], cams: [], cursors: [], clicks: [], frames: seg.frames };
  if (prevTl && prevTl.shots.at(-1)!.v === first) {
    tl.cams.push({ f: -MOVE, v: prevTl.cams.at(-1)!.v });
    tl.cursors.push({ f: -CURSOR_MOVE, v: prevTl.cursors.at(-1)!.v });
  }
  let shot = first;
  let cursor: Pt = tl.cursors[0]?.v ?? { x: 1500, y: 860 };
  for (const b of beats) {
    if (b.shot && b.shot !== shot) shot = b.shot;
    if (b.shot || tl.shots.length === 0) tl.shots.push({ f: b.f, v: shot });
    if (b.focus !== undefined) {
      const box = focusBox(shot, b.focus);
      tl.cams.push({ f: b.f, v: { rect: rectFor(shot, box), box } });
    }
    if (b.cursor) {
      const t = target(shot, b.cursor);
      if (t) cursor = center(t);
      tl.cursors.push({ f: b.f, v: cursor });
    }
    if (b.click) tl.clicks.push(b.f);
  }
  if (!tl.cams.length) tl.cams.push({ f: 0, v: { rect: FULL, box: null } });
  if (!tl.cursors.length) tl.cursors.push({ f: 0, v: cursor });
  cache.set(segId, tl);
  return tl;
}

function at<T>(keys: Key<T>[], f: number): { prev: Key<T> | null; cur: Key<T> } {
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].f <= f) i++;
  if (keys[i].f > f) return { prev: null, cur: keys[0] };
  return { prev: i > 0 ? keys[i - 1] : null, cur: keys[i] };
}

const SIDEBAR_W = 248;
/** Снимок страницы; у длинных (fullPage) — «липкая» навигация слева, как в живом интерфейсе. */
const Shot: React.FC<{ id: string; opacity: number; scrollY: number }> = ({ id, opacity, scrollY }) => {
  const h = shots[id].h;
  const src = staticFile(`shots/${id}.png`);
  return (
    <>
      <Img src={src} style={{ position: 'absolute', left: 0, top: 0, width: VIEW.w, height: h, opacity }} />
      {h > VIEW.h && shots[id].targets.navOverview && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: Math.min(scrollY, h - VIEW.h),
            width: SIDEBAR_W,
            height: VIEW.h,
            backgroundImage: `url(${src})`,
            backgroundSize: `${VIEW.w}px ${h}px`,
            backgroundPosition: '0 0',
            opacity,
          }}
        />
      )}
    </>
  );
};

const Cursor: React.FC<{ x: number; y: number; press: number }> = ({ x, y, press }) => (
  <svg
    width={34}
    height={40}
    viewBox="0 0 24 28"
    style={{ position: 'absolute', left: x - 4, top: y - 2, transform: `scale(${1 - press * 0.15})`, transformOrigin: '4px 2px', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.35))' }}
  >
    <path d="M2 1.5 L2 22 L7.6 17 L11.3 25.6 L15 24 L11.4 15.6 L19 15.4 Z" fill="#fff" stroke={C.ink} strokeWidth={1.6} strokeLinejoin="round" />
  </svg>
);

export const UiScene: React.FC<{ segId: string }> = ({ segId }) => {
  const f = useCurrentFrame();
  const tl = timeline(segId);

  // снимок и перекрёстная смена
  const s = at(tl.shots, f);
  const shotFade = s.prev ? interpolate(f, [s.cur.f, s.cur.f + FADE], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;
  const shot = s.cur.v;

  // камера
  const c = at(tl.cams, f);
  const camT = c.prev ? ease(interpolate(f, [c.cur.f, c.cur.f + MOVE], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })) : 1;
  const rect = c.prev ? lerpRect(c.prev.v.rect, c.cur.v.rect, camT) : c.cur.v.rect;
  const k = WIN.w / rect.w;

  // курсор
  const cu = at(tl.cursors, f);
  const curT = cu.prev ? ease(interpolate(f, [cu.cur.f, cu.cur.f + CURSOR_MOVE], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })) : 1;
  const cp = cu.prev ? { x: lerp(cu.prev.v.x, cu.cur.v.x, curT), y: lerp(cu.prev.v.y, cu.cur.v.y, curT) } : cu.cur.v;
  const cursorScreen = { x: (cp.x - rect.x) * k, y: (cp.y - rect.y) * k };
  const lastClick = [...tl.clicks].reverse().find((x) => x <= f);
  const sinceClick = lastClick === undefined ? 99 : f - lastClick;
  const press = sinceClick < 8 ? Math.sin((sinceClick / 8) * Math.PI) : 0;

  // подсветка цели
  const box = c.cur.v.box;
  const ringOpacity = box ? interpolate(f, [c.cur.f + MOVE - 6, c.cur.f + MOVE + 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: WIN.x,
          top: WIN.y,
          width: WIN.w,
          height: WIN.bar + CONTENT_H,
          borderRadius: 16,
          overflow: 'hidden',
          background: C.surface,
          boxShadow: '0 30px 80px rgba(18,24,38,.28), 0 0 0 1px rgba(18,24,38,.12)',
        }}
      >
        <div style={{ height: WIN.bar, background: C.night, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8 }}>
          {['#e0675a', '#e2b04a', '#5fae6b'].map((col) => (
            <div key={col} style={{ width: 12, height: 12, borderRadius: 6, background: col }} />
          ))}
          <div
            style={{
              marginLeft: 18,
              flex: '0 1 560px',
              height: 22,
              borderRadius: 7,
              background: C.night2,
              color: '#aeb6c6',
              fontFamily: MONO,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              padding: '0 12px',
            }}
          >
            пульт-мониторинга{PATHS[shot] ?? '/'}
          </div>
        </div>
        <div style={{ position: 'relative', width: WIN.w, height: CONTENT_H, overflow: 'hidden', background: C.paper }}>
          <div style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `scale(${k}) translate(${-rect.x}px, ${-rect.y}px)` }}>
            {s.prev && shotFade < 1 && <Shot id={s.prev.v} opacity={1} scrollY={rect.y} />}
            <Shot id={shot} opacity={shotFade} scrollY={rect.y} />
            {box && (
              <div
                style={{
                  position: 'absolute',
                  left: box.x - 8,
                  top: box.y - 8,
                  width: box.w + 16,
                  height: box.h + 16,
                  borderRadius: 14,
                  border: `${3 / Math.min(k, 1.6)}px solid ${C.signal}`,
                  boxShadow: `0 0 0 ${6 / k}px rgba(217,130,43,.18)`,
                  opacity: ringOpacity,
                }}
              />
            )}
          </div>
          {sinceClick < 14 && (
            <div
              style={{
                position: 'absolute',
                left: cursorScreen.x - 26,
                top: cursorScreen.y - 26,
                width: 52,
                height: 52,
                borderRadius: 26,
                border: `3px solid ${C.signal}`,
                transform: `scale(${0.3 + (sinceClick / 14) * 1.1})`,
                opacity: 1 - sinceClick / 14,
              }}
            />
          )}
          <Cursor x={cursorScreen.x} y={cursorScreen.y} press={press} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
