// Озвучка сегментов через managed ElevenLabs (with-timestamps) + тайминг предложений для субтитров.
//   node voice/voice.mjs            — синтезирует только изменившиеся сегменты
// Результат: public/audio/<id>.mp3 и public/audio/timing.json
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.ELEVENLABS_BASE_URL;
const KEY = process.env.ELEVENLABS_API_KEY;
if (!BASE || !KEY) throw new Error('ELEVENLABS_BASE_URL / ELEVENLABS_API_KEY не заданы');

const VOICE = process.env.VOICE_ID ?? 'bIHbv24MWmeRgasZH58o'; // Will — premade, мужской голос для обучения
const MODEL = 'eleven_multilingual_v2';
const SPEED = 1.07;
const root = new URL('..', import.meta.url).pathname;
const OUT = `${root}public/audio/`;
mkdirSync(OUT, { recursive: true });

const segments = JSON.parse(readFileSync(`${root}src/narration.json`, 'utf8'));
const timingPath = `${OUT}timing.json`;
const timing = existsSync(timingPath) ? JSON.parse(readFileSync(timingPath, 'utf8')) : {};
const splitSentences = (s) => s.split(/(?<=[.!?])\s+/).filter(Boolean);

for (const [i, seg] of segments.entries()) {
  const say = seg.say ?? seg.text;
  const hash = createHash('sha1').update(`${VOICE}|${MODEL}|${SPEED}|${say}|${seg.text}`).digest('hex').slice(0, 12);
  if (timing[seg.id]?.hash === hash && timing[seg.id].words && existsSync(`${OUT}${seg.id}.mp3`)) continue;

  const res = await fetch(`${BASE}/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: say,
      model_id: MODEL,
      language_code: 'ru',
      previous_text: segments[i - 1]?.say ?? segments[i - 1]?.text,
      next_text: segments[i + 1]?.say ?? segments[i + 1]?.text,
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.1, speed: SPEED },
    }),
  });
  if (!res.ok) throw new Error(`${seg.id}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  writeFileSync(`${OUT}${seg.id}.mp3`, Buffer.from(data.audio_base64, 'base64'));

  // границы предложений берём из выравнивания произносимого текста, подписи — из текста субтитров
  const a = data.alignment;
  const chars = a.characters.join('');
  const said = splitSentences(say);
  const shown = splitSentences(seg.text);
  const sentences = [];
  let from = 0;
  for (const [k, s] of said.entries()) {
    const start = chars.indexOf(s.slice(0, 8), from);
    const endIdx = Math.min(chars.length - 1, (start < 0 ? from : start) + s.length - 1);
    sentences.push({ text: shown[k] ?? s, start: a.character_start_times_seconds[Math.max(start, from)], end: a.character_end_times_seconds[endIdx] });
    from = endIdx + 1;
  }
  // слова с временем начала — для привязки анимации к ключевым словам («w:красный»)
  const words = [];
  for (const m of chars.matchAll(/[\p{L}\p{N}]+/gu)) words.push({ w: m[0].toLowerCase(), start: a.character_start_times_seconds[m.index] });
  const duration = a.character_end_times_seconds.at(-1);
  timing[seg.id] = { hash, duration, sentences, words };
  writeFileSync(timingPath, JSON.stringify(timing, null, 2));
  console.log(`✓ ${seg.id} ${duration.toFixed(1)} с`);
}
console.log('Итого:', segments.reduce((s, x) => s + timing[x.id].duration, 0).toFixed(1), 'с речи');
