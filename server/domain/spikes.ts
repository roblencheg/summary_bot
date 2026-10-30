/**
 * Правило всплеска. База — среднее число сообщений на окно W в ту же локальную
 * время суток (±30 мин) за предыдущие N дней, ВКЛЮЧАЯ пустые окна; текущее окно
 * в базу не входит (берутся только прошлые дни).
 */

export interface SpikeInput {
  windowCount: number;
  windowAuthors: number;
  baselineMessages: number; // сумма сообщений в сопоставимых интервалах прошлых дней
  baselineWindows: number; // число окон W в этих интервалах
  historyLimited: boolean; // меньше N дней истории или крупные пробелы
}

export interface SpikeRules {
  spikeMinMessages: number;
  spikeRatio: number;
}

export interface SpikeVerdict {
  isSpike: boolean;
  baselinePerWindow: number;
  ratio: number | null;
}

export function evaluateSpike(input: SpikeInput, rules: SpikeRules): SpikeVerdict {
  const baselinePerWindow = input.baselineWindows > 0 ? input.baselineMessages / input.baselineWindows : 0;
  const ratio = baselinePerWindow > 0 ? input.windowCount / baselinePerWindow : null;
  if (input.windowCount < rules.spikeMinMessages) return { isSpike: false, baselinePerWindow, ratio };
  if (input.historyLimited) return { isSpike: true, baselinePerWindow, ratio };
  const isSpike = input.windowCount >= rules.spikeRatio * baselinePerWindow;
  return { isSpike, baselinePerWindow, ratio };
}
