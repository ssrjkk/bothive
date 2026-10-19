import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { logInfo } from './logger';
import {
  migrateApplicationsResumeId,
  addNotifiedAtColumn,
  migrateApplicationsOrigin,
  migrateUserMode,
  migrateResumeVariants,
  migratePayments,
  migrateOauthAccounts,
  migrateSecretColumns,
} from './db-migrations';
import { envStr } from './env';

/**
 * ╨Я╤Г╤В╤М ╨║ ╤Д╨░╨╣╨╗╤Г ╨С╨Ф.
 *
 * ╨Ъ╨╛╨╝╨┐╨╛╨╜╨╡╨╜╤В╤Л ╤Б╨╛╨▒╨╕╤А╨░╤О╤В╤Б╤П ╨▓ ╤А╨░╨╜╤В╨░╨╣╨╝╨╡ ╨╜╨░╨╝╨╡╤А╨╡╨╜╨╜╨╛, ╨┐╨╛ ╤З╨░╤Б╤В╤П╨╝: Turbopack
 * ╤Б╤В╨░╤В╨╕╤З╨╡╤Б╨║╨╕ ╨░╨╜╨░╨╗╨╕╨╖╨╕╤А╤Г╨╡╤В path.join(cwd, "data", "ezoffer.db") ╨╕ ╨▓╨║╨╗╤О╤З╨░╨╗
 * ╨╗╨╛╨║╨░╨╗╤М╨╜╤Г╤О ezoffer.db (╤Е╤Н╤И╨╕ ╨┐╨░╤А╨╛╨╗╨╡╨╣, OAuth-╤В╨╛╨║╨╡╨╜╤Л) ╨▓ .next/standalone ╨╕
 * Docker-╨╛╨▒╤А╨░╨╖. ╨Ф╨╕╨╜╨░╨╝╨╕╤З╨╡╤Б╨║╨░╤П ╤Б╨▒╨╛╤А╨║╨░ ╨┤╨╡╨╗╨░╨╡╤В ╨┐╤Г╤В╤М ╨╜╨╡╨┐╤А╨╛╨╖╤А╨░╤З╨╜╤Л╨╝ ╨┤╨╗╤П ╨░╨╜╨░╨╗╨╕╨╖╨░╤В╨╛╤А╨░,
 * ╨┐╨╛╤Н╤В╨╛╨╝╤Г tracing ╨╜╨╡ ╨╝╨╛╨╢╨╡╤В ╨▓╤Л╨▓╨╡╤Б╤В╨╕ ╤Б╤В╨░╤В╨╕╤З╨╡╤Б╨║╨╕╨╣ ╨┐╤Г╤В╤М ╨║ ╨┤╨░╨╜╨╜╤Л╨╝.
 *
 * ╨Я╤Г╤Б╤В╨░╤П ╤Б╤В╤А╨╛╨║╨░ ╨▓ env (╤З╨░╤Б╤В╨░╤П ╨┐╨╛╤Б╨╗╨╡ ╨║╨╛╨┐╨╕╤А╨╛╨▓╨░╨╜╨╕╤П .env.example, ╨│╨┤╨╡ ╨┐╨╡╤А╨╡╨╝╨╡╨╜╨╜╨░╤П
 * ╨╛╨▒╤К╤П╨▓╨╗╨╡╨╜╨░ ╨┐╤Г╤Б╤В╨╛╨╣) ╨╜╨╡ ╨┤╨╛╨╗╨╢╨╜╨░ ╨┐╤А╨╡╨▓╤А╨░╤Й╨░╤В╤М╤Б╤П ╨▓ ╨┐╤Г╤В╤М "" тАФ better-sqlite3 ╨╛╤В╨║╤А╤Л╨╗ ╨▒╤Л
 * ╨▓╤А╨╡╨╝╨╡╨╜╨╜╤Г╤О ╨С╨Ф ╨▓ ╨┐╨░╨╝╤П╤В╨╕, ╨╕ ╨▓╤Б╨╡ ╨┤╨░╨╜╨╜╤Л╨╡ ╨┐╤А╨╛╨┐╨░╨╗╨╕ ╨▒╤Л ╨┐╤А╨╕ ╤А╨╡╤Б╤В╨░╤А╤В╨╡.
 */
export function resolveDbPath(
  env: Record<string, string | undefined>,
  cwd: string = process.cwd(),
): string {
  const configured = envStr(env, 'EZOFFER_DB_PATH', '');
  if (configured) return configured;
  const parts = ['data', 'ezoffer.db'];
  return path.join(cwd, ...parts);
}

const DB_PATH = resolveDbPath(process.env);

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  plan TEXT NOT NULL DEFAULT 'none',
  plan_period INTEGER,
  plan_activated_at INTEGER,
  plan_expires_at INTEGER,
  trial_started_at INTEGER,
  hh_token TEXT,
  hh_token_expires_at INTEGER,
  hh_refresh_token TEXT,
  hh_resume_id TEXT,
  telegram_chat_id TEXT,
  autoapply_paused INTEGER NOT NULL DEFAULT 0,
  autoapply_blocked_until INTEGER NOT NULL DEFAULT 0,
  autoapply_block_reason TEXT NOT NULL DEFAULT '',
  email_verified INTEGER NOT NULL DEFAULT 0,
  email_verification_token TEXT,
  email_verification_expires INTEGER,
  password_reset_token TEXT,
  password_reset_expires INTEGER,
  mode TEXT NOT NULL DEFAULT 'demo' CHECK (mode IN ('demo','live'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

-- ╨г╨▒╨╛╤А╨║╨░ ╨┐╤А╨╛╤Б╤А╨╛╤З╨╡╨╜╨╜╤Л╤Е ╤Б╨╡╤Б╤Б╨╕╨╣ ╨╕╨┤╤С╤В ╨┐╨╛ expires_at, ╨░ ╨┐╨╛╨╕╤Б╨║ ╨░╨║╤В╨╕╨▓╨╜╨╛╨╣ ╤Б╨╡╤Б╤Б╨╕╨╕ тАФ ╨┐╨╛
-- token (PK). ╨С╨╡╨╖ ╤Н╤В╨╕╤Е ╨╕╨╜╨┤╨╡╨║╤Б╨╛╨▓ purgeExpiredAuthRows ╤Б╨║╨░╨╜╨╕╤А╨╛╨▓╨░╨╗ ╨▓╤Б╤О ╤В╨░╨▒╨╗╨╕╤Ж╤Г.
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON oauth_states(user_id);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_codes (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS resumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  years_label TEXT NOT NULL DEFAULT '',
  ai_improved INTEGER NOT NULL DEFAULT 0,
  hh_id TEXT,
  -- Группа A/B-вариантов; NULL — обычное резюме (migrateResumeVariants).
  variant_group TEXT,
  variant_label TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  salary_min INTEGER,
  salary_max INTEGER,
  format TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  company_blacklist TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  job_slug TEXT NOT NULL,
  search_id INTEGER,
  resume_id INTEGER,
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

-- События воронки (Фаза 3 пользуется этой таблицей как журналом только для
-- добавления; писателей пока нет — таблица создаётся заранее, чтобы не
-- пересобирать её ради колонки origin позже).
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('real','simulated','user')),
  entity_type TEXT,
  entity_id INTEGER,
  payload TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  job_slug TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_slug);
CREATE INDEX IF NOT EXISTS idx_resumes_user ON resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_searches_user ON searches(user_id);
CREATE TABLE IF NOT EXISTS consultations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  theme TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  booked_at INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vacancies (
  slug TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  salary TEXT NOT NULL,
  salary_min INTEGER,
  salary_max INTEGER,
  level TEXT NOT NULL,
  format TEXT NOT NULL,
  city TEXT NOT NULL,
  posted TEXT NOT NULL,
  category TEXT NOT NULL,
  about TEXT NOT NULL,
  responsibilities TEXT NOT NULL DEFAULT '[]',
  requirements TEXT NOT NULL DEFAULT '[]',
  bonus TEXT NOT NULL DEFAULT '[]',
  source_url TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  published_at INTEGER,
  /**
   * Занятость как её отдала площадка.
   *
   * Хранится дословно («Временная работа», «Неполный рабочий день», «part-time»):
   * переводить её в «подработка» при загрузке нельзя — решение принимается при
   * показе, и перевод должен быть виден и проверяем.
   */
  employment TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vacancies_source ON vacancies(source);

-- ╨Ф╨╛╨┐╨╛╨╗╨╜╨╕╤В╨╡╨╗╤М╨╜╤Л╨╡ ╨╕╨╜╨┤╨╡╨║╤Б╤Л ╨┤╨╗╤П ╨▓╤Л╨▒╨╛╤А╨╛╨║, ╨║╨╛╤В╨╛╤А╤Л╨╡ ╨╕╨┤╤Г╤В ╨┐╨╛ ╤Б╨╛╤Б╤В╨░╨▓╨╜╨╛╨╝╤Г ╨║╨╗╤О╤З╤Г.
-- ╨С╨╡╨╖ ╨╜╨╕╤Е purgeExpiredAuthRows ╨╕ todayCount ╤Б╨║╨░╨╜╨╕╤А╨╛╨▓╨░╨╗╨╕ ╤В╨░╨▒╨╗╨╕╤Ж╤Г ╤Ж╨╡╨╗╨╕╨║╨╛╨╝.
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_telegram_codes_expires ON telegram_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_telegram_codes_user ON telegram_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_user_sent ON applications(user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_applications_user_job ON applications(user_id, job_slug);
CREATE INDEX IF NOT EXISTS idx_letters_user ON letters(user_id);
`;

export function createDatabase(filePath: string): Database.Database {
  if (filePath !== ':memory:') mkdirSync(path.dirname(filePath), { recursive: true });
  const instance = new Database(filePath, { timeout: 10_000 });
  if (filePath !== ':memory:') {
    try {
      instance.pragma('journal_mode = WAL');
    } catch (err) {
      logInfo(
        'db',
        'WAL ╨╜╨╡╨┤╨╛╤Б╤В╤Г╨┐╨╡╨╜, ╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╨╝ ╨┤╨╡╤Д╨╛╨╗╤В╨╜╤Л╨╣ ╤А╨╡╨╢╨╕╨╝ ╨╢╤Г╤А╨╜╨░╨╗╨░',
        { error: String(err) },
      );
    }
  }
  instance.pragma('foreign_keys = ON');
  instance.exec(SCHEMA_SQL);
  migrate(instance);
  logInfo(
    'db',
    filePath === ':memory:' ? '╨╛╤В╨║╤А╤Л╤В╨░ in-memory ╨С╨Ф' : `╨╛╤В╨║╤А╤Л╤В╨░ ╨С╨Ф: ${filePath}`,
  );
  return instance;
}

function columnNames(instance: Database.Database, table: string): Set<string> {
  const rows = instance.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/** ╨Ш╨┤╨╡╨╝╨┐╨╛╤В╨╡╨╜╤В╨╜╤Л╨╡ ╨╝╨╕╨│╤А╨░╤Ж╨╕╨╕ ╨┤╨╗╤П ╤Б╤Г╤Й╨╡╤Б╤В╨▓╤Г╤О╤Й╨╕╤Е ╨С╨Ф (CREATE TABLE IF NOT EXISTS ╨╜╨╡ ╨┤╨╛╨▒╨░╨▓╨╗╤П╨╡╤В ╨║╨╛╨╗╨╛╨╜╨║╨╕). */
function migrate(instance: Database.Database): void {
  const userCols = columnNames(instance, 'users');
  const additions: [string, string][] = [];
  if (!userCols.has('hh_token')) additions.push(['hh_token', 'TEXT']);
  if (!userCols.has('hh_token_expires_at')) additions.push(['hh_token_expires_at', 'INTEGER']);
  if (!userCols.has('hh_refresh_token')) additions.push(['hh_refresh_token', 'TEXT']);
  if (!userCols.has('hh_resume_id')) additions.push(['hh_resume_id', 'TEXT']);
  if (!userCols.has('telegram_chat_id')) additions.push(['telegram_chat_id', 'TEXT']);
  if (!userCols.has('autoapply_paused'))
    additions.push(['autoapply_paused', 'INTEGER NOT NULL DEFAULT 0']);
  // Блокировка аккаунта площадкой: переживает перезапуск, иначе сервис
  // снова пошёл бы откликаться в аккаунт, который hh только что отклонил.
  if (!userCols.has('autoapply_blocked_until'))
    additions.push(['autoapply_blocked_until', 'INTEGER NOT NULL DEFAULT 0']);
  if (!userCols.has('autoapply_block_reason'))
    additions.push(['autoapply_block_reason', "TEXT NOT NULL DEFAULT ''"]);
  if (!userCols.has('email_verified'))
    additions.push(['email_verified', 'INTEGER NOT NULL DEFAULT 0']);
  if (!userCols.has('email_verification_token'))
    additions.push(['email_verification_token', 'TEXT']);
  // Срок жизни ссылки подтверждения: без него токен вечен, и письмо годичной
  // давности подтверждает ящик, который за это время мог сменить владельца.
  if (!userCols.has('email_verification_expires'))
    additions.push(['email_verification_expires', 'INTEGER']);
  if (!userCols.has('password_reset_token')) additions.push(['password_reset_token', 'TEXT']);
  if (!userCols.has('password_reset_expires'))
    additions.push(['password_reset_expires', 'INTEGER']);
  /*
   * Ожидания по зарплате и городу.
   *
   * NULL и 0 — разные вещи, и различие здесь существенное: «хочу от 0» не
   * значит ничего, а «хочу от 150000» отсекает вакансии дешевле. Поэтому
   * пустое значение хранится как NULL, и подбор не применяет фильтр.
   */
  if (!userCols.has('salary_expectation')) additions.push(['salary_expectation', 'INTEGER']);
  if (!userCols.has('city_preference'))
    additions.push(['city_preference', "TEXT NOT NULL DEFAULT ''"]);
  for (const [name, type] of additions) {
    instance.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  }
  migrateUserMode(instance);
  migrateResumeVariants(instance);
  migratePayments(instance);
  migrateOauthAccounts(instance);
  migrateSecretColumns(instance);
  const appCols = columnNames(instance, 'applications');
  const vacancyCols = columnNames(instance, 'vacancies');
  const resumeCols = columnNames(instance, 'resumes');
  if (!appCols.has('message')) {
    instance.exec("ALTER TABLE applications ADD COLUMN message TEXT NOT NULL DEFAULT ''");
  }
  /*
   * Дата публикации: без неё невозможно отличить свежую вакансию от недельной
   * давности, а отклик на закрытую тратит слот дневного лимита.
   */
  /*
   * Занятость от площадки.
   *
   * Без неё режим работы пришлось бы выводить из текста вакансии, хотя у
   * GeekJob поле `jobFormat.parttime`, а у Работы России — `employment` и
   * `schedule` уже отдаются готовыми значениями.
   *
   * Проверка обязательна: колонка уже есть в CREATE TABLE, и ALTER без неё
   * падает на «duplicate column name» — то есть на любой свежей базе, а не
   * только на старой.
   */
  if (!vacancyCols.has('employment')) {
    instance.exec('ALTER TABLE vacancies ADD COLUMN employment TEXT');
  }
  if (!vacancyCols.has('published_at')) {
    instance.exec('ALTER TABLE vacancies ADD COLUMN published_at INTEGER');
    instance.exec('ALTER TABLE vacancies ADD COLUMN employment TEXT');
  }
  /*
   * Привязка резюме к резюме на hh.
   *
   * Без неё резюме в нашей базе и резюме, которое уходит в отклике, — разные
   * вещи: подбор шёл по локальному резюме, а отправлялось users.hh_resume_id.
   * С несколькими резюме это означало, что система оценивает вакансию по одному
   * резюме, а отправляет другое, и человек об этом не знает.
   *
   * NULL — не ошибка, а обычное состояние резюме, созданного вручную: его
   * можно оценивать и использовать в письме, но отправить на hh нельзя.
   */
  if (!resumeCols.has('hh_id')) {
    instance.exec('ALTER TABLE resumes ADD COLUMN hh_id TEXT');
  }
  // Одно и то же резюме с hh не должно импортироваться дважды: иначе в
  // подборе появятся два одинаковых кандидата, а в интерфейсе — путаница.
  instance.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_hh ON resumes(user_id, hh_id) WHERE hh_id IS NOT NULL',
  );
  if (!appCols.has('external_url')) {
    instance.exec('ALTER TABLE applications ADD COLUMN external_url TEXT');
  }
  /*
   * Порядок обязателен.
   *
   * Миграция resume_id пересобирает таблицу и переносит notified_at, поэтому
   * колонка должна существовать ДО неё. Наоборот получается ошибка
   * «no such column: notified_at» на любой свежей базе: в CREATE TABLE её ещё
   * нет, а перенос уже читает.
   */
  addNotifiedAtColumn(instance);
  migrateApplicationsOrigin(instance);
  migrateApplicationsResumeId(instance);
  // Избранное: уникальность по (пользователь, вакансия) выражена в самой
  // таблице — иначе повторное нажатие «в избранное» плодило бы дубли, и в
  // списке одна вакансия появлялась бы дважды.
  instance.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_user_job ON bookmarks(user_id, job_slug)',
  );
}

export const db = createDatabase(DB_PATH);

export type User = {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  created_at: number;
  plan: string;
  plan_period: number | null;
  plan_activated_at: number | null;
  plan_expires_at: number | null;
  trial_started_at: number | null;
  hh_token: string | null;
  hh_token_expires_at: number | null;
  hh_refresh_token: string | null;
  hh_resume_id: string | null;
  telegram_chat_id: string | null;
  autoapply_paused: number;
  /** До какого момента hh ограничил аккаунт (0 — ограничения нет). */
  autoapply_blocked_until: number;
  autoapply_block_reason: string;
  email_verified: number;
  email_verification_token: string | null;
  email_verification_expires: number | null;
  password_reset_token: string | null;
  password_reset_expires: number | null;
  /** Ожидание по зарплате; null — не задано, фильтр по зарплате не применяется. */
  salary_expectation: number | null;
  /** Предпочтительный город; пустая строка — не задан. */
  city_preference: string;
  /** demo — обычный режим, live — hh подключён и человек явно согласился. */
  mode: 'demo' | 'live';
};

export function getUserById(id: number): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function getUserByEmail(email: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim()) as
    User | undefined;
}
