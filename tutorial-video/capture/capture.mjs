// Снимки настоящего интерфейса под демо-руководителем + координаты элементов для курсора и приближений.
//   DEMO_MANAGER_PASSWORD=… node capture/capture.mjs [http://localhost:3000]
// Результат: public/shots/<id>.png (2x) и public/shots/shots.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/usr/local/lib/node_modules/playwright');
}

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PASSWORD = process.env.DEMO_MANAGER_PASSWORD;
if (!PASSWORD) throw new Error('Задайте DEMO_MANAGER_PASSWORD');
const OUT = new URL('../public/shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await playwright.chromium.launch({ args: ['--lang=ru-RU'] });
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  timezoneId: 'Asia/Novosibirsk',
});
const p = await ctx.newPage();
const meta = {};

const settle = async () => {
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(700);
};
const go = async (path) => {
  await p.goto(BASE + path);
  await settle();
};
const card = (title) => p.locator('div.rounded-2xl', { has: p.getByRole('heading', { name: title, exact: true }) }).last();
const box = async (loc) => {
  const b = await loc.first().boundingBox({ timeout: 3000 }).catch(() => null);
  if (!b) return null;
  const sy = await p.evaluate(() => window.scrollY);
  return { x: Math.round(b.x), y: Math.round(b.y + sy), w: Math.round(b.width), h: Math.round(b.height) };
};
async function shot(id, targets = {}, { fullPage = false } = {}) {
  await p.evaluate(() => window.scrollTo(0, 0));
  const t = {};
  // пункты меню — в каждом снимке с навигацией (курсор приходит из меню)
  if ((await p.locator('aside a').count()) > 0) {
    for (const [k, name] of Object.entries({ navOverview: 'Обзор', navChats: 'Чаты', navUsers: 'Пользователи', navIncidents: 'Инциденты', navReports: 'Отчёты' })) {
      targets = { [k]: nav(name), ...targets };
    }
  }
  for (const [k, loc] of Object.entries(targets)) {
    t[k] = await box(loc);
    if (!t[k]) console.warn(`  ! ${id}: не найдена цель ${k}`);
  }
  const size = await p.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  await p.screenshot({ path: `${OUT}${id}.png`, fullPage });
  meta[id] = { w: 1600, h: fullPage ? Math.max(900, size.h) : 900, targets: t };
  console.log('✓', id);
}
const modal = () => p.locator('div.fixed.inset-0 > div').last();
const nav = (name) => p.locator('aside a', { hasText: name });

// ---------- вход ----------
await go('/login');
const loginInput = p.locator('input').first();
const pwInput = p.locator('input[type=password]');
const submit = p.getByRole('button', { name: 'Войти' });
await shot('login', { login: loginInput, password: pwInput, submit });
await loginInput.fill('demo.manager');
await pwInput.fill(PASSWORD);
await shot('login-filled', { login: loginInput, password: pwInput, submit });
await submit.click();
await p.waitForResponse((r) => r.url().includes('/api/auth/login'));
await p.waitForTimeout(1000);
await go('/');

// ---------- обзор ----------
await shot('overview', {
  sidebar: p.locator('aside').first(),
  navOverview: nav('Обзор'),
  navChats: nav('Чаты'),
  navUsers: nav('Пользователи'),
  navIncidents: nav('Инциденты'),
  navReports: nav('Отчёты'),
  stats: p.getByText('Сообщений', { exact: true }).locator('xpath=ancestor::div[contains(@class,"grid")][1]'),
  user: p.getByText('demo.manager'),
});

// ---------- чаты ----------
await go('/chats');
const quiet = p.locator('select').first();
await shot('chats', {
  connect: p.getByRole('button', { name: 'Подключить чат' }),
  quiet: p.getByText('Чаты без событий в саммари').locator('xpath=..'),
  quietSelect: quiet,
  table: p.locator('table').first(),
  rowA: p.locator('tbody tr', { hasText: 'Поддержка покупателей' }),
  archive: p.getByRole('button', { name: /Архив/ }),
});
await p.getByRole('button', { name: 'Подключить чат' }).click();
await p.waitForTimeout(600);
await shot('connect-dialog', { channel: modal().locator('select').first(), get: p.getByRole('button', { name: 'Получить код' }), dialog: modal() });
await p.getByRole('button', { name: 'Получить код' }).click();
await p.waitForTimeout(1200);
await shot('connect-link', { dialog: modal(), link: modal().locator('input').first(), command: modal().getByText(/\/connect/) });
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

// ---------- подключить чат: вариант MAX (без ссылки, ручное добавление бота + команда) ----------
await p.getByRole('button', { name: 'Подключить чат' }).click();
await p.waitForTimeout(600);
await modal().locator('select').first().selectOption('max');
await p.waitForTimeout(300);
await shot('connect-max-dialog', { channel: modal().locator('select').first(), get: p.getByRole('button', { name: 'Получить код' }), dialog: modal() });
await p.getByRole('button', { name: 'Получить код' }).click();
await p.waitForTimeout(1200);
await shot('connect-max', { dialog: modal(), command: modal().getByText(/\/connect/) });
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
await p.getByRole('button', { name: /Архив/ }).click();
await p.waitForTimeout(600);
await shot('chats-archive', { archive: p.getByRole('button', { name: /Архив/ }), table: p.locator('table').first() });

// ---------- карточка чата ----------
await go('/chats/-1005550001');
await shot(
  'chat-a',
  {
    importance: p.locator('select').first(),
    state: card('Состояние'),
    staff: card('Сотрудники поддержки'),
    recipients: card('Кому уходит этот чат'),
    rules: card('Правила анализа и алертов для чата'),
    messages: card('Последние сообщения'),
    collect: p.getByRole('button', { name: /сбор/i }),
  },
  { fullPage: true },
);

// ---------- карточка чата MAX: канал в заголовке, подсказка про MAX ID у сотрудников ----------
await go('/chats/-1005550007');
await shot(
  'chat-max',
  {
    title: p.locator('h1').first(),
    staff: card('Сотрудники поддержки'),
  },
  { fullPage: true },
);

// ---------- пользователи ----------
await go('/users');
const newCard = card('Новый получатель');
const nameInput = newCard.locator('input');
await shot('users', {
  form: newCard,
  name: nameInput,
  create: newCard.getByRole('button', { name: 'Создать' }),
  list: p.locator('table').first(),
  matrix: card('Матрица назначений'),
});
await nameInput.fill('Демо-участник 16');
await shot('users-typed', { form: newCard, name: nameInput, create: newCard.getByRole('button', { name: 'Создать' }) });
await newCard.getByRole('button', { name: 'Создать' }).click();
await p.waitForTimeout(1500);
await settle();
if (!/\/users\/\d+/.test(p.url())) {
  await p.locator('tbody tr', { hasText: 'Демо-участник 16' }).first().click();
  await settle();
}
const newUserUrl = p.url();
const issue = p.getByRole('button', { name: 'Выдать код привязки' }).first();
await shot('user-new', { issue, status: p.getByText('Не активировал бота').first() });
await issue.click();
await p.waitForTimeout(1200);
await shot('user-new-link', { dialog: modal(), link: modal().locator('input').first() });
await p.keyboard.press('Escape');

await go('/users/7');
await shot('user-maria', {
  status: p.getByText('Активен').first(),
  test: p.getByRole('button', { name: 'Тестовое уведомление' }).first(),
  menu: p.getByRole('button', { name: 'Отправить меню' }).first(),
  summary: card('Саммари'),
  toggles: p.getByRole('switch').first().locator('xpath=..'),
  alerts: card('Алерты'),
  severity: card('Алерты').locator('select'),
});
await go('/users');
await shot('users-matrix', { matrix: card('Матрица назначений') });

// ---------- инциденты ----------
await go('/incidents');
await shot('incidents', {
  filters: p.locator('select').first().locator('xpath=../..'),
  rowCritical: p.locator('tbody tr', { hasText: 'Массово не проходит' }),
  table: p.locator('table').first(),
});
await p.locator('tbody tr', { hasText: 'Массово не проходит' }).click();
await settle();
await shot(
  'incident',
  {
    title: p.locator('h1').first(),
    status: p.getByRole('button', { name: 'Просмотрен' }).locator('xpath=..'),
    reasons: card('Основания'),
    timeline: card('Хронология'),
    messages: card('Связанные сообщения'),
    feedback: card('Оценки получателей'),
  },
  { fullPage: true },
);

// ---------- отчёты ----------
await go('/summaries');
await shot('summaries', {
  list: card('Сформированные отчёты'),
  row: p.locator('tbody tr', { hasText: 'Демо-участник 13' }).filter({ hasText: 'Дневной' }).first(),
});
await p.locator('tbody tr', { hasText: 'Демо-участник 13' }).filter({ hasText: 'Дневной' }).first().click();
await p.waitForTimeout(1500);
await shot('report', { dialog: modal() });
await p.evaluate(() => {
  const d = document.querySelector('div.fixed.inset-0 > div');
  const el = d;
  const rich = d.querySelector('.tg-rich');
  if (el && rich) el.scrollTop = rich.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 60;
});
await p.waitForTimeout(400);
await shot('report-rich', { dialog: modal() });

// ---------- уборка: удаляем созданного для ролика получателя ----------
const newId = newUserUrl.match(/\/users\/(\d+)/)?.[1];
if (newId) {
  const res = await p.evaluate(async (id) => (await fetch(`/api/recipients/${id}`, { method: 'DELETE' })).status, newId);
  console.log('удалён получатель', newId, res);
}

writeFileSync(`${OUT}shots.json`, JSON.stringify(meta, null, 2));
await browser.close();
