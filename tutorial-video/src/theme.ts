import { loadFont as loadManrope } from '@remotion/google-fonts/Manrope';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

const manrope = loadManrope('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['cyrillic', 'latin'] });
const mono = loadMono('normal', { weights: ['400', '500'], subsets: ['cyrillic', 'latin'] });

export const FONT = manrope.fontFamily;
export const MONO = mono.fontFamily;

// Палитра приложения («Диспетчерская»: тёплая бумага, чернильная навигация, сигнальные цвета)
export const C = {
  paper: '#f3f0e8',
  surface: '#fffdf8',
  sunken: '#ece8de',
  line: '#ddd7c9',
  ink: '#151b27',
  inkSoft: '#4b5466',
  inkMute: '#8a8f99',
  night: '#121826',
  night2: '#1b2334',
  nightLine: '#2a3348',
  signal: '#d9822b',
  signalSoft: '#fbead6',
  danger: '#c4402d',
  ok: '#2a7a68',
  info: '#3a5795',
};

export const FPS = 30;
export const W = 1920;
export const H = 1080;
