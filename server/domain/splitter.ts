/**
 * Разбиение длинного HTML-сообщения Telegram на части ≤ лимита.
 * Режем по границам блоков ("\n\n"), затем строк ("\n"). Строки, которые мы генерируем,
 * короткие и содержат закрытые теги; если строка всё же длиннее лимита — режем по тексту
 * вне тегов, закрывая и заново открывая не будем: такие строки формируются без тегов.
 */

export const TELEGRAM_LIMIT = 4096;
const PREFIX_RESERVE = 40;

function hardCut(line: string, max: number): string[] {
  const out: string[] = [];
  let rest = line;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    // не резать внутри тега или HTML-сущности
    const lt = rest.lastIndexOf('<', cut);
    const gt = rest.lastIndexOf('>', cut);
    if (lt > gt) cut = lt;
    const amp = rest.lastIndexOf('&', cut);
    const semi = rest.lastIndexOf(';', cut);
    if (amp > semi && cut - amp < 10) cut = amp;
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

export function splitMessage(text: string, limit = TELEGRAM_LIMIT): string[] {
  const max = limit - PREFIX_RESERVE;
  if (text.length <= limit) return [text];

  const units: string[] = [];
  for (const block of text.split('\n\n')) {
    if (block.length <= max) {
      units.push(block);
      continue;
    }
    for (const line of block.split('\n')) {
      if (line.length <= max) units.push(line);
      else units.push(...hardCut(line, max));
    }
  }

  const parts: string[] = [];
  let cur = '';
  for (const u of units) {
    const sep = cur ? '\n\n' : '';
    if (cur.length + sep.length + u.length > max) {
      if (cur) parts.push(cur);
      cur = u;
    } else {
      cur += sep + u;
    }
  }
  if (cur) parts.push(cur);

  const n = parts.length;
  return n === 1 ? parts : parts.map((p, i) => `<i>Часть ${i + 1}/${n}</i>\n${p}`);
}
