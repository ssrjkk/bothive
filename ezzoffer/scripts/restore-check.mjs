#!/usr/bin/env node
/**
 * Репетиция восстановления.
 *
 * Зачем: бэкап, из которого ни разу не восстанавливались — это не бэкап, а
 * гипотеза о бэкапе. Файл может открываться и при этом содержать схему
 * трёхмесячной давности, а миграции при следующем старте — упасть или
 * тихо оставить поле пустым. Человек узнаёт об этом в момент, когда данные
 * уже нужны.
 *
 * Здесь бэкап РЕАЛЬНО поднимается: копируется в отдельный каталог, на нём
 * создаётся соединение, прогоняются миграции (createDatabase делает это сам),
 * сверяются таблицы и строки. Живая база не затрагивается ничем — только
 * читается для сравнения.
 *
 * Запуск: node scripts/restore-check.mjs [путь-к-бэкапу]
 *         без аргумента берётся последний бэкап из data/backups.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, copyFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const livePath = process.env.EZOFFER_DB_PATH || path.join(root, 'data', 'ezoffer.db');
const backupDir = path.join(root, 'data', 'backups');

/*
 * Шаг 0: TypeScript-лоадер.
 *
 * Дальше скрипт импортирует `../src/lib/db.ts` — миграции живут там, и
 * повторить их иначе нечем: именно их падение на старте из старого бэкапа и
 * есть то, что этот скрипт ищет. Но `node scripts/restore-check.mjs` (так
 * написано в шапке и так это запускает оператор) не умеет резолвить
 * extensionless-импорты из .ts: `db.ts` делает `import … from "./logger"`,
 * и Node падает с «Cannot find module».
 *
 * Проблема была не в том, что скрипт не находит базу, а в том, что он падал
 * ВСЕГДА и по другой причине. То есть единственный инструмент, способный
 * поймать битый бэкап, гарантированно сообщал «восстановление не прошло» — и
 * оператор искал проблему там, где её не было, игнорируя настоящую.
 *
 * Поэтому скрипт перезапускает себя с `--import tsx`, если лоадера ещё нет.
 * `npm test` так же запускает tsx, и dev-зависимость в проекте есть.
 */
const RELAUNCH_FLAG = 'EZOFFER_RESTORE_CHECK_RELAUNCHED';
if (!process.env[RELAUNCH_FLAG]) {
  const { spawnSync } = await import('node:child_process');
  const tsxSpecifier = ['--import', 'tsx'];
  // Отдельная проверка: если tsx не установлен, честное сообщение об этом
  // полезнее, чем падение дочернего процесса с кодом 1 и стеком.
  const probe = spawnSync(process.execPath, [...tsxSpecifier, '-e', '0'], {
    cwd: root,
    stdio: 'ignore',
  });
  if (probe.status !== 0) {
    console.error(
      'Нужен tsx для прогона миграций (dev-зависимость проекта).\n' +
        'Установите зависимости: npm ci',
    );
    process.exit(1);
  }
  const child = spawnSync(
    process.execPath,
    [...tsxSpecifier, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, [RELAUNCH_FLAG]: '1' },
    },
  );
  process.exit(child.status ?? 1);
}

function latestBackup() {
  if (!existsSync(backupDir)) return null;
  const files = readdirSync(backupDir)
    .filter((f) => /^ezoffer-.*\.db$/.test(f))
    .sort();
  return files.length ? path.join(backupDir, files[files.length - 1]) : null;
}

const source = process.argv[2] ? path.resolve(process.argv[2]) : latestBackup();
if (!source || !existsSync(source)) {
  console.error('Бэкап не найден. Сначала node scripts/backup.mjs');
  process.exit(1);
}

console.log(`Проверяю бэкап: ${source}`);

// 1. Файл открывается и проходит integrity_check.
const direct = new Database(source, { readonly: true, fileMustExist: true });
const integrity = direct.pragma('integrity_check', { simple: true });
if (integrity !== 'ok') {
  direct.close();
  console.error(`Целостность нарушена: ${integrity}`);
  process.exit(1);
}
const tables = direct
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map((r) => r.name);
direct.close();

/*
 * Пустая база проходит integrity_check: проверять нечего, и он отвечает
 * «ok». А обрезанный бэкап — это ровно пустой файл, и он принимался как
 * годный. Человек узнал бы об этом в момент, когда данные понадобились.
 * Поэтому нулевой размер и отсутствие таблиц — отказ.
 */
if (tables.length === 0) {
  console.error('В файле нет ни одной таблицы — это не база (бэкап обрезан или пуст)');
  process.exit(1);
}

// 2. Поднимаем копию через код приложения: так проверяется не файл, а то,
//    открывается ли база приложением и какая схема получится.
const dir = mkdtempSync(path.join(tmpdir(), 'ezoffer-restore-'));
const restored = path.join(dir, 'restored.db');
copyFileSync(source, restored);
mkdirSync(path.join(dir, 'data'), { recursive: true });
const inPlace = path.join(dir, 'data', 'ezoffer.db');
copyFileSync(source, inPlace);

let problems = [];
let summary = '';
try {
  const { createDatabase } = await import('../src/lib/db.ts');
  const db = createDatabase(inPlace);

  // Схема после миграций: если миграция падает, это всплывает здесь.
  const after = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);

  const added = after.filter((t) => !tables.includes(t));
  const lost = tables.filter((t) => !after.includes(t));
  if (lost.length) problems.push(`после миграций исчезли таблицы: ${lost.join(', ')}`);
  if (added.length) console.log(`  миграции добавили таблиц: ${added.length}`);

  // Колонки, на которых держится Фаза 1, должны быть на месте — именно они
  // проверяли «бэкап полон».
  const usersCols = db
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((c) => c.name);
  if (!usersCols.includes('mode')) {
    problems.push('в восстановленной базе нет users.mode — бэкап старше миграции режима');
  }

  const counts = {};
  for (const t of after) {
    try {
      counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
    } catch {
      counts[t] = -1;
    }
  }
  const totalRows = Object.values(counts).reduce((a, b) => Math.max(0, a + b), 0);
  summary = `  таблиц ${after.length}, строк ${totalRows}, целостность ok`;

  // Сверяем с живой базой: восстановление из откровенно старого бэкапа
  // должно быть заметно, а не тихо.
  if (existsSync(livePath)) {
    const live = new Database(livePath, { readonly: true, fileMustExist: true });
    const liveUsers = live.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    live.close();
    const restoredUsers = counts.users ?? 0;
    if (liveUsers - restoredUsers > 0) {
      console.log(
        `  в бэкапе на ${liveUsers - restoredUsers} меньше пользователей, чем в живой базе (${restoredUsers} против ${liveUsers})`,
      );
    }
  }

  db.close();
} catch (error) {
  problems.push(
    `восстановленная база не открылась приложением: ${error && error.message ? error.message : String(error)}`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(summary);
if (problems.length > 0) {
  console.error('Восстановление не прошло:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('Восстановление прошло: копия открывается приложением и проходит миграции.');
/*
 * Явный выход, а не «дошли до конца».
 *
 * Скрипт открывает базы, и better-sqlite3 держит соединения — процесс мог
 * не завершиться и упасть по таймауту с кодом, который ничего не говорит о
 * результате. Проверка, у которой код выхода зависит от того, как быстро
 * закрылись дескрипторы, годится только для запуска руками.
 */
process.exit(0);
