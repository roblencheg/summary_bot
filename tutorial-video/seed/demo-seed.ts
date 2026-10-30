/**
 * Демо-данные для обучающего ролика: отдельная дирекция, руководитель, чаты, сообщения,
 * инциденты, получатели и саммари. Пишет ТОЛЬКО в dev-БД, идемпотентно.
 *   DEMO_MANAGER_PASSWORD=… pnpm exec tsx tutorial-video/seed/demo-seed.ts
 * Потом экспортирует HTML саммари / алерта / «Что сейчас происходит» в tutorial-video/public/tg.json.
 *
 * AICODE-NOTE: прямой SQL здесь осознанно — это инструмент подготовки ролика, а не код приложения.
 * Получатели «Активен» без telegram_user_id: доставка закроет их задания как not_activated и
 * ничего не отправит в Telegram (общий токен бота с prod). Периоды — status='ready', чтобы
 * планировщик их не подхватил. last_message_at чатов старше 10 мин — детектор всплесков молчит.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createPlatform } from '~server/platform';
import { buildContainer } from '~server/container';
import { ReportRepository } from '~server/repositories/report-repository';
import { IncidentRepository } from '~server/repositories/incident-repository';
import { ChatRepository } from '~server/repositories/chat-repository';
import type { DeliveryJob } from '~server/models/delivery';
import type { BotKeyboard } from '~server/domain/keyboard';
import { menuMessage } from '~server/services/on-demand-service';

// AICODE-NOTE: tutorial-video/src (Remotion-сцены) ожидает старый wire-формат Telegram
// {inline_keyboard:[[{text}]]}, а движок теперь отдаёт нейтральный BotKeyboard — конвертируем здесь.
const toInlineKeyboard = (k: BotKeyboard) => ({ inline_keyboard: k.map((row) => row.map((b) => ({ text: b.text }))) });

if (process.env.ALLOW_DEMO_SEED !== 'true' || process.env.NODE_ENV === 'production') throw new Error('Demo seeding requires ALLOW_DEMO_SEED=true outside production');
const platform = createPlatform();
if (!platform.configured) throw new Error('RUNTIME_BASE_URL / RUNTIME_TOKEN не заданы');
const db = platform.db;
const c = buildContainer(platform);

const DIR = 'Демонстрационное подразделение';
const LOGIN = 'demo.manager';
const PASSWORD = process.env.DEMO_MANAGER_PASSWORD ?? '';
if (PASSWORD.length < 10) throw new Error('Задайте DEMO_MANAGER_PASSWORD (не короче 10 символов)');
const NOW = new Date().toISOString();
// Новосибирск UTC+7: «29 09:15» → ISO UTC
const t = (d: string) => {
  const [day, hm] = d.split(' ');
  const [h, m] = hm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, Number(day), h - 7, m)).toISOString();
};

// ---------- дирекция и руководитель ----------
await db.exec('INSERT INTO directorates (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING', [DIR, NOW]);
const dir = (await db.first<{ id: number }>('SELECT id FROM directorates WHERE name = ?', [DIR]))!;
if (!(await db.first('SELECT id FROM admins WHERE login = ?', [LOGIN]))) {
  await c.directorates.createManager(LOGIN, PASSWORD, [dir.id], 'demo-seed');
}

// ---------- чаты ----------
const CHATS = [
  { id: -1005550001, title: 'Поддержка покупателей · Москва', username: 'shop_help_msk', importance: 'high', last: '30 10:05' },
  { id: -1005550002, title: 'Партнёры-продавцы', username: 'shop_sellers', importance: 'high', last: '30 10:20' },
  { id: -1005550003, title: 'Курьерская доставка', username: null, importance: 'normal', last: '29 18:40' },
  { id: -1005550004, title: 'Пункты выдачи · Сибирь', username: null, importance: 'normal', last: '30 09:30' },
  { id: -1005550005, title: 'Корпоративные клиенты', username: null, importance: 'low', last: '27 16:10' },
  { id: -1005550006, title: 'Акции и промокоды (старый)', username: null, importance: 'normal', last: '20 12:00', removed: true },
  { id: -1005550007, title: 'Поддержка покупателей · MAX', username: null, importance: 'normal', last: '30 10:40', channel: 'max' },
] as const;
for (const ch of CHATS) {
  const removed = 'removed' in ch && ch.removed;
  const channel = 'channel' in ch ? ch.channel : 'telegram';
  await db.exec(
    `INSERT INTO chats (id, title, type, username, is_forum, status, channel, collection_started_at, last_message_at, last_event_at,
       bot_member_status, bot_is_admin, bot_reads_all, rights_checked_at, created_at, updated_at)
     VALUES (?, ?, 'supergroup', ?, 0, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    [ch.id, ch.title, ch.username, removed ? 'removed' : 'active', channel, t('14 10:00'), t(ch.last), t(ch.last), removed ? 'left' : 'administrator', t('30 09:00'), t('14 10:00'), NOW],
  );
  await db.exec(
    `INSERT INTO chat_directorates (chat_id, directorate_id, access, created_at, importance) VALUES (?, ?, 'owner', ?, ?) ON CONFLICT DO NOTHING`,
    [ch.id, dir.id, t('14 10:00'), ch.importance],
  );
}
const [A, B, C, D] = CHATS.map((x) => x.id);
const MAXCHAT = CHATS[6].id;

// ---------- сотрудники поддержки ----------
const STAFF = [
  { id: 7100001, name: 'Демо-участник 01', label: 'Демо-участник 01, старший специалист' },
  { id: 7100002, name: 'Демо-участник 02', label: 'Демо-участник 02, поддержка' },
];
for (const ch of [A, B, C, D, CHATS[4].id]) {
  for (const s of STAFF) {
    await db.exec('INSERT INTO chat_staff (chat_id, telegram_user_id, label) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [ch, s.id, s.label]);
  }
}
await db.exec(`INSERT INTO chat_rules (chat_id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, [
  A,
  JSON.stringify({ noReplyWindowMin: 15 }),
  NOW,
]);
// сотрудник поддержки в MAX-чате — отдельный числовой ID (та же колонка, что у Telegram, канал задаёт чат)
await db.exec('INSERT INTO chat_staff (chat_id, telegram_user_id, label) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [MAXCHAT, 8100001, 'Демо-сотрудник MAX, поддержка MAX']);

// ---------- сообщения ----------
type Msg = {
  chat: number; mid: number; at: string; who: string; uid: number; staff?: boolean; text: string;
  reply?: number; req?: string; topic?: string; tone?: string; cats?: string[]; sev?: string; summary?: string; resolved?: boolean;
};
const MSGS: Msg[] = [
  // A — оплата не проходит (критично, несколько клиентов)
  { chat: A, mid: 501, at: '29 09:12', who: 'Демо-участник 03', uid: 7200001, text: 'Здравствуйте! Не могу оплатить заказ картой, пишет «ошибка платежа». Пробовала три раза.', req: 'a:pay-olga', topic: 'оплата', tone: 'negative', cats: ['malfunction', 'complaint'], sev: 'high', summary: 'Клиент не может оплатить заказ картой: ошибка платежа после трёх попыток.' },
  { chat: A, mid: 502, at: '29 09:20', who: 'Демо-участник 04', uid: 7200002, text: 'У меня то же самое, оплата не проходит ни с одной карты. Заказ на 18 000 ₽ висит.', req: 'a:pay-sergey', topic: 'оплата', tone: 'negative', cats: ['malfunction', 'complaint'], sev: 'critical', summary: 'Второй клиент: оплата не проходит ни с одной карты, крупный заказ не оформлен.' },
  { chat: A, mid: 503, at: '29 09:26', who: 'Демо-участник 01', uid: 7100001, staff: true, reply: 501, text: 'Демо-участник 03, Демо-участник 04, видим проблему с платёжным шлюзом, уже передали технической команде. Сообщим, как починят.' },
  { chat: A, mid: 504, at: '29 10:05', who: 'Демо-участник 05', uid: 7200003, text: 'Час не могу оплатить, это вообще нормально? Уйду в другой магазин.', req: 'a:pay-marina', topic: 'оплата', tone: 'negative', cats: ['malfunction', 'churn_risk'], sev: 'critical', summary: 'Третий клиент не может оплатить больше часа и грозит уйти к конкуренту.' },
  { chat: A, mid: 505, at: '29 11:40', who: 'Демо-участник 06', uid: 7200004, text: 'Подскажите, можно поменять адрес доставки в оформленном заказе?', req: 'a:addr-pavel', topic: 'оформление заказа', tone: 'neutral', cats: [], sev: 'info', summary: 'Клиент спрашивает, можно ли изменить адрес доставки в оформленном заказе.' },
  { chat: A, mid: 506, at: '29 11:48', who: 'Демо-участник 02', uid: 7100002, staff: true, reply: 505, text: 'Демо-участник 06, да, пришлите номер заказа в личные сообщения — поменяем.' },
  { chat: A, mid: 507, at: '29 23:40', who: 'Демо-участник 03', uid: 7200001, text: 'Оплата так и не проходит. Когда исправите?', req: 'a:pay-olga', topic: 'оплата', tone: 'negative', cats: ['malfunction', 'repeat'], sev: 'high', summary: 'Клиент повторно пишет, что оплата всё ещё не проходит.' },
  { chat: A, mid: 508, at: '30 10:05', who: 'Демо-участник 07', uid: 7200005, text: 'Добрый день, оплатил заказ, а статус «не оплачен». Деньги списались.', req: 'a:pay-kirill', topic: 'оплата', tone: 'negative', cats: ['malfunction', 'complaint'], sev: 'high', summary: 'Деньги списались, но заказ остаётся неоплаченным.' },

  // B — возврат, нет ответа поддержки
  { chat: B, mid: 701, at: '29 10:30', who: 'Демо-партнёр 01', uid: 7200011, text: 'Коллеги, третий день не можем оформить возврат по партии №4471. Кто-нибудь ответит?', req: 'b:return', topic: 'возврат/отмена', tone: 'negative', cats: ['prolonged', 'complaint'], sev: 'attention', summary: 'Продавец третий день не может оформить возврат по партии, ответа нет.' },
  { chat: B, mid: 702, at: '29 14:15', who: 'Демо-партнёр 01', uid: 7200011, text: 'Напоминаю про возврат по партии №4471.', req: 'b:return', topic: 'возврат/отмена', tone: 'negative', cats: ['prolonged', 'repeat'], sev: 'attention', summary: 'Повторное напоминание о возврате по партии.' },
  { chat: B, mid: 703, at: '29 09:40', who: 'Демо-компания 01', uid: 7200012, text: 'Как загрузить новые карточки товаров пакетом?', req: 'b:cards', topic: 'консультация', tone: 'neutral', cats: [], sev: 'info', summary: 'Продавец спрашивает про пакетную загрузку карточек товаров.' },
  { chat: B, mid: 704, at: '29 09:52', who: 'Демо-участник 01', uid: 7100001, staff: true, reply: 703, text: 'Через раздел «Товары» → «Импорт», шаблон Excel там же.' },
  { chat: B, mid: 705, at: '30 10:20', who: 'Демо-партнёр 01', uid: 7200011, text: 'Ответьте, пожалуйста, по возврату! Иначе уходим с площадки.', req: 'b:return', topic: 'возврат/отмена', tone: 'negative', cats: ['prolonged', 'churn_risk'], sev: 'attention', summary: 'Продавец снова просит ответ по возврату и грозит уйти с площадки.' },

  // C — доставка, проблема решена
  { chat: C, mid: 901, at: '29 12:10', who: 'Демо-участник 08', uid: 7200021, text: 'Курьер не приехал в назначенное окно 10–12, заказ 88231.', req: 'c:courier', topic: 'доставка', tone: 'negative', cats: ['complaint'], sev: 'high', summary: 'Курьер не приехал в назначенный интервал доставки.' },
  { chat: C, mid: 902, at: '29 12:18', who: 'Демо-участник 02', uid: 7100002, staff: true, reply: 901, text: 'Демо-участник 08, приносим извинения. Курьер будет у вас до 14:00, доставка бесплатно.' },
  { chat: C, mid: 903, at: '29 13:55', who: 'Демо-участник 08', uid: 7200021, text: 'Получила, спасибо!', req: 'c:courier', topic: 'доставка', tone: 'positive', cats: [], sev: 'info', summary: 'Клиент подтвердил получение заказа.', resolved: true },
  { chat: C, mid: 904, at: '29 18:40', who: 'Демо-участник 09', uid: 7200022, text: 'Можно ли выбрать доставку на субботу?', req: 'c:saturday', topic: 'доставка', tone: 'neutral', cats: [], sev: 'info', summary: 'Клиент спрашивает о доставке в субботу.' },
  { chat: C, mid: 905, at: '29 18:46', who: 'Демо-участник 01', uid: 7100001, staff: true, reply: 904, text: 'Да, при оформлении выберите интервал «Суббота, 10–18».' },

  // D — пункты выдачи, спокойно
  { chat: D, mid: 1101, at: '29 15:30', who: 'Демо-участник 10', uid: 7200031, text: 'Сколько хранится заказ в пункте выдачи?', req: 'd:storage', topic: 'консультация', tone: 'neutral', cats: [], sev: 'info', summary: 'Вопрос о сроке хранения заказа в пункте выдачи.' },
  { chat: D, mid: 1102, at: '29 15:34', who: 'Демо-участник 02', uid: 7100002, staff: true, reply: 1101, text: 'Демо-участник 10, 7 дней, можно продлить ещё на 3 дня в приложении.' },
  { chat: D, mid: 1103, at: '30 09:30', who: 'Демо-участник 11', uid: 7200032, text: 'Пункт на Ленина, 12 работает в выходные?', req: 'd:hours', topic: 'консультация', tone: 'neutral', cats: [], sev: 'info', summary: 'Вопрос о режиме работы пункта выдачи в выходные.' },
  { chat: D, mid: 1104, at: '30 09:33', who: 'Демо-участник 01', uid: 7100001, staff: true, reply: 1103, text: 'Демо-участник 11, да, с 10:00 до 20:00.' },

  // MAXCHAT — поддержка в MAX, спокойно
  { chat: MAXCHAT, mid: 1301, at: '30 09:50', who: 'Демо-участник 12', uid: 7200041, text: 'Можно продлить промокод до конца месяца?', req: 'e:promo', topic: 'консультация', tone: 'neutral', cats: [], sev: 'info', summary: 'Вопрос о продлении срока действия промокода до конца месяца.' },
  { chat: MAXCHAT, mid: 1302, at: '30 10:40', who: 'Демо-сотрудник MAX, поддержка MAX', uid: 8100001, staff: true, reply: 1301, text: 'Демо-участник 12, да, продлили до 30 числа — промокод сработает.' },
];
for (const m of MSGS) {
  const at = t(m.at);
  const analyzed = new Date(new Date(at).getTime() + 9000).toISOString();
  const isReq = !m.staff && m.req ? 1 : m.staff ? 0 : null;
  await db.exec(
    `INSERT INTO messages (chat_id, message_id, sent_at, received_at, author_key, author_id, author_name, is_staff, text, content_type, has_text,
       reply_to_message_id, link, analysis_status, analyzed_at, is_request, request_key, topic, tone, categories, severity, confidence, summary,
       resolution_confirmed, answers_message_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'text', 1, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id, message_id) DO UPDATE SET sent_at = excluded.sent_at, received_at = excluded.received_at, link = excluded.link`,
    [
      m.chat, m.mid, at, at, `u:${m.uid}`, m.uid, m.who, m.staff ? 1 : 0, m.text, m.reply ?? null,
      `https://t.me/c/${-m.chat - 1_000_000_000}/${m.mid}`, analyzed,
      isReq, m.staff ? null : (m.req ?? null), m.topic ?? null, m.tone ?? 'neutral',
      JSON.stringify(m.cats ?? []), m.sev ?? (m.staff ? 'none' : 'info'), 0.9, m.summary ?? null, m.resolved ? 1 : 0,
      JSON.stringify(m.reply ? [m.reply] : []),
    ],
  );
  await db.exec(
    `INSERT INTO participants (author_key, telegram_user_id, display_name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(author_key) DO UPDATE SET last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`,
    [`u:${m.uid}`, m.uid, m.who, at, at],
  );
}

// ---------- инциденты ----------
const pk = async (chat: number, mid: number) => (await db.first<{ id: number }>('SELECT id FROM messages WHERE chat_id = ? AND message_id = ?', [chat, mid]))!.id;
type Inc = {
  chat: number; status: string; title: string; summary: string; topic: string; cats: string[]; sev: string; reason: string;
  author: string; uid: number; authors: number; repeat: string; mids: number[]; seenBy?: string;
};
const INCS: Inc[] = [
  {
    chat: A, status: 'new', title: 'Массово не проходит оплата картой', topic: 'оплата', cats: ['malfunction', 'complaint', 'churn_risk'], sev: 'critical',
    summary: 'С утра 29 октября несколько покупателей не могут оплатить заказы картой: ошибка платежа. Один клиент грозит уйти к конкуренту, у другого деньги списались, а заказ не оплачен.',
    reason: 'Сбой затрагивает нескольких клиентов и блокирует оплату заказов.', author: 'Демо-участник 03', uid: 7200001, authors: 4, repeat: 'multi', mids: [501, 502, 503, 504, 507, 508],
  },
  {
    chat: B, status: 'seen', title: 'Третий день нет ответа по возврату партии', topic: 'возврат/отмена', cats: ['prolonged', 'repeat', 'churn_risk'], sev: 'attention',
    summary: 'Продавец Демо-партнёр 01 с 29 октября просит оформить возврат по партии №4471, поддержка не ответила. Продавец пишет, что может уйти с площадки.',
    reason: 'Затянувшийся вопрос без ответа, риск ухода партнёра.', author: 'Демо-партнёр 01', uid: 7200011, authors: 1, repeat: 'author_repeat', mids: [701, 702, 705], seenBy: LOGIN,
  },
  {
    chat: C, status: 'closed', title: 'Курьер не приехал в назначенное окно', topic: 'доставка', cats: ['complaint'], sev: 'high',
    summary: 'Курьер не приехал в интервал 10–12. Поддержка извинилась и организовала доставку до 14:00, клиент подтвердил получение.',
    reason: 'Сорвана доставка в обещанный интервал.', author: 'Демо-участник 08', uid: 7200021, authors: 1, repeat: 'single', mids: [901, 902, 903], seenBy: LOGIN,
  },
];
const existing = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM incidents WHERE chat_id IN (?, ?, ?)', [A, B, C]);
if (!existing?.n) {
  for (const i of INCS) {
    const ats = i.mids.map((m) => t(MSGS.find((x) => x.chat === i.chat && x.mid === m)!.at));
    const first = ats[0];
    const last = ats[ats.length - 1];
    const created = new Date(new Date(first).getTime() + 12000).toISOString();
    const r = await db.exec(
      `INSERT INTO incidents (chat_id, kind, status, title, summary, topic, categories, severity, severity_reason, confidence, entities, author_key, author_name,
         affected_authors, message_count, repeat_type, first_message_at, last_message_at, analysis_version, last_alert_at, last_alert_severity,
         last_alert_categories, last_alert_authors, last_alert_message_count, status_changed_by, status_changed_at, created_at, updated_at)
       VALUES (?, 'problem', ?, ?, ?, ?, ?, ?, ?, 0.93, '[]', ?, ?, ?, ?, ?, ?, ?, 'gpt-5.4-mini|analysis-v1|bd0b46a9689f', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        i.chat, i.status, i.title, i.summary, i.topic, JSON.stringify(i.cats), i.sev, i.reason, `u:${i.uid}`, i.author, i.authors, i.mids.length, i.repeat,
        first, last, created, i.sev, JSON.stringify(i.cats), i.authors, i.mids.length, i.seenBy ?? null, i.seenBy ? last : null, created, last,
      ],
    );
    const id = Number(r.lastInsertRowid);
    for (const m of i.mids) await db.exec('INSERT INTO incident_messages (incident_id, message_pk, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [id, await pk(i.chat, m), created]);
    const ev = (at: string, kind: string, details: unknown, actor: string | null = null) =>
      db.exec('INSERT INTO incident_events (incident_id, at, kind, details, actor) VALUES (?, ?, ?, ?, ?)', [id, at, kind, JSON.stringify(details), actor]);
    await ev(created, 'created', { messageId: i.mids[0], related: null });
    await ev(created, 'alert', { reason: 'первое значимое событие', recipients: 2 });
    for (const [n, m] of i.mids.slice(1).entries()) await ev(ats[n + 1], 'message', { messageId: m });
    if (i.status === 'seen') await ev(t('29 17:30'), 'status', { from: 'new', to: 'seen' }, LOGIN);
    if (i.status === 'closed') await ev(t('29 14:05'), 'status', { from: 'new', to: 'closed' }, LOGIN);
  }
}

// ---------- получатели и подписки ----------
const ALL_CATS = ['complaint', 'conflict', 'prolonged', 'churn_risk', 'repeat', 'spike', 'malfunction'];
const RECIPIENTS: Array<{ name: string; username: string | null; status: string; summary: number[]; alert: number[]; sev: string; maxUserId?: number; maxStatus?: string }> = [
  { name: 'Демо-участник 13', username: 'demo_recipient_01', status: 'active', summary: [A, B, C, D, CHATS[4].id, MAXCHAT], alert: [A, B], sev: 'attention', maxUserId: 8300001, maxStatus: 'active' },
  { name: 'Демо-участник 14', username: 'demo_recipient_02', status: 'active', summary: [A, C], alert: [A, C], sev: 'high' },
  // привязана только к MAX — показывает, что каналы независимы друг от друга
  { name: 'Демо-участник 15', username: null, status: 'pending', summary: [D], alert: [], sev: 'attention', maxUserId: 8300002, maxStatus: 'active' },
];
const recIds: number[] = [];
for (const r of RECIPIENTS) {
  let row = await db.first<{ id: number }>(
    'SELECT r.id FROM recipients r JOIN recipient_directorates rd ON rd.recipient_id = r.id WHERE rd.directorate_id = ? AND r.name = ?',
    [dir.id, r.name],
  );
  if (!row) {
    const res = await db.exec(
      `INSERT INTO recipients (name, telegram_user_id, telegram_username, status, is_tech_admin, summary_day, summary_night, alert_categories,
         alert_min_severity, activated_at, last_delivery_at, last_delivery_status, created_at, updated_at)
       VALUES (?, NULL, ?, ?, 0, 1, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.name, r.username, r.status, JSON.stringify(ALL_CATS), r.sev, r.status === 'active' ? t('15 11:00') : null,
        r.status === 'active' ? t('30 08:00') : null, r.status === 'active' ? 'sent' : null, t('15 10:40'), NOW,
      ],
    );
    row = { id: Number(res.lastInsertRowid) };
    await db.exec('INSERT INTO recipient_directorates (recipient_id, directorate_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [row.id, dir.id]);
  }
  await db.exec('UPDATE recipients SET max_user_id = ?, max_status = ?, max_activated_at = ? WHERE id = ?', [
    r.maxUserId ?? null,
    r.maxStatus ?? 'pending',
    r.maxUserId ? t('16 09:00') : null,
    row.id,
  ]);
  recIds.push(row.id);
  for (const ch of r.summary) await db.exec('INSERT INTO summary_subscriptions (recipient_id, chat_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [row.id, ch]);
  for (const ch of r.alert) await db.exec('INSERT INTO alert_subscriptions (recipient_id, chat_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [row.id, ch]);
}

// ---------- история алертов (терминальные статусы — воркер доставки их не берёт) ----------
const demoIncidents = await db.query<{ id: number; chat_id: number; severity: string; created_at: string }>(
  'SELECT id, chat_id, severity, created_at FROM incidents WHERE chat_id IN (?, ?, ?)',
  [A, B, C],
);
for (const inc of demoIncidents) {
  for (const [n, r] of RECIPIENTS.entries()) {
    if (!r.alert.includes(inc.chat_id) || (r.sev === 'high' && inc.severity === 'attention')) continue;
    const sentAt = new Date(new Date(inc.created_at).getTime() + 3000).toISOString();
    await db.exec(
      `INSERT INTO delivery_jobs (dedup_key, recipient_id, kind, incident_id, chat_id, status, attempts, parts_sent, next_attempt_at, created_at, sent_at)
       VALUES (?, ?, 'alert', ?, ?, 'sent', 1, 1, ?, ?, ?) ON CONFLICT(dedup_key) DO NOTHING`,
      [`alert:${inc.id}:${recIds[n]}`, recIds[n], inc.id, inc.chat_id, inc.created_at, inc.created_at, sentAt],
    );
  }
}
const incA0 = demoIncidents.find((i) => i.chat_id === A);
if (incA0) {
  await db.exec(
    `INSERT INTO feedback (incident_id, recipient_id, verdict, analysis_version, created_at) VALUES (?, ?, 'useful', 'gpt-5.4-mini|analysis-v1|bd0b46a9689f', ?)
     ON CONFLICT(incident_id, recipient_id) DO NOTHING`,
    [incA0.id, recIds[1], t('29 09:30')],
  );
}

// ---------- саммари (без отправки в Telegram) ----------
const reports = new ReportRepository(db);
const PERIODS = [
  { type: 'day' as const, from: t('29 08:00'), to: t('29 22:00') },
  { type: 'night' as const, from: t('29 22:00'), to: t('30 08:00') },
];
const rich: Record<string, string | null> = {};
for (const p of PERIODS) {
  const period = await reports.ensurePeriod(p.type, p.from, p.to);
  if (period.status !== 'ready') await reports.setPeriodStatus(period.id, 'ready', null);
  for (const ch of CHATS) if (!('removed' in ch)) await c.digests.rebuild(ch.id, period);
  for (const [n, recipientId] of recIds.slice(0, 2).entries()) {
    const { id } = await reports.ensureReport({
      recipientId, periodId: period.id, periodType: p.type, startsAt: p.from, endsAt: p.to, version: 1, manual: false, status: 'pending',
    });
    const report = (await c.reports.getReport(id))!;
    const recipient = (await c.recipients.getRaw(recipientId))!;
    const b = await c.reports.assemble(report, recipient, 'telegram');
    // AICODE-NOTE: саммари собирается задним числом, поэтому движок честно помечает «с задержкой» и
    // «данные неполные» (пробел сбора dev-сервера). Для ролика убираем эти пометки — в штатной работе их нет.
    const clean = (s: string) => s.replace(/<p>⚠️ Данные неполные:[^<]*(<[^/][^>]*>[^<]*<\/[^>]+>[^<]*)*<\/p>|<p>⏱ <i>Отправлено с задержкой<\/i><\/p>/g, '');
    const cleanText = (s: string) => s.split('\n').filter((l) => !/^(⚠️ Данные неполные|⏱ )/.test(l.replace(/<[^>]+>/g, ''))).join('\n');
    await c.reports.saveBuilt(id, b.chatIds, b.parts.map(cleanText), cleanText(b.fullText), b.rich && clean(b.rich), false, 'sent');
    await reports.setReportStatus(id, 'sent');
    const sentAt = new Date(new Date(p.to).getTime() + 40_000).toISOString();
    await db.exec('UPDATE reports SET built_at = ?, sent_at = ?, created_at = ? WHERE id = ?', [sentAt, sentAt, p.to, id]);
    await db.exec(
      `INSERT INTO delivery_jobs (dedup_key, recipient_id, kind, report_id, status, attempts, parts_sent, next_attempt_at, created_at, sent_at)
       VALUES (?, ?, 'summary', ?, 'sent', 1, 1, ?, ?, ?) ON CONFLICT(dedup_key) DO NOTHING`,
      [`demo-summary:${id}`, recipientId, id, p.to, p.to, sentAt],
    );
    if (n === 0) rich[p.type] = (await c.reports.getReport(id))!.richHtml ?? null;
  }
}

// ---------- экспорт для сцен Telegram ----------
const onDemand = await c.reports.assembleOnDemand(recIds[0], RECIPIENTS[0].summary, t('30 08:00'), t('30 11:30'));
const incRepo = new IncidentRepository(db);
const chatRepo = new ChatRepository(db);
const incA = (await db.first<{ id: number }>('SELECT id FROM incidents WHERE chat_id = ? ORDER BY id LIMIT 1', [A]))!;
const incident = (await incRepo.get(incA.id))!;
const job = { kind: 'alert', uncertain: false, payload: null, sourceReceivedAt: null } as unknown as DeliveryJob;
const alert = await c.alerts.render(incident, await chatRepo.get(A), job, 'Asia/Novosibirsk');

mkdirSync('tutorial-video/public', { recursive: true });
writeFileSync(
  'tutorial-video/public/tg.json',
  JSON.stringify(
    {
      summaryNight: rich.night,
      summaryDay: rich.day,
      onDemand: onDemand.rich && onDemand.rich.replace(/<p>⚠️ Данные неполные:[^<]*<\/p>/g, ''),
      alert: alert.text,
      alertButtons: toInlineKeyboard(alert.keyboard),
      menu: { text: menuMessage().text, replyMarkup: toInlineKeyboard(menuMessage().keyboard) },
      incidentId: incA.id,
    },
    null,
    2,
  ),
);
console.log('Готово. Вход:', LOGIN, '· дирекция', dir.id, '· получатели', recIds.join(','));
process.exit(0);
