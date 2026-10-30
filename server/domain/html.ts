/** Экранирование для parse_mode=HTML Telegram. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

export function link(url: string | null | undefined, label: string): string {
  return url ? `<a href="${escapeAttr(url)}">${escapeHtml(label)}</a>` : escapeHtml(label);
}

export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
