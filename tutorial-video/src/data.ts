import narration from './narration.json';
import timingJson from '../public/audio/timing.json';
import shotsJson from '../public/shots/shots.json';
import tgJson from '../public/tg.json';
import { FPS } from './theme';

export type Box = { x: number; y: number; w: number; h: number };
export type ShotMeta = { w: number; h: number; targets: Record<string, Box | null> };
export type Sentence = { text: string; start: number; end: number };

export const shots = shotsJson as Record<string, ShotMeta>;
export const tg = tgJson as {
  summaryDay: string;
  summaryNight: string;
  onDemand: string;
  alert: string;
  alertButtons: { inline_keyboard: Array<Array<{ text: string }>> };
  menu: { text: string; replyMarkup: { inline_keyboard: Array<Array<{ text: string }>> } };
};
const timing = timingJson as Record<string, { duration: number; sentences: Sentence[]; words: Array<{ w: string; start: number }> }>;

/** Пауза после реплики и запас в начале/конце ролика (кадры). */
const GAP = 14;
const INTRO_LEAD = 45;
const OUTRO_TAIL = 75;

export type Segment = {
  id: string;
  index: number;
  from: number; // начало сегмента (кадр)
  voiceFrom: number; // начало реплики (кадр, глобально)
  frames: number;
  sentences: Sentence[];
  words: Array<{ w: string; start: number }>;
};

export const segments: Segment[] = [];
{
  let at = 0;
  narration.forEach((n, index) => {
    const t = timing[n.id];
    const lead = index === 0 ? INTRO_LEAD : 0;
    const tail = index === narration.length - 1 ? OUTRO_TAIL : GAP;
    const frames = lead + Math.ceil(t.duration * FPS) + tail;
    segments.push({ id: n.id, index, from: at, voiceFrom: at + lead, frames, sentences: t.sentences, words: t.words });
    at += frames;
  });
}
export const TOTAL_FRAMES = segments.reduce((s, x) => s + x.frames, 0);
export const segmentById = (id: string) => segments.find((s) => s.id === id)!;

/**
 * Момент внутри сегмента в кадрах от начала сегмента: число — секунды от начала реплики,
 * "s2" / "s2+0.5" — начало предложения №2 (+смещение), "w:красный" / "w:чаты#2+0.3" — начало слова
 * (n-е вхождение), "end-1" — за секунду до конца сегмента.
 */
export type At = number | string;
export function atFrame(seg: Segment, at: At): number {
  const lead = seg.voiceFrom - seg.from;
  if (typeof at === 'number') return lead + Math.round(at * FPS);
  const w = /^w:([^#+-]+)(?:#(\d+))?([+-][\d.]+)?$/.exec(at);
  if (w) {
    const hits = seg.words.filter((x) => x.w === w[1].toLowerCase());
    const hit = hits[(w[2] ? Number(w[2]) : 1) - 1];
    if (!hit) throw new Error(`Нет слова «${w[1]}» в ${seg.id}`);
    return lead + Math.round((hit.start + (w[3] ? Number(w[3]) : 0)) * FPS);
  }
  const m = /^(s(\d+)|end)([+-][\d.]+)?$/.exec(at);
  if (!m) throw new Error(`Неверная метка времени: ${at}`);
  const off = m[3] ? Number(m[3]) : 0;
  if (m[1] === 'end') return seg.frames + Math.round(off * FPS);
  const s = seg.sentences[Number(m[2])];
  if (!s) throw new Error(`Нет предложения ${m[2]} в ${seg.id}`);
  return lead + Math.round((s.start + off) * FPS);
}
