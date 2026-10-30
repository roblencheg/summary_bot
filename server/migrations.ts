import type { Platform } from './platform';
import { createHash } from 'node:crypto';

/**
 * Схема managed-БД. Вызывается один раз при старте сервера.
 *
 * Правила:
 * - Каждая таблица — через CREATE TABLE IF NOT EXISTS (idempotent).
 * - Изменения колонок — ALTER TABLE ... ADD COLUMN только после проверки
 *   SELECT name FROM pragma_table_info('<table>'); IF NOT EXISTS для колонок SQLite не поддерживает.
 * - Транзакции (BEGIN/COMMIT) заблокированы managed-DB — здесь не используем.
 * - Время — TEXT ISO-8601 UTC с `Z`.
 */
export async function applySchema(platform: Platform): Promise<void> {
  if (!platform.configured) return;
  // schema-guard: на managed-БД каждый exec = сетевой round-trip. Если эта версия
  // схемы уже накачена — пропускаем весь DDL ниже (иначе под `tsx watch` это цена
  // КАЖДОЙ правки). Хэш считается от исходника функции: добавишь/изменишь DDL ниже —
  // хэш сменится и схема накатится заново.
  const schemaHash = createHash('sha256').update(applySchema.toString()).digest('hex').slice(0, 32);
  await platform.db.exec(`CREATE TABLE IF NOT EXISTS _schema_done (hash TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  if (await platform.db.first(`SELECT hash FROM _schema_done WHERE hash = ?`, [schemaHash])) return;

  // AICODE-NOTE: DDL перечислен внутри функции (а не константой снаружи), иначе
  // schema-guard не увидит изменений. Слова RELEASE/ATTACH/DETACH в SQL запрещены прокси.
  const ddl: string[] = [
    // --- доступ и конфигурация ---
    `CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS login_attempts (
      login TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      old_value TEXT,
      new_value TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at)`,

    // --- сбор ---
    `CREATE TABLE IF NOT EXISTS telegram_updates (
      update_id INTEGER PRIMARY KEY,
      received_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT,
      lease_until TEXT,
      error TEXT,
      processed_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_updates_status ON telegram_updates(status, update_id)`,
    `CREATE TABLE IF NOT EXISTS max_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker INTEGER,
      received_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT,
      lease_until TEXT,
      error TEXT,
      processed_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_max_updates_status ON max_updates(status, id)`,
    `CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      username TEXT,
      is_forum INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      collection_started_at TEXT,
      last_message_at TEXT,
      last_event_at TEXT,
      bot_member_status TEXT,
      bot_is_admin INTEGER,
      bot_reads_all INTEGER,
      rights_checked_at TEXT,
      rights_error TEXT,
      migrated_to INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS chat_rules (
      chat_id INTEGER PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS chat_staff (
      chat_id INTEGER NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      label TEXT,
      PRIMARY KEY (chat_id, telegram_user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS participants (
      author_key TEXT PRIMARY KEY,
      telegram_user_id INTEGER,
      sender_chat_id INTEGER,
      display_name TEXT NOT NULL,
      username TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      author_key TEXT,
      author_id INTEGER,
      author_name TEXT NOT NULL,
      author_username TEXT,
      sender_chat_id INTEGER,
      identity_limited INTEGER NOT NULL DEFAULT 0,
      is_staff INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL,
      has_text INTEGER NOT NULL DEFAULT 1,
      reply_to_message_id INTEGER,
      thread_id INTEGER,
      edited_at TEXT,
      revision_count INTEGER NOT NULL DEFAULT 0,
      link TEXT,
      analysis_status TEXT NOT NULL DEFAULT 'pending',
      analysis_attempts INTEGER NOT NULL DEFAULT 0,
      lease_token TEXT,
      lease_until TEXT,
      analysis_error TEXT,
      analyzed_at TEXT,
      analysis_id INTEGER,
      is_request INTEGER,
      request_key TEXT,
      topic TEXT,
      tone TEXT,
      categories TEXT,
      severity TEXT,
      confidence REAL,
      summary TEXT,
      resolution_confirmed INTEGER NOT NULL DEFAULT 0,
      answers_message_ids TEXT,
      UNIQUE (chat_id, message_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_chat_sent ON messages(chat_id, sent_at)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_analysis ON messages(analysis_status, received_at)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_request ON messages(chat_id, request_key)`,
    `CREATE TABLE IF NOT EXISTS message_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_pk INTEGER NOT NULL,
      edited_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      old_text TEXT NOT NULL,
      new_text TEXT NOT NULL,
      significant INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_revisions_message ON message_revisions(message_pk)`,
    `CREATE TABLE IF NOT EXISTS collection_gaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      reason TEXT NOT NULL,
      details TEXT,
      recovered INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_gaps_range ON collection_gaps(started_at, ended_at)`,

    // --- получатели и подписки ---
    `CREATE TABLE IF NOT EXISTS recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      telegram_user_id INTEGER UNIQUE,
      telegram_username TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      is_tech_admin INTEGER NOT NULL DEFAULT 0,
      summary_day INTEGER NOT NULL DEFAULT 1,
      summary_night INTEGER NOT NULL DEFAULT 1,
      alert_categories TEXT NOT NULL,
      alert_min_severity TEXT NOT NULL DEFAULT 'attention',
      activated_at TEXT,
      blocked_at TEXT,
      last_delivery_at TEXT,
      last_delivery_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS binding_codes (
      code_hash TEXT PRIMARY KEY,
      recipient_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS summary_subscriptions (
      recipient_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      PRIMARY KEY (recipient_id, chat_id)
    )`,
    `CREATE TABLE IF NOT EXISTS alert_subscriptions (
      recipient_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      PRIMARY KEY (recipient_id, chat_id)
    )`,

    // --- анализ и инциденты ---
    `CREATE TABLE IF NOT EXISTS analysis_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_pk INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      batch_id TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      analyzed_at TEXT NOT NULL,
      result TEXT NOT NULL,
      flags TEXT,
      UNIQUE (message_pk, batch_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_analysis_message ON analysis_results(message_pk)`,
    `CREATE TABLE IF NOT EXISTS ai_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purpose TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      started_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      ok INTEGER NOT NULL,
      error TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ai_calls_started ON ai_calls(started_at)`,
    `CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'problem',
      status TEXT NOT NULL DEFAULT 'new',
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      topic TEXT,
      categories TEXT NOT NULL,
      severity TEXT NOT NULL,
      severity_reason TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      entities TEXT NOT NULL DEFAULT '[]',
      author_key TEXT,
      author_name TEXT,
      affected_authors INTEGER NOT NULL DEFAULT 1,
      message_count INTEGER NOT NULL DEFAULT 1,
      repeat_type TEXT NOT NULL DEFAULT 'single',
      first_message_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      borderline INTEGER NOT NULL DEFAULT 0,
      resolution_confirmed INTEGER NOT NULL DEFAULT 0,
      related_incident_id INTEGER,
      analysis_version TEXT,
      spike_data TEXT,
      sources_deleted INTEGER NOT NULL DEFAULT 0,
      last_alert_at TEXT,
      last_alert_severity TEXT,
      last_alert_categories TEXT,
      last_alert_authors INTEGER,
      last_alert_message_count INTEGER,
      pending_update INTEGER NOT NULL DEFAULT 0,
      status_changed_by TEXT,
      status_changed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_incidents_chat ON incidents(chat_id, status, last_message_at)`,
    `CREATE INDEX IF NOT EXISTS idx_incidents_pending ON incidents(pending_update)`,
    `CREATE TABLE IF NOT EXISTS incident_messages (
      incident_id INTEGER NOT NULL,
      message_pk INTEGER NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (incident_id, message_pk)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_incident_messages_msg ON incident_messages(message_pk)`,
    `CREATE TABLE IF NOT EXISTS incident_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      details TEXT,
      actor TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_incident_events ON incident_events(incident_id, at)`,
    `CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      analysis_version TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (incident_id, recipient_id)
    )`,

    // --- отчёты и доставка ---
    `CREATE TABLE IF NOT EXISTS report_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_type TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'collecting',
      lease_token TEXT,
      lease_until TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (period_type, starts_at)
    )`,
    `CREATE TABLE IF NOT EXISTS chat_period_digests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      period_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      stats TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (chat_id, period_id, version)
    )`,
    `CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id INTEGER NOT NULL,
      period_id INTEGER NOT NULL,
      period_type TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      manual INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      chat_ids TEXT,
      parts TEXT,
      full_text TEXT,
      delayed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      built_at TEXT,
      sent_at TEXT,
      UNIQUE (recipient_id, period_type, starts_at, ends_at, version)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_reports_period ON reports(period_id)`,
    `CREATE TABLE IF NOT EXISTS delivery_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedup_key TEXT NOT NULL UNIQUE,
      recipient_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      incident_id INTEGER,
      report_id INTEGER,
      chat_id INTEGER,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      status_reason TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      parts_sent INTEGER NOT NULL DEFAULT 0,
      uncertain INTEGER NOT NULL DEFAULT 0,
      manual_retry INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      lease_token TEXT,
      lease_until TEXT,
      last_error TEXT,
      trigger_at TEXT,
      source_sent_at TEXT,
      source_received_at TEXT,
      analyzed_at TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_delivery_queue ON delivery_jobs(status, next_attempt_at)`,
    `CREATE INDEX IF NOT EXISTS idx_delivery_recipient ON delivery_jobs(recipient_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS delivery_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      at TEXT NOT NULL,
      part INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      uncertain INTEGER NOT NULL DEFAULT 0,
      http_status INTEGER,
      error_code TEXT,
      error TEXT,
      telegram_message_id INTEGER,
      duration_ms INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_attempts_job ON delivery_attempts(job_id)`,
    `CREATE TABLE IF NOT EXISTS tech_alert_state (
      kind TEXT PRIMARY KEY,
      active INTEGER NOT NULL DEFAULT 0,
      last_sent_at TEXT,
      details TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS on_demand_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id INTEGER NOT NULL,
      requested_at TEXT NOT NULL,
      status TEXT NOT NULL,
      chat_ids TEXT,
      from_at TEXT,
      to_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_on_demand_recipient ON on_demand_requests(recipient_id, requested_at)`,
    // --- дирекции и роли ---
    `CREATE TABLE IF NOT EXISTS directorates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS admin_directorates (
      admin_id INTEGER NOT NULL,
      directorate_id INTEGER NOT NULL,
      PRIMARY KEY (admin_id, directorate_id)
    )`,
    `CREATE TABLE IF NOT EXISTS chat_directorates (
      chat_id INTEGER NOT NULL,
      directorate_id INTEGER NOT NULL,
      access TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, directorate_id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_directorates_owner ON chat_directorates(chat_id) WHERE access = 'owner'`,
    `CREATE INDEX IF NOT EXISTS idx_chat_directorates_dir ON chat_directorates(directorate_id)`,
    `CREATE TABLE IF NOT EXISTS recipient_directorates (
      recipient_id INTEGER NOT NULL,
      directorate_id INTEGER NOT NULL,
      PRIMARY KEY (recipient_id, directorate_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_recipient_directorates_dir ON recipient_directorates(directorate_id)`,
    `CREATE TABLE IF NOT EXISTS chat_claim_codes (
      code_hash TEXT PRIMARY KEY,
      directorate_id INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      chat_id INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS _data_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  ];
  for (const sql of ddl) await platform.db.exec(sql);

  const recipientCols = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('recipients')");
  if (!recipientCols.some((c) => c.name === 'menu_message_id')) {
    await platform.db.exec('ALTER TABLE recipients ADD COLUMN menu_message_id INTEGER');
  }

  const adminCols = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('admins')");
  if (!adminCols.some((c) => c.name === 'role')) {
    // все существующие учётки — суперадмины (DEFAULT), новые руководители создаются с role = 'manager'
    await platform.db.exec("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'superadmin'");
  }

  const cdCols = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('chat_directorates')");
  if (!cdCols.some((c) => c.name === 'importance')) {
    // важность чата в саммари — у каждой дирекции своя: high | normal | low
    await platform.db.exec("ALTER TABLE chat_directorates ADD COLUMN importance TEXT NOT NULL DEFAULT 'normal'");
  }
  const dirCols = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('directorates')");
  if (!dirCols.some((c) => c.name === 'quiet_chats')) {
    // чаты без событий в саммари: full | line | hide
    await platform.db.exec("ALTER TABLE directorates ADD COLUMN quiet_chats TEXT NOT NULL DEFAULT 'line'");
  }

  const reportCols = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('reports')");
  if (!reportCols.some((c) => c.name === 'rich_html')) {
    // саммари в формате rich message (как ушло в Telegram) — для предпросмотра в веб-интерфейсе
    await platform.db.exec('ALTER TABLE reports ADD COLUMN rich_html TEXT');
  }
  // AICODE-NOTE: канал MAX у отчёта — НЕ вторая строка в reports (UNIQUE по (recipient_id,
  // period_type, starts_at, ends_at, version) не ослабить без пересборки таблицы — ALTER TABLE
  // ADD COLUMN этого не умеет, а пересобирать таблицу без транзакций managed-БД рискованно).
  // Вместо этого MAX-артефакт отчёта хранится параллельным набором колонок на той же строке
  // (тот же приём, что у recipients.max_* ниже).
  if (!reportCols.some((c) => c.name === 'max_status')) {
    await platform.db.exec("ALTER TABLE reports ADD COLUMN max_status TEXT NOT NULL DEFAULT 'pending'");
  }
  if (!reportCols.some((c) => c.name === 'max_chat_ids')) {
    await platform.db.exec('ALTER TABLE reports ADD COLUMN max_chat_ids TEXT');
  }
  if (!reportCols.some((c) => c.name === 'max_parts')) {
    await platform.db.exec('ALTER TABLE reports ADD COLUMN max_parts TEXT');
  }
  if (!reportCols.some((c) => c.name === 'max_full_text')) {
    await platform.db.exec('ALTER TABLE reports ADD COLUMN max_full_text TEXT');
  }
  if (!reportCols.some((c) => c.name === 'max_built_at')) {
    await platform.db.exec('ALTER TABLE reports ADD COLUMN max_built_at TEXT');
  }
  if (!reportCols.some((c) => c.name === 'max_sent_at')) {
    await platform.db.exec('ALTER TABLE reports ADD COLUMN max_sent_at TEXT');
  }

  // --- MAX: чат, получатель, коды привязки/подключения, доставка ---
  const chatCols = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('chats')");
  if (!chatCols.some((c) => c.name === 'channel')) {
    // AICODE-NOTE: chats.id — это внешний chat_id мессенджера (не surrogate-ключ), общий для
    // Telegram и MAX. Коллизий не ожидаем: у Telegram id групп всегда отрицательный
    // (supergroup — префикс -100…), у MAX — положительный; если это предположение не
    // подтвердится на реальных данных MAX, нужен будет surrogate-ключ — это затронет ссылки
    // chat_id почти во всех таблицах, так что сначала проверять здесь.
    await platform.db.exec("ALTER TABLE chats ADD COLUMN channel TEXT NOT NULL DEFAULT 'telegram'");
  }

  const recipientCols2 = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('recipients')");
  if (!recipientCols2.some((c) => c.name === 'max_user_id')) {
    // ALTER TABLE ADD COLUMN не умеет UNIQUE — уникальность max_user_id отдельным индексом ниже.
    await platform.db.exec('ALTER TABLE recipients ADD COLUMN max_user_id INTEGER');
    await platform.db.exec('ALTER TABLE recipients ADD COLUMN max_username TEXT');
    await platform.db.exec("ALTER TABLE recipients ADD COLUMN max_status TEXT NOT NULL DEFAULT 'pending'");
    await platform.db.exec('ALTER TABLE recipients ADD COLUMN max_activated_at TEXT');
    await platform.db.exec('ALTER TABLE recipients ADD COLUMN max_blocked_at TEXT');
    await platform.db.exec('ALTER TABLE recipients ADD COLUMN max_menu_message_id INTEGER');
  }
  await platform.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_recipients_max_user_id ON recipients(max_user_id)');

  const bindingCodeCols = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('binding_codes')");
  if (!bindingCodeCols.some((c) => c.name === 'channel')) {
    await platform.db.exec("ALTER TABLE binding_codes ADD COLUMN channel TEXT NOT NULL DEFAULT 'telegram'");
  }

  const claimCodeCols = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('chat_claim_codes')");
  if (!claimCodeCols.some((c) => c.name === 'channel')) {
    await platform.db.exec("ALTER TABLE chat_claim_codes ADD COLUMN channel TEXT NOT NULL DEFAULT 'telegram'");
  }

  const jobCols = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('delivery_jobs')");
  if (!jobCols.some((c) => c.name === 'channel')) {
    await platform.db.exec("ALTER TABLE delivery_jobs ADD COLUMN channel TEXT NOT NULL DEFAULT 'telegram'");
  }

  // AICODE-NOTE: delivery_attempts без своей колонки channel — канал задания не меняется между
  // попытками, достаточно delivery_jobs.channel. telegram_message_id хранит message id
  // присланного ботом сообщения в ЛЮБОМ канале (имя колонки осталось как есть — переименование
  // потребовало бы пересборки таблицы без транзакций).
  const onDemandCols = await platform.db.query<{ name: string }>("SELECT name FROM pragma_table_info('on_demand_requests')");
  if (!onDemandCols.some((c) => c.name === 'channel')) {
    await platform.db.exec("ALTER TABLE on_demand_requests ADD COLUMN channel TEXT NOT NULL DEFAULT 'telegram'");
  }

  // AICODE-NOTE: одноразовый перенос текущих чатов и получателей в «Основное подразделение».
  // Шаги идемпотентны (ON CONFLICT DO NOTHING), маркер пишется последним: при падении посередине
  // повторный запуск доделает перенос. После маркера новые чаты без кода остаются неразобранными.
  if (!(await platform.db.first("SELECT id FROM _data_migrations WHERE id = 'directorates_v1'"))) {
    const existing = await platform.db.first<{ n: number }>('SELECT (SELECT COUNT(*) FROM chats) + (SELECT COUNT(*) FROM recipients) AS n');
    if (existing && existing.n > 0) {
      const now = new Date().toISOString();
      await platform.db.exec('INSERT INTO directorates (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING', ['Основное подразделение', now]);
      const dir = await platform.db.first<{ id: number }>('SELECT id FROM directorates WHERE name = ?', ['Основное подразделение']);
      if (!dir) throw new Error('directorates_v1: дирекция не создана');
      await platform.db.exec(
        `INSERT INTO chat_directorates (chat_id, directorate_id, access, created_at)
         SELECT id, ?, 'owner', ? FROM chats WHERE id NOT IN (SELECT chat_id FROM chat_directorates WHERE access = 'owner')
         ON CONFLICT DO NOTHING`,
        [dir.id, now],
      );
      await platform.db.exec('INSERT INTO recipient_directorates (recipient_id, directorate_id) SELECT id, ? FROM recipients WHERE 1 ON CONFLICT DO NOTHING', [dir.id]);
    }
    const now = new Date().toISOString();
    await platform.db.exec("INSERT INTO _data_migrations (id, applied_at) VALUES ('directorates_v1', ?) ON CONFLICT DO NOTHING", [now]);
  }

  // схема накачена — фиксируем версию (после успешного DDL)
  await platform.db.exec(`INSERT INTO _schema_done (hash) VALUES (?)`, [schemaHash]);
}
