/**
 * Маскирование идентификаторов в уведомлениях Telegram. Исходный текст хранится в БД
 * и виден администратору в веб-интерфейсе.
 */

const BULLETS = '•••';

function keepEdges(s: string, head: number, tail: number): string {
  if (s.length <= head + tail) return s.replace(/\d/g, '•');
  return s.slice(0, head) + BULLETS + s.slice(s.length - tail);
}

const RULES: Array<[RegExp, (m: string) => string]> = [
  // e-mail
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => {
    const [user, domain] = m.split('@');
    return `${user.slice(0, 1)}${BULLETS}@${domain}`;
  }],
  // номера заказов/ID вида 007-6294283
  [/\b\d{2,4}-\d{5,}\b/g, (m) => keepEdges(m, 6, 2)],
  // телефоны РФ: +7 / 8 и 10 цифр с разделителями
  [/(?:\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return `+7 ${BULLETS}-${BULLETS}-${digits.slice(-2)}`;
  }],
  // номера карт: 13–19 цифр с пробелами/дефисами
  [/\b(?:\d[ -]?){12,18}\d\b/g, (m) => `${BULLETS} ${m.replace(/\D/g, '').slice(-4)}`],
  // прочие длинные числа (≥7 цифр)
  [/\b\d{7,}\b/g, (m) => keepEdges(m, 2, 2)],
];

export function maskIdentifiers(text: string): string {
  let out = text;
  for (const [re, fn] of RULES) out = out.replace(re, fn);
  return out;
}
