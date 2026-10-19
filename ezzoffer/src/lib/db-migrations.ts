import type Database from 'better-sqlite3';

/**
 * Колонка «уведомление о состоянии отклика отправлено».
 *
 * Синхронизация с hh идёт по расписанию и видит одно и то же состояние, пока
 * человек не откроет отклик. Без отметки приглашение на собеседование
 * приходило бы в Telegram снова и снова — и перестать открывать бота было бы
 * правильным решением.
 *
 * Отдельная миграция, а не добавление в общий список: ALTER TABLE ADD COLUMN
 * достаточно, но объявлено явно, чтобы поле не потерялось при пересборке
 * таблицы из migrateApplicationsResumeId — там список колонок задан явно.
 */
export function addNotifiedAtColumn(instance: Pick<Database.Database, 'exec' | 'prepare'>): void {
  const row = instance.prepare('PRAGMA table_info(applications)').all() as {
    name: string;
  }[];
  if (row.some((c) => c.name === 'notified_at')) return;
  instance.exec('ALTER TABLE applications ADD COLUMN notified_at INTEGER');
}

/**
 * Колонка происхождения отклика (Фаза 1: правда о происхождении).
 *
 * real — отправлен через API площадки; user — человек зафиксировал вручную
 * (кнопка «На сайте» / «По email»); simulated — демо-симуляция; ai —
 * сгенерировано моделью. Дефолт 'user': забытый INSERT нигде не соврёт про
 * внешнюю отправку. Backfill: строки по hh-вакансиям помечаются 'real',
 * остальные остаются 'user'. Явные значения backfill не трогает, поэтому
 * повторный запуск ничего не меняет.
 *
 * Отдельная миграция, а не правка CREATE TABLE: старые базы уже живут у
 * людей, и им колонка тоже нужна.
 */
export function migrateApplicationsOrigin(
  instance: Pick<Database.Database, 'exec' | 'prepare'>,
): void {
  const cols = instance.prepare('PRAGMA table_info(applications)').all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === 'origin')) {
    instance.exec(
      "ALTER TABLE applications ADD COLUMN origin TEXT NOT NULL DEFAULT 'user' " +
        "CHECK (origin IN ('real','simulated','user','ai'))",
    );
  }
  /*
   * Все нынешние писатели без origin — это реальный код отправки через hh
   * (симуляции в коде нет: sim.ts не существует, планировщик шлёт только
   * через hhProvider.apply). Поэтому строки по hh-вакансиям — 'real'.
   * Условие по origin = 'user' защищает явные значения от перезаписи.
   */
  instance.exec(`
    UPDATE applications SET origin = 'real'
    WHERE origin = 'user' AND job_slug IN (SELECT slug FROM vacancies WHERE source = 'hh')
  `);
}
/**
 * Режим пользователя demo|live (Фаза 1: правда о происхождении).
 *
 * live означает «hh подключён и человек явно согласился на реальные
 * автоотклики». Дефолт demo: никто не становится «живым» молча, миграцией
 * в том числе. Backfill не нужен — безопасное значение и есть дефолт.
 */
export function migrateUserMode(instance: Pick<Database.Database, 'exec' | 'prepare'>): void {
  const cols = instance.prepare('PRAGMA table_info(users)').all() as {
    name: string;
  }[];
  if (cols.some((c) => c.name === 'mode')) return;
  instance.exec(
    "ALTER TABLE users ADD COLUMN mode TEXT NOT NULL DEFAULT 'demo' " +
      "CHECK (mode IN ('demo','live'))",
  );
}

/**
 * Группировка A/B-вариантов одного резюме (Фаза 7).
 *
 * `variant_group` — идентификатор группы вариантов; NULL у обычного резюме,
 * которое никто не вариантировал. `variant_label` — метка внутри группы (A, B,
 * C): она и есть то, что человек видит и что потом сравнивает.
 *
 * Отдельные колонки, а не JSON: по variant_group нужен SELECT с группировкой,
 * а по applications.resume_id — JOIN. JSON здесь означил бы разбор внутри SQLite
 * на каждом сравнении.
 *
 * NULL, а не '' и не 0: «это резюме не вариант» и «группа ещё не назначена» —
 * разные вещи, и пустая строка слила бы их.
 *
 * Отдельная функция, а не правка CREATE TABLE: старые базы у людей живут.
 */
export function migrateResumeVariants(instance: Pick<Database.Database, 'exec' | 'prepare'>): void {
  const cols = instance.prepare('PRAGMA table_info(resumes)').all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === 'variant_group')) {
    instance.exec('ALTER TABLE resumes ADD COLUMN variant_group TEXT');
  }
  if (!cols.some((c) => c.name === 'variant_label')) {
    instance.exec('ALTER TABLE resumes ADD COLUMN variant_label TEXT');
  }
}

/**
 * Оплата: платежи и выданные права.
 *
 * Две таблицы, а не одна, потому что это разные вещи. `payments` — журнал
 * пришедших подтверждений, он пополняется и никогда не переписывается, и по
 * нему работает идемпотентность (одна и та же external_id — один платёж).
 * `entitlements` — что человек имеет прямо сейчас; срок там nullable, потому
 * что постоянный тариф («навсегда, пока в бете») срока не имеет вовсе.
 *
 * Отдельная функция: старые базы у людей живут, а платежей в них не бывало.
 */
export function migratePayments(instance: Pick<Database.Database, 'exec' | 'prepare'>): void {
  const tables = instance.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[];
  const has = (t: string) => tables.some((r) => r.name === t);

  if (!has('payments')) {
    instance.exec(`
      CREATE TABLE payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        external_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        amount_rub INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE (provider, external_id)
      )
    `);
  } else {
    /*
     * Идемпотентность — по паре (провайдер, внешний id), а не по голому id.
     *
     * Первая версия схемы держала UNIQUE(external_id) глобально, а формат
     * paymentId задаёт внешняя сторона: два разных способа оплаты вправе
     * выдать одинаковый номер. Тогда второй легитимный платёж отклонялся как
     * «уже записан», и человек оставался без тарифа за свои деньги.
     *
     * Пересборка с переносом данных: id сохраняются, поэтому
     * entitlements.source_payment_id продолжает указывать куда надо.
     */
    const idx = instance.prepare('PRAGMA index_list(payments)').all() as {
      name: string;
      sql: string | null;
      unique: number;
    }[];
    const scoped = idx.some(
      (i) => i.unique && i.sql && /provider/i.test(i.sql) && /external_id/i.test(i.sql),
    );
    if (!scoped) {
      instance.exec('PRAGMA foreign_keys = OFF');
      instance.exec('BEGIN');
      try {
        instance.exec(`
          CREATE TABLE payments_migrated (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            external_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            plan_id TEXT NOT NULL,
            amount_rub INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            UNIQUE (provider, external_id)
          );
        `);
        instance.exec(`
          INSERT INTO payments_migrated (id, user_id, external_id, provider, plan_id, amount_rub, created_at)
          SELECT id, user_id, external_id, provider, plan_id, amount_rub, created_at FROM payments;
        `);
        instance.exec('DROP TABLE payments');
        instance.exec('ALTER TABLE payments_migrated RENAME TO payments');
        instance.exec('COMMIT');
      } catch (err) {
        try {
          instance.exec('ROLLBACK');
        } catch {
          // Откат не удался — база осталась в исходном состоянии BEGIN'а.
        }
        throw err;
      } finally {
        instance.exec('PRAGMA foreign_keys = ON');
      }
    }
  }

  if (!has('entitlements')) {
    instance.exec(`
      CREATE TABLE entitlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        plan_id TEXT NOT NULL,
        source_payment_id INTEGER REFERENCES payments(id),
        expires_at INTEGER,
        created_at INTEGER NOT NULL
      )
    `);
    instance.exec(
      'CREATE INDEX IF NOT EXISTS ix_entitlements_user ON entitlements(user_id, expires_at)',
    );
  }
}

/**
 * Привязанные внешние аккаунты.
 *
 * UNIQUE (provider, provider_id) — не из паранойи, а из необходимости: без
 * него повторный возврат от провайдера создал бы человеку две привязки, и
 * «отвязать» потом стало бы невозможно понять, какую именно удалять.
 *
 * provider_id, а не email: адрес у человека меняется, идентификатор в
 * системе провайдера — нет. Привязка должна переживать смену почты.
 */
export function migrateOauthAccounts(instance: Pick<Database.Database, 'exec' | 'prepare'>): void {
  const tables = instance.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[];
  if (tables.some((r) => r.name === 'oauth_accounts')) return;
  instance.exec(`
    CREATE TABLE oauth_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (provider, provider_id)
    )
  `);
}

/**
 * Перешифровка токенов hh на диске (Фаза 1, риск бэкапа).
 *
 * До этого access- и refresh-токены лежали открытым текстом, и копия файла
 * базы давала возможность отправлять отклики от чужого имени. Здесь они
 * переводятся в AES-256-GCM ключом из EZOFFER_TOKEN_KEY.
 *
 * ИДЕМПОТЕНТНОСТЬ — главное требование. Миграция идёт только вперёд и должна
 * быть безопасна при повторном запуске, потому что вызывается на каждом
 * старте. Повторно шифровать уже зашифрованное нельзя: это испортило бы
 * значение без возможности восстановления. Поэтому пропускается всё, что уже
 * помечено префиксом версии.
 *
 * БЕЗ КЛЮЧЯ миграция ничего не делает и ничего не портит. Это осознанно:
 * ключ ставится на сервере позже, и требование ключа при локальной разработке
 * или первом запуске сделало бы приложение неработоспособным. Открытые
 * значения при этом остаются открытыми — и это видно через
 * encryptionEnabled().
 *
 * Значения читаются как есть и перешифровываются в одной транзакции: на
 * середине процесса, если процесс умрёт, не будет половины переведённых и
 * половины нет.
 */
export function migrateSecretColumns(instance: Pick<Database.Database, 'exec' | 'prepare'>): void {
  // Ключ нужен ИСКЛЮЧИТЕЛЬНО для миграции, поэтому импортируем здесь: без
  // ключа модуль secrets работает как обычно, просто ничего не шифрует.
  const { encryptSecret, encryptionEnabled } = requireSecrets();
  if (!encryptionEnabled()) return;

  const cols = instance.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  const has = (n: string) => cols.some((c) => c.name === n);
  if (!has('hh_token') && !has('hh_refresh_token')) return;

  const fields = ['hh_token', 'hh_refresh_token'].filter(has);
  const rows = instance.prepare(`SELECT id, ${fields.join(', ')} FROM users`).all() as Record<
    string,
    string | number | null
  >[];

  instance.exec('BEGIN');
  try {
    for (const row of rows) {
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const field of fields) {
        const current = row[field];
        if (typeof current !== 'string' || current === '') continue;
        if (current.startsWith('v1:')) continue; // уже зашифровано
        sets.push(`${field} = ?`);
        values.push(encryptSecret(current));
      }
      if (sets.length === 0) continue;
      values.push(row.id);
      instance.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
    instance.exec('COMMIT');
  } catch (error) {
    instance.exec('ROLLBACK');
    throw new Error(`Не удалось зашифровать токены: ${(error as Error).message}`);
  }
}

/** Ленивый доступ к secrets: избегаем циклической зависимости модулей. */
function requireSecrets(): typeof import('./secrets') {
  return secretsModule ?? (secretsModule = loadSecrets());
}
let secretsModule: typeof import('./secrets') | null = null;
function loadSecrets(): typeof import('./secrets') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./secrets') as typeof import('./secrets');
}

/**
 * Пересборка applications со сменой типа resume_id: INTEGER → TEXT.
 *
 * В колонке лежит идентификатор резюме на hh, то есть строка, — именно она
 * уходит в POST /negotiations. Но колонка была объявлена INTEGER, и SQLite
 * приводил числовой hh-id к числу: «7» превращалась в 7. Дальше сравнение
 * `resumes.hh_id = 7` не находило строку «7» — типы не расходятся, а просто не
 * равны, и поиск резюме к отклику молча возвращал пусто. Подготовка к
 * собеседованию собиралась по случайному резюме, и никто об этом не узнавал.
 *
 * Смена типа требует пересборки таблицы — ALTER COLUMN в SQLite нет. Данные
 * переносятся с CAST, чтобы уже испорченные значения стали текстом и снова
 * находились. Проверка идёт по объявленному типу, поэтому миграция
 * одноразовая, а не на каждом запуске.
 *
 * Отдельный модуль, а не функция в db.ts, по двум причинам. Первая: db.ts при
 * импорте открывает файл базы, и тест, который хочет прогнать миграцию на
 * своей базе, вынужден был бы импортировать побочный эффект — ровно та ошибка,
 * из-за которой один из тестов писал в рабочую базу. Вторая: пересоздание
 * таблицы с копированием всех откликов пользователей должно проверяться
 * отдельно от всего остального.
 */
export function migrateApplicationsResumeId(
  instance: Pick<Database.Database, 'exec' | 'prepare'>,
): void {
  const row = instance.prepare('PRAGMA table_info(applications)').all() as {
    name: string;
    type: string;
  }[];
  const resumeCol = row.find((c) => c.name === 'resume_id');
  // Уже TEXT — миграция уже проходила (или база создана с нуля).
  if (!resumeCol || resumeCol.type.toUpperCase() !== 'INTEGER') return;
  /*
   * origin переживает пересборку. Источник может её не иметь (старая база,
   * прямой вызов без migrateApplicationsOrigin) — тогда строки получают
   * безопасный дефолт 'user', а backfill по источнику доберёт 'real' позже.
   */
  const hasOrigin = row.some((c) => c.name === 'origin');
  const originSelect = hasOrigin ? 'origin' : "'user'";

  instance.exec('PRAGMA foreign_keys = OFF');
  instance.exec('BEGIN');
  try {
    instance.exec(`
      CREATE TABLE applications_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        job_slug TEXT NOT NULL,
        search_id INTEGER,
        resume_id TEXT,
        letter_id INTEGER,
        status TEXT NOT NULL DEFAULT 'sent',
        origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('real','simulated','user','ai')),
        response TEXT NOT NULL DEFAULT '',
        response_note TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        external_url TEXT,
        sent_at INTEGER NOT NULL,
        viewed_at INTEGER,
        responded_at INTEGER,
        withdrawn INTEGER NOT NULL DEFAULT 0,
        notified_at INTEGER
      );
    `);
    /*
     * CAST выражен явно, хотя аффинность TEXT дала бы тот же результат.
     * Смысл в читаемости: видно, что тип меняется намеренно, а не «случайно».
     *
     * Чего CAST не делает — не восстанавливает потерянное. Если hh-id выглядел
     * как «007», INTEGER-аффинность превратила его в 7, и информация о нулях
     * исчезла безвозвратно. Такие значения придётся привязать заново
     * импортом из hh; автоматически их не восстановить.
     */
    instance.exec(`
      INSERT INTO applications_migrated
        (id, user_id, job_slug, search_id, resume_id, letter_id, status, origin, response,
         response_note, message, external_url, sent_at, viewed_at, responded_at, withdrawn, notified_at)
      SELECT
        id, user_id, job_slug, search_id, CAST(resume_id AS TEXT), letter_id, status, ${originSelect}, response,
        response_note, message, external_url, sent_at, viewed_at, responded_at, withdrawn, notified_at
      FROM applications;
    `);
    instance.exec('DROP TABLE applications');
    instance.exec('ALTER TABLE applications_migrated RENAME TO applications');
    /*
     * AUTOINCREMENT и перенос id.
     *
     * `sqlite_sequence` при пересборке сохраняется: SQLite пересчитывает его по
     * максимальному перенесённому id. Новые отклики продолжают нумерацию, а не
     * начинают с единицы и не падают на занятом первичном ключе.
     */
    /*
     * Индексы не переживают пересоздание таблицы. Без них выборка откликов
     * пользователя сканирует таблицу целиком — на реальных объёмах кабинет
     * открывается заметно медленнее, и ни одна ошибка не возникает.
     */
    instance.exec('CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id)');
    instance.exec('CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_slug)');
    instance.exec(
      'CREATE INDEX IF NOT EXISTS idx_applications_user_sent ON applications(user_id, sent_at)',
    );
    instance.exec(
      'CREATE INDEX IF NOT EXISTS idx_applications_user_job ON applications(user_id, job_slug)',
    );
    instance.exec('COMMIT');
  } catch (err) {
    instance.exec('ROLLBACK');
    throw err;
  } finally {
    instance.exec('PRAGMA foreign_keys = ON');
  }
}
