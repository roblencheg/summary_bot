import type { Chat } from '~server/models/chat';
import type { ChatPeriodDigest, DigestStatement } from '~server/models/report';
import type { Importance, SummaryPrefs } from '~server/models/directorate';
import { CATEGORY_LABELS, INCIDENT_STATUS_LABELS, TONE_LABELS, type Category, type IncidentStatus, type Severity, type Tone } from '~shared/domain';
import {
  LEVEL_ICON,
  LEVEL_LABEL,
  REQUEST_STATUS_ICON,
  SEVERITY_ICON,
  chatSituation,
  isActiveIncident,
  levelRank,
  plural,
  severityOrder,
  worstLevel,
  type ChatSituation,
} from '~server/domain/situation';
import { escapeHtml, link, truncate } from '~server/domain/html';
import { maskIdentifiers } from '~server/domain/masking';
import { formatLocal, formatLocalShort } from '~server/domain/periods';
import { GAP_REASON_LABELS } from './gap-service';
import { TECH } from './settings-defaults';

/**
 * Общая раскладка саммари и «Что сейчас происходит» (порядок чатов, чаты без событий, «Требует решения»)
 * и рендер в формате rich message Telegram (HTML с заголовками, таблицами и сворачиваемыми разделами).
 * Чистые функции: данные дайджестов → текст. Старый текстовый формат (запасной) — в ReportService.
 */

export interface RenderView {
  /** Эмодзи и название: «☀️», «Дневное саммари»; хвост — « (сформировано вручную)», « · на 14:20». */
  icon: string;
  name: string;
  tail: string;
  startsAt: string;
  endsAt: string;
  notes: string[];
  /** Период и полнота данных в шапке; в «Что сейчас происходит» не нужны — время уже в заголовке. */
  meta: boolean;
  /** Важность чатов и режим чатов без событий — по дирекциям получателя. */
  prefs: SummaryPrefs;
}

export type Item = { chat: Chat; digest: ChatPeriodDigest };
export type Placed = Item & { sit: ChatSituation };

/** Пунктов в блоке «Требует решения» в Telegram; остальное — в разделах чатов и веб-интерфейсе. */
export const DECISIONS_LIMIT = 15;
const IMPORTANCE_RANK: Record<Importance, number> = { low: 0, normal: 1, high: 2 };

/** Пробелы сбора, заметные руководителю: от TECH.reportGapMinMs; открытый пробел — до конца интервала отчёта. */
export function longGaps(d: ChatPeriodDigest, endsAt: string): ChatPeriodDigest['content']['gaps'] {
  const end = new Date(endsAt).getTime();
  return d.content.gaps.filter((g) => (g.endedAt ? new Date(g.endedAt).getTime() : end) - new Date(g.startedAt).getTime() >= TECH.reportGapMinMs);
}

export const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '—');

/** Порядок: важность (задаёт руководитель), затем цвет, затем название; тихие чаты — по режиму дирекции. */
export function plan(view: RenderView, items: Item[]) {
  const importance = (id: number) => view.prefs.importance.get(id) ?? 'normal';
  const all: Placed[] = items
    .map((i) => ({ ...i, sit: chatSituation(i.digest) }))
    .sort(
      (a, b) =>
        IMPORTANCE_RANK[importance(b.chat.id)] - IMPORTANCE_RANK[importance(a.chat.id)] ||
        levelRank(b.sit.level) - levelRank(a.sit.level) ||
        a.chat.title.localeCompare(b.chat.title, 'ru'),
    );
  const isQuiet = (i: Placed) => i.sit.level === 'none' && !longGaps(i.digest, view.endsAt).length;
  const shown = view.prefs.quiet === 'full' ? all : all.filter((i) => !isQuiet(i));
  const quiet = view.prefs.quiet === 'line' ? all.filter(isQuiet).map((i) => i.chat.title) : [];
  const star = (id: number) => (importance(id) === 'high' ? '★ ' : '');
  const incomplete = items.filter((i) => longGaps(i.digest, view.endsAt).length).map((i) => i.chat.title);
  return { all, shown, quiet, star, incomplete };
}

/** Итоги «Обстановки» по всем чатам получателя. */
export function totals(all: Placed[]) {
  const overall = worstLevel(all.map((i) => i.sit.level));
  const sum = (f: (d: ChatPeriodDigest) => number) => all.reduce((a, i) => a + f(i.digest), 0);
  const active = all.flatMap((i) => i.digest.content.incidents.filter(isActiveIncident));
  const bySeverity = (['critical', 'high', 'attention', 'info'] as const)
    .map((sv) => ({ sv, n: active.filter((x) => x.severity === sv).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${SEVERITY_ICON[x.sv]}${x.n}`)
    .join(' ');
  const noReply = sum((d) => d.content.requests.filter((r) => r.status === 'no_reply').length);
  const messages = sum((d) => d.stats.messages);
  const requests = sum((d) => d.stats.requests);
  const line = [
    `${messages} ${plural(messages, 'сообщение', 'сообщения', 'сообщений')}`,
    `${requests} ${plural(requests, 'обращение', 'обращения', 'обращений')}`,
    noReply ? `⏳ ${noReply} без ответа` : null,
    bySeverity ? `инциденты ${bySeverity}` : 'инцидентов нет',
  ]
    .filter(Boolean)
    .join(' · ');
  return { overall, line };
}

export const situationWhy = (sit: ChatSituation) => (sit.level === 'none' ? 'сообщений не было' : sit.reasons.length ? sit.reasons.join(', ') : 'спокойно');

// AICODE-NOTE: у спокойных (🟢) чатов фразы AI вида «инцидентов нет, тон нейтральный…» заменяются одним «Инцидентов нет» — так просил руководитель.
export const CALM = 'Инцидентов нет';

/** Краткая картина: утверждения AI по неспокойным чатам и список спокойных чатов. */
export function picture(all: Placed[]) {
  const overview = all.filter((i) => i.sit.level !== 'green').flatMap((i) => i.digest.content.overview.slice(0, 3).map((s) => ({ s, i })));
  const calm = all.filter((i) => i.sit.level === 'green').map((i) => i.chat.title);
  return { overview, calm };
}

export interface DecisionRow {
  rank: number;
  at: string;
  icon: string;
  who: string;
  where: string;
  what: string;
  status: string | null;
  link: string | null;
  ref: string;
}

/** «Требует решения»: активные инциденты и обращения без ответа по всем чатам (без дублей по автору). */
export function decisionRows(items: Item[], mask: boolean): DecisionRow[] {
  const m = (s: string) => (mask ? maskIdentifiers(s) : s);
  const rows: DecisionRow[] = [];
  for (const { chat, digest } of items) {
    const active = digest.content.incidents.filter(isActiveIncident);
    for (const i of active) {
      rows.push({
        rank: severityOrder(i.severity),
        at: i.firstMessageAt ?? '',
        icon: SEVERITY_ICON[i.severity as Severity] ?? '•',
        who: (i.authorName ?? 'автор неизвестен') + (i.affectedAuthors > 1 ? ` и ещё ${i.affectedAuthors - 1}` : ''),
        where: chat.title,
        what: m(truncate(i.title, 160)),
        status: i.staffReplied === true ? '💬 поддержка отвечала' : i.staffReplied === false ? '⏳ ответа поддержки нет' : null,
        link: i.link ?? null,
        ref: `#${i.id}`,
      });
    }
    // обращение без ответа, по автору которого уже есть активный инцидент в этом чате, не дублируем
    const covered = new Set(active.map((i) => i.authorName).filter(Boolean));
    for (const r of digest.content.requests.filter((x) => x.status === 'no_reply' && !covered.has(x.authorName))) {
      rows.push({
        rank: r.severity === 'none' ? -1 : severityOrder(r.severity),
        at: r.sentAt,
        icon: REQUEST_STATUS_ICON.no_reply,
        who: r.authorName,
        where: chat.title,
        what: m(truncate(r.summary || 'суть не определена', 160)),
        status: '⏳ возможно, без ответа',
        link: r.link,
        ref: r.link ? 'ссылка' : `сообщение #${r.firstMessageId}`,
      });
    }
  }
  return rows.sort((a, b) => b.rank - a.rank || a.at.localeCompare(b.at));
}

/** Утверждение AI со ссылкой на сообщение-основание. */
export function statement(s: DigestStatement, d: ChatPeriodDigest, mask: boolean): string {
  const l = d.content.keyLinks.find((k) => s.evidence.includes(k.messageId));
  return `${escapeHtml(mask ? maskIdentifiers(s.text) : s.text)}${l?.link ? ` (${link(l.link, 'источник')})` : ''}`;
}

export function commonTopics(items: Item[]): Array<[string, Array<{ title: string; n: number }>]> {
  const topicChats = new Map<string, Array<{ title: string; n: number }>>();
  for (const { chat, digest } of items) {
    for (const t of digest.stats.topics) {
      if (!topicChats.has(t.topic)) topicChats.set(t.topic, []);
      topicChats.get(t.topic)!.push({ title: chat.title, n: t.count });
    }
  }
  return [...topicChats].filter(([, v]) => v.length > 1);
}

export const LEGEND = '✅ решено · 💬 есть ответ · ⏳ возможно, без ответа · ❔ не определено';

// --- rich message (Bot API sendRichMessage, поле html) ---

const e = escapeHtml;
const td = (s: string) => `<td>${s}</td>`;

/**
 * Саммари в формате rich message: заголовки, таблицы «Обстановка» и «Требует решения»,
 * подробности по чатам в сворачиваемых блоках. Лимиты Telegram: 32 768 символов текста, 500 блоков.
 * requestsLimit — сколько обращений показывать в разделе чата (уменьшается, если не влезли в лимит блоков).
 */
export function renderRich(view: RenderView, items: Item[], tz: string, mask: boolean, requestsLimit: number = TECH.summaryPreviewRequests): string {
  const out: string[] = [`<h2>${e(view.icon)} ${e(view.name)}${e(view.tail)}</h2>`];
  const p = plan(view, items);
  if (view.meta) {
    out.push(`<p>${formatLocal(view.startsAt, tz)} – ${formatLocal(view.endsAt, tz)}</p>`);
    if (p.incomplete.length) out.push(`<p>⚠️ Данные неполные: ${e(p.incomplete.join(', '))}</p>`);
  }
  for (const n of view.notes) out.push(`<p>${n}</p>`);
  if (!items.length) {
    out.push('<p>Нет назначенных чатов.</p>');
    return out.join('');
  }

  // Обстановка: итоги и светофор таблицей
  const t = totals(p.all);
  out.push(`<h3>🚦 Обстановка: ${LEVEL_ICON[t.overall]} ${e(LEVEL_LABEL[t.overall])}</h3>`, `<p>${t.line}</p>`);
  if (p.shown.length) {
    out.push('<table bordered striped compact><tr><th></th><th>Чат</th><th>Что происходит</th></tr>');
    for (const { chat, sit } of p.shown) {
      const title = sit.level === 'red' ? `<b>${e(chat.title)}</b>` : e(chat.title);
      out.push(`<tr>${td(LEVEL_ICON[sit.level])}${td(`${p.star(chat.id)}${title}`)}${td(e(situationWhy(sit)))}</tr>`);
    }
    out.push('</table>');
  }
  if (p.quiet.length) out.push(`<p>⚪ Без событий: ${e(p.quiet.join(', '))}</p>`);
  if (!p.shown.length && !p.quiet.length) out.push('<p>За период событий не было.</p>');

  // Требует решения: кто · где · что · статус
  const rows = decisionRows(items, mask);
  out.push('<h3>🔥 Требует решения</h3>');
  if (!rows.length) out.push('<p>Вопросов, требующих решения, нет.</p>');
  else {
    out.push('<table bordered striped compact><tr><th></th><th>Кто</th><th>Где</th><th>Что</th><th>Статус</th></tr>');
    for (const r of rows.slice(0, DECISIONS_LIMIT)) {
      const ref = r.link ? link(r.link, r.ref) : e(r.ref);
      out.push(`<tr>${td(r.icon)}${td(`<b>${e(r.who)}</b>`)}${td(e(r.where))}${td(e(r.what))}${td(`${r.status ? e(r.status) + ' · ' : ''}${ref}`)}</tr>`);
    }
    out.push('</table>');
    if (rows.length > DECISIONS_LIMIT) out.push(`<p><i>…и ещё ${rows.length - DECISIONS_LIMIT} — в разделах чатов ниже и в веб-интерфейсе</i></p>`);
  }

  // Краткая картина от AI
  const { overview, calm } = picture(p.all);
  const attention = items.flatMap((i) => i.digest.content.attention.slice(0, 3).map((s) => ({ s, i })));
  out.push('<h3>📋 Краткая картина</h3>');
  if (overview.length) out.push(`<ul>${overview.map(({ s, i }) => `<li><b>${e(i.chat.title)}:</b> ${statement(s, i.digest, mask)}</li>`).join('')}</ul>`);
  if (calm.length) out.push(`<p>🟢 ${CALM}: ${e(calm.join(', '))}</p>`);
  if (!overview.length && !calm.length) {
    if (items.some((i) => !i.digest.content.aiAvailable)) out.push('<p>Текстовая картина недоступна: AI-анализ не выполнен. Обстановка выше — по данным БД.</p>');
    else out.push('<p>Существенных событий нет.</p>');
  }
  if (attention.length) {
    out.push(
      `<details><summary>Отмечено анализом (${attention.length})</summary><ul>${attention
        .map(({ s, i }) => `<li><b>${e(i.chat.title)}:</b> ${statement(s, i.digest, mask)}</li>`)
        .join('')}</ul></details>`,
    );
  }

  // Подробности по чатам — свёрнутые блоки в том же порядке
  if (p.shown.length) {
    out.push('<h3>Чаты подробно</h3>');
    for (const { chat, digest, sit } of p.shown) out.push(chatDetails(chat, digest, sit, view.endsAt, tz, mask, p.star(chat.id), requestsLimit));
  }

  const common = commonTopics(items);
  if (common.length) {
    out.push(
      `<h3>Общие темы между вашими чатами</h3><ul>${common
        .map(([topic, v]) => `<li><b>${e(topic)}:</b> ${v.map((x) => `${e(x.title)} (${x.n})`).join(', ')}</li>`)
        .join('')}</ul>`,
    );
  }
  out.push(`<footer>${LEGEND}</footer>`);
  return out.join('');
}

function chatDetails(chat: Chat, d: ChatPeriodDigest, sit: ChatSituation, endsAt: string, tz: string, mask: boolean, star: string, requestsLimit: number): string {
  const m = (s: string) => (mask ? maskIdentifiers(s) : s);
  const st = d.stats;
  const c = d.content;
  const body: string[] = [];
  if (sit.level === 'green') body.push(`<p><i>${CALM}</i></p>`);
  else if (c.headline) body.push(`<p><i>${statement(c.headline, d, mask)}</i></p>`);
  const gaps = longGaps(d, endsAt);
  for (const g of gaps) {
    body.push(
      `<p>⚠️ Данные неполные: ${formatLocalShort(g.startedAt, tz)} – ${g.endedAt ? formatLocalShort(g.endedAt, tz) : 'по сей момент'} (${e(GAP_REASON_LABELS[g.reason] ?? g.reason)})</p>`,
    );
  }
  if (st.messages === 0) body.push(`<p>${gaps.length ? 'Сообщений не получено.' : 'Сообщений не было.'}</p>`);
  else {
    const classified = st.topics.reduce((a, t) => a + t.count, 0);
    if (st.topics.length) body.push(`<p><b>Темы:</b> ${st.topics.slice(0, 6).map((t) => `${e(t.topic)} — ${t.count} (${pct(t.count, classified)})`).join(', ')}</p>`);
    if (st.tones.length) {
      const tones = st.tones.map((t) => `${TONE_LABELS[t.tone as Tone] ?? t.tone} ${t.count}`).join(', ');
      const reasons = c.toneReasons.map((s) => statement(s, d, mask)).join(' ');
      body.push(`<p><b>Тон:</b> ${e(tones)}${reasons ? `. ${reasons}` : ''}</p>`);
    }
    if (c.incidents.length) {
      body.push('<h4>Инциденты и затянувшиеся проблемы</h4><ul>');
      for (const i of c.incidents) {
        const who = i.authorName ? `<b>${e(i.authorName)}</b>${i.affectedAuthors > 1 ? ` и ещё ${i.affectedAuthors - 1}` : ''} — ` : '';
        const status = isActiveIncident(i) ? '' : ` · ${e((INCIDENT_STATUS_LABELS[i.status as IncidentStatus] ?? i.status).toLowerCase())}`;
        body.push(
          `<li>${SEVERITY_ICON[i.severity as Severity] ?? '•'} #${i.id} ${who}${e(m(truncate(i.title, 140)))} · ${e(
            i.categories.map((x) => CATEGORY_LABELS[x as Category] ?? x).join(', '),
          )} · сообщений ${i.messageCount}${status}</li>`,
        );
      }
      body.push('</ul>');
    }
    for (const s of c.spikes) {
      body.push(
        `<p>📈 Всплеск ${formatLocalShort(s.at, tz)}: ${s.count} сообщ., ${s.authors} участников${s.historyLimited ? ' (база сравнения ограничена)' : `, обычно ≈ ${s.baseline}`}${
          s.topics.length ? `, темы: ${e(s.topics.join(', '))}` : ''
        }</p>`,
      );
    }
    if (c.requests.length) {
      const shown = c.requests.slice(0, requestsLimit);
      body.push(
        shown.length < c.requests.length
          ? `<h4>Кто с чем обращался · ${shown.length} из ${c.requests.length}</h4>`
          : `<h4>Кто с чем обращался · ${c.requests.length}</h4>`,
      );
      body.push('<table striped compact><tr><th></th><th>Кто</th><th>Суть</th><th></th></tr>');
      for (const r of shown) {
        const who = `<b>${e(r.authorName)}</b>${r.identityLimited ? ' (идентификация ограничена)' : ''}`;
        const what = `${e(m(truncate(r.summary || 'суть не определена', 180)))}${r.repeats ? ` · повторов: ${r.repeats}` : ''}`;
        body.push(`<tr>${td(REQUEST_STATUS_ICON[r.status])}${td(who)}${td(what)}${td(r.link ? link(r.link, 'ссылка') : `#${r.firstMessageId}`)}</tr>`);
      }
      body.push('</table>');
      if (shown.length < c.requests.length) body.push('<p><i>Полный список — в веб-интерфейсе</i></p>');
    }
    if (c.staffConfigured) {
      const answered = c.requests.filter((r) => r.status === 'answered').length;
      const noReply = c.requests.filter((r) => r.status === 'no_reply').length;
      body.push(`<p>Ответы поддержки: 💬 есть ответ — ${answered}, ⏳ возможно без ответа — ${noReply}</p>`);
    } else {
      body.push('<p>Ответы поддержки не определяются: не задан список сотрудников</p>');
    }
  }
  return `<details><summary>${LEVEL_ICON[sit.level]} ${e(star)}<b>${e(chat.title)}</b> — ${e(situationWhy(sit))}</summary>${body.join('')}</details>`;
}

/**
 * Rich-версия в пределах лимитов Telegram (500 блоков, 32 768 символов текста): при переполнении
 * уменьшаем число обращений в разделах чатов; null — не влезает даже так (отправится текстовый формат).
 */
export function renderRichWithinLimits(view: RenderView, items: Item[], tz: string, mask: boolean): string | null {
  for (const limit of [TECH.summaryPreviewRequests as number, 10, 5, 0]) {
    const html = renderRich(view, items, tz, mask, limit);
    if (richBlockCount(html) <= 480 && html.replace(/<[^>]+>/g, '').length <= 30_000) return html;
  }
  return null;
}

/** Грубая оценка числа блоков rich message (лимит Telegram — 500). */
export function richBlockCount(html: string): number {
  return (html.match(/<(p|h[1-6]|tr|li|details|table|ul|ol|footer|blockquote)[\s>]/g) ?? []).length;
}
