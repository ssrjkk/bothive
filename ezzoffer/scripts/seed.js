/* eslint-disable @typescript-eslint/no-require-imports */
/*
 * Демо-данные для кабинета EZOffer.
 * Запуск: npm run seed
 * Создаёт аккаунт demo@ezoffer.ru (пароль demo123) с резюме, письмом
 * и активным автопоиском. Отклики НЕ создаются — статистика отражает реальные данные.
 * Повторный запуск перезаписывает демо-аккаунт, не трогая других пользователей.
 *
 * Схема берётся из src/lib/db.ts (SCHEMA_SQL), а не дублируется здесь: своя
 * копия разошлась с приложением — в ней не было email_verified, message,
 * external_url и таблицы vacancies, поэтому `npm run seed` падал с
 * "table users has no column named email_verified", а каталог вакансий
 * вообще не создавался.
 */
// db.ts на верхнем уровне открывает БД по умолчанию и пишет в лог. Seed открывает
// свою (возможно, по EZOFFER_DB_PATH), поэтому гасим логгер — вывод у скрипта свой.
process.env.EZOFFER_SILENT = process.env.EZOFFER_SILENT ?? '1';

require('tsx/cjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { createDatabase } = require('../src/lib/db.ts');

const dbPath =
  (process.env.EZOFFER_DB_PATH || '').trim() || path.join(process.cwd(), 'data', 'ezoffer.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// createDatabase применяет SCHEMA_SQL и идемпотентные миграции — тот же путь,
// что и у приложения, поэтому схема не может разойтись.
const db = createDatabase(dbPath);

const DAY = 24 * 60 * 60 * 1000;

/**
 * Хеш пароля в формате src/lib/password.ts (scrypt$N$r$p$salt$hash).
 * Формат совпадает с приложением, поэтому демо-аккаунт входит через обычный
 * /api/auth/login, а needsRehash() не считает его устаревшим.
 *
 * Синхронный scrypt здесь оставлен осознанно: скрипт запускается один раз
 * из CLI, где блокировка event loop не имеет значения.
 */
const SCRYPT_N = 65536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const EMAIL = 'demo@ezoffer.ru';
const PASSWORD = 'demo123';
const now = Date.now();

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL);
let userId;
if (existing) {
  userId = existing.id;
  // telegram_codes тоже: иначе код привязки демо-аккаунта переживал бы reseed.
  for (const t of [
    'sessions',
    'oauth_states',
    'telegram_codes',
    'consultations',
    'letters',
    'searches',
    'applications',
    'resumes',
  ]) {
    db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(userId);
  }
  db.prepare(
    'UPDATE users SET name = ?, password_hash = ?, email_verified = 1, plan = ?, plan_period = ?, plan_activated_at = ?, plan_expires_at = ?, trial_started_at = ? WHERE id = ?',
  ).run(
    'Демо Пользователь',
    hashPassword(PASSWORD),
    'pro',
    14,
    now - 3 * DAY,
    now + 11 * DAY,
    now - 30 * DAY,
    userId,
  );
} else {
  const r = db
    .prepare(
      'INSERT INTO users (email, name, password_hash, email_verified, created_at, plan, plan_period, plan_activated_at, plan_expires_at, trial_started_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      EMAIL,
      'Демо Пользователь',
      hashPassword(PASSWORD),
      now - 30 * DAY,
      'pro',
      14,
      now - 3 * DAY,
      now + 11 * DAY,
      now - 30 * DAY,
    );
  userId = Number(r.lastInsertRowid);
}

const resumeContent = [
  'Опыт работы',
  '- Frontend-разработчик, 3 года: React, TypeScript, Next.js',
  '- Спроектировал и внедрил дизайн-систему: ускорил выпуск фич на 30%',
  '- Оптимизировал загрузку приложения: LCP с 4.2с до 1.6с, конверсия +12%',
  '- Вёл код-ревью команды из 5 разработчиков',
  '',
  'Ключевые навыки',
  '- React, TypeScript, Next.js, Redux, GraphQL, Jest, Docker',
  '',
  'Образование',
  '- МГТУ им. Баумана, прикладная математика',
  '- Курсы: системный дизайн, performance-оптимизация',
].join('\n');

const letterContent = [
  'Здравствуйте!',
  '',
  'Меня заинтересовала вакансия {вакансия} в компании {компания}. Мой стек — React, TypeScript и Next.js, в последней роли я сократил LCP с 4.2с до 1.6с и ускорил выпуск фич на 30% за счёт дизайн-системы.',
  '',
  'С радостью расскажу подробнее на собеседовании. Резюме прикрепляю.',
  '',
  'С уважением, Демо Пользователь',
].join('\n');

db.prepare(
  'INSERT INTO resumes (user_id, title, content, years_label, ai_improved, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
).run(
  userId,
  'Frontend-разработчик, 3 года (React)',
  resumeContent,
  '3 года · Middle',
  now - 5 * DAY,
  now - 1 * DAY,
);

db.prepare(
  'INSERT INTO letters (user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
).run(userId, 'Стандартное сопроводительное', letterContent, now - 5 * DAY, now - 2 * DAY);

db.prepare(
  'INSERT INTO searches (user_id, title, keywords, salary_min, salary_max, format, city, level, company_blacklist, active, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
).run(
  userId,
  'Frontend: автоотклики',
  'frontend, react, typescript',
  null,
  null,
  'Удалённо',
  '',
  'Middle',
  '',
  now - 1 * DAY,
  now - 1 * DAY,
);

db.prepare(
  'INSERT INTO consultations (user_id, theme, note, booked_at, done) VALUES (?, ?, ?, ?, ?)',
).run(
  userId,
  'Разбор резюме',
  'Хочу понять, почему откликов мало, а приглашений нет.',
  now - 2 * DAY,
  1,
);

db.close();

console.log('');
console.log('Демо-аккаунт готов:');
console.log('  Email:    ' + EMAIL);
console.log('  Пароль:   ' + PASSWORD);
console.log('  Тариф:    Про, 14 дней (активен)');
console.log('  Откликов: 0 — статистика реальная, отклики отправляются только через hh.ru');
console.log('');
console.log('Вход: http://localhost:3000/login');
