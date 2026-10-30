import React from 'react';
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { segmentById, segments, TOTAL_FRAMES } from './data';
import { UiScene } from './scenes/UiScene';
import { TgScene } from './scenes/TgScene';
import { Help, Intro, Outro } from './scenes/Slides';
import { CHAPTERS, STORY } from './storyboard';
import { C, FONT, MONO } from './theme';

const Background: React.FC = () => (
  <AbsoluteFill
    style={{
      background: C.paper,
      backgroundImage:
        'radial-gradient(circle at 1px 1px, rgba(21,27,39,.08) 1.2px, transparent 0), radial-gradient(1300px 600px at 88% -12%, rgba(217,130,43,.16), transparent 60%), radial-gradient(900px 500px at -10% 110%, rgba(58,87,149,.08), transparent 60%)',
      backgroundSize: '24px 24px, 100% 100%, 100% 100%',
    }}
  />
);

const chapterStarts = CHAPTERS.map((c) => ({ ...c, frame: segmentById(c.from).from }));

const Chapter: React.FC = () => {
  const f = useCurrentFrame();
  const idx = chapterStarts.reduce((acc, c, i) => (f >= c.frame ? i : acc), -1);
  // на финальных слайдах свой крупный заголовок
  if (idx < 0 || f >= segmentById('help').from) return null;
  const c = chapterStarts[idx];
  const a = interpolate(f, [c.frame, c.frame + 14], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 220, top: 28, display: 'flex', alignItems: 'baseline', gap: 16, fontFamily: FONT, opacity: a, transform: `translateY(${(1 - a) * -8}px)` }}>
      <span style={{ fontFamily: MONO, fontSize: 18, letterSpacing: 3, color: C.signal }}>{String(idx + 1).padStart(2, '0')} ·</span>
      <span style={{ fontSize: 26, fontWeight: 800, color: C.ink, letterSpacing: -0.3 }}>{c.title}</span>
    </div>
  );
};

const Subtitles: React.FC = () => {
  const f = useCurrentFrame();
  const seg = segments.find((s) => f >= s.from && f < s.from + s.frames);
  if (!seg) return null;
  const t = (f - seg.voiceFrom) / 30;
  const i = seg.sentences.findIndex((s, k) => t >= s.start - 0.1 && t < (seg.sentences[k + 1]?.start ?? s.end + 0.5) - 0.1);
  if (i < 0) return null;
  const s = seg.sentences[i];
  const startF = seg.voiceFrom + Math.round((s.start - 0.1) * 30);
  const a = interpolate(f, [startF, startF + 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const dark = seg.id === 'outro';
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 16, display: 'flex', justifyContent: 'center', opacity: a }}>
      <div
        style={{
          maxWidth: 1640,
          padding: '8px 22px',
          borderRadius: 14,
          background: dark ? 'rgba(255,255,255,.12)' : 'rgba(18,24,38,.86)',
          color: '#fff',
          fontFamily: FONT,
          fontSize: 27,
          fontWeight: 600,
          lineHeight: 1.3,
          textAlign: 'center',
        }}
      >
        {s.text}
      </div>
    </div>
  );
};

const Progress: React.FC = () => {
  const f = useCurrentFrame();
  return <div style={{ position: 'absolute', left: 0, bottom: 0, height: 5, width: `${(f / TOTAL_FRAMES) * 100}%`, background: C.signal, opacity: 0.85 }} />;
};

export const Tutorial: React.FC = () => (
  <AbsoluteFill>
    <Background />
    {segments.map((seg) => {
      const v = STORY[seg.id];
      return (
        <Sequence key={seg.id} from={seg.from} durationInFrames={seg.frames} name={seg.id}>
          {v.kind === 'intro' && <Intro />}
          {v.kind === 'ui' && <UiScene segId={seg.id} />}
          {v.kind === 'tg' && <TgScene segId={seg.id} mode={v.mode} />}
          {v.kind === 'help' && <Help />}
          {v.kind === 'outro' && <Outro />}
          <Sequence from={seg.voiceFrom - seg.from} layout="none">
            <Audio src={staticFile(`audio/${seg.id}.mp3`)} />
          </Sequence>
        </Sequence>
      );
    })}
    <Chapter />
    <Subtitles />
    <Progress />
  </AbsoluteFill>
);
