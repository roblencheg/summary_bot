import type { At } from './data';

/** Шаг сцены интерфейса: смена снимка, курсор, клик и приближение к цели (имена целей — из shots.json). */
export type UiBeat = {
  at: At;
  shot?: string;
  cursor?: string;
  click?: boolean;
  /** Одна цель или несколько (объединение); null — весь экран. */
  focus?: string | string[] | null;
};

export type TgMode = 'summary' | 'situation' | 'decide' | 'alert' | 'menu';

export type Visual =
  | { kind: 'intro' }
  | { kind: 'ui'; beats: UiBeat[] }
  | { kind: 'tg'; mode: TgMode }
  | { kind: 'help' }
  | { kind: 'outro' };

export const CHAPTERS: Array<{ title: string; from: string }> = [
  { title: 'Вход и разделы', from: 'login' },
  { title: 'Что приходит в Telegram', from: 'tg-summary' },
  { title: 'Подключить чат', from: 'connect' },
  { title: 'Настроить чат', from: 'chat-importance' },
  { title: 'Пользователи', from: 'users-create' },
  { title: 'Инциденты и отчёты', from: 'incidents' },
  { title: 'Если что-то не так', from: 'help' },
];

export const STORY: Record<string, Visual> = {
  intro: { kind: 'intro' },
  login: {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'login', cursor: 'login', focus: null },
      { at: 'w:войдите-0.3', focus: ['login', 'submit'] },
      { at: 'w:логин', shot: 'login-filled', cursor: 'password' },
      { at: 'w:администратор-0.4', cursor: 'submit' },
      { at: 'end-0.5', click: true },
    ],
  },
  overview: {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'overview', cursor: 'navOverview', focus: null },
      { at: 'w:слева', cursor: 'navOverview', focus: 'sidebar' },
      { at: 'w:чаты#2-0.2', cursor: 'navChats' },
      { at: 'w:пользователи-0.2', cursor: 'navUsers' },
      { at: 'w:инциденты-0.2', cursor: 'navIncidents' },
      { at: 'w:отчёты-0.2', cursor: 'navReports' },
      { at: 'w:обзоре-0.3', cursor: 'stats', focus: 'stats' },
    ],
  },
  'tg-summary': { kind: 'tg', mode: 'summary' },
  'tg-situation': { kind: 'tg', mode: 'situation' },
  'tg-decide': { kind: 'tg', mode: 'decide' },
  'tg-alert': { kind: 'tg', mode: 'alert' },
  'tg-menu': { kind: 'tg', mode: 'menu' },
  connect: {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'overview', cursor: 'navOverview', focus: null },
      { at: 'w:раздел', cursor: 'navChats' },
      { at: 'w:чаты-0.1', click: true },
      { at: 'w:чаты+0.2', shot: 'chats' },
      { at: 'w:нажмите', cursor: 'connect', focus: 'connect' },
      { at: 'w:чат#2', click: true },
      { at: 'w:чат#2+0.3', shot: 'connect-dialog', cursor: 'channel', focus: 'dialog' },
      { at: 'w:канал', focus: 'channel' },
      { at: 'end-0.3', cursor: 'get' },
    ],
  },
  'connect-link': {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'connect-dialog', cursor: 'get', focus: 'get' },
      { at: 'w:код-0.1', click: true },
      { at: 'w:код+0.3', shot: 'connect-link', focus: 'dialog', cursor: 'link' },
      { at: 'w:ссылка', focus: 'link' },
      { at: 'w:группу', focus: 'dialog' },
      { at: 'w:уже', cursor: 'command', focus: 'command' },
    ],
  },
  'connect-max': {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'connect-max-dialog', cursor: 'channel', focus: 'dialog' },
      { at: 'w:вручную-0.2', cursor: 'get', focus: 'get' },
      { at: 'w:команду', click: true },
      { at: 'w:команду+0.3', shot: 'connect-max', focus: 'dialog', cursor: 'command' },
      { at: 'w:окна', focus: 'command' },
    ],
  },
  'chat-importance': {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'chats', cursor: 'rowA', focus: null },
      { at: 0.3, click: true },
      { at: 0.6, shot: 'chat-a', cursor: 'importance' },
      { at: 'w:важность', focus: 'importance' },
      { at: 'w:важные', click: true },
    ],
  },
  'chat-staff': {
    kind: 'ui',
    beats: [
      { at: -0.2, shot: 'chat-a', cursor: 'staff', focus: 'staff' },
      { at: 'w:ниже-0.2', cursor: 'rules', focus: 'rules' },
    ],
  },
  'chat-quiet': {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'chats', cursor: 'quietSelect', focus: 'quiet' },
      { at: 'w:чтобы', cursor: 'archive', focus: null },
      { at: 'w:архив-0.4', click: true },
      { at: 'w:архив-0.1', shot: 'chats-archive', focus: 'table' },
    ],
  },
  'users-create': {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'chats-archive', cursor: 'navUsers', focus: null },
      { at: 'w:пользователи-0.2', click: true },
      { at: 'w:пользователи+0.1', shot: 'users' },
      { at: 'w:введите', cursor: 'name', focus: 'form' },
      { at: 'w:новый', shot: 'users-typed' },
      { at: 'w:нажмите', cursor: 'create' },
      { at: 'w:создать+0.2', click: true },
    ],
  },
  'users-link': {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'user-new', cursor: 'issue', focus: 'issue' },
      { at: 'w:выдать+0.6', click: true },
      { at: 'w:выдать+0.9', shot: 'user-new-link', focus: 'dialog', cursor: 'link' },
      { at: 'w:статус', shot: 'user-new', focus: null, cursor: 'status' },
    ],
  },
  'users-subs': {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'user-maria', cursor: 'test', focus: ['status', 'test'] },
      { at: 'w:тестовое', click: true },
      { at: 'w:ниже', cursor: 'summary', focus: 'summary' },
      { at: 'w:алерты-0.3', cursor: 'severity', focus: 'alerts' },
    ],
  },
  'users-matrix': {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'users-matrix', cursor: 'matrix', focus: null },
      { at: 'w:матрице-0.3', focus: 'matrix' },
    ],
  },
  incidents: {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'incidents', cursor: 'filters', focus: null },
      { at: 'w:фильтрами-0.3', focus: 'filters' },
      { at: 'end-1.6', cursor: 'rowCritical', focus: 'table' },
      { at: 'end-0.6', click: true },
    ],
  },
  incident: {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'incident', cursor: 'messages', focus: ['reasons', 'timeline'] },
      { at: 'w:сообщения-0.2', focus: 'messages' },
      { at: 'w:хронология-0.2', cursor: 'timeline', focus: 'timeline' },
      { at: 'w:смените-0.3', cursor: 'status', focus: ['title', 'status'] },
      { at: 'w:закрыт', click: true },
    ],
  },
  reports: {
    kind: 'ui',
    beats: [
      { at: -0.4, shot: 'summaries', cursor: 'row', focus: 'list' },
      { at: 'w:откройте', click: true },
      { at: 'w:откройте+0.3', shot: 'report', focus: null },
      { at: 'w:таким', shot: 'report-rich', focus: 'dialog' },
    ],
  },
  help: { kind: 'help' },
  outro: { kind: 'outro' },
};
