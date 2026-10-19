#!/usr/bin/env node
/**
 * Бэкап базы с проверкой восстановления.
 *
 * Копия одного файла `ezoffer.db` здесь была бы неверной и тихо: база работает
 * в режиме WAL, поэтому свежие изменения лежат в `ezoffer.db-wal` и в сам файл
 * не попали. Копия без WAL — это база минуты давности, и при восстановлении
 * человек получит потерянные аккаунты и отклики, не заметив этого.
 *
 * Поэтому здесь не `cp`, а `.backup()` из better-sqlite3: он берёт
 * согласованный снимок, пока сервер пишет, и не требует останавливать его.
 *
 * Дальше бэкап проверяется так, как его будут использовать: файл открывается
 * заново, проходит integrity_check и сверяет количество строк с источником.
 * Бэкап, который не открывается, бесполезен ровно в тот момент, когда он
 * понадобится.
 *
 * Запуск: node scripts/backup.mjs [каталог]
 */
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
);
const srcPath = process.env.EZOFFER_DB_PATH || path.join(root, 'data', 'ezoffer.db');
const outDir = process.argv[2] || path.join(root, 'data', 'backups');

/**
 * Сколько последних бэкапов держим. Диск не бесконечен.
 *
 * `?? 14` тут был ловушкой, потому что `Number("") === 0`, а `??` на пустой
 * строке не срабатывает. Оператор добавлял в cron-окружение `BACKUP_KEEP=`
 * (так объявлены почти все переменные в .env.example, в этом проекте это
 * обычный способ), скрипт видел KEEP = 0, а `slice(0, backups.length)`
 * возвращал ВСЕ файлы — включая только что созданный. Ночь cron отчитывался об
 * успехе, а на диске оставалось ноль бэкапов. Ровно тот класс, который в
 * `src/lib/env.ts` описан и закрыт через `envNum`; здесь он был не закрыт.
 *
 * Теперь пустая строка и пробелы означают «не задано», мусор — «не задано».
 */
const KEEP = (() => {
  const raw = process.env.BACKUP_KEEP?.trim();
  if (!raw) return 14;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 14;
})();

if (!existsSync(srcPath)) {
  console.error(`Нет базы по пути ${srcPath}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = path.join(outDir, `ezoffer-${stamp}.db`);

const src = new Database(srcPath, { readonly: true, fileMustExist: true });

const tables = src
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all()
  .map((r) => r.name);

/** Строки в источнике — эталон, с которым сверяется копия. */
const expected = {};
for (const t of tables) {
  // Имена таблиц берутся из sqlite_master, а не из ввода: подставлять их в SQL
  // как параметр нельзя, а кавычками обернуть имя таблицы здесь достаточно.
  expected[t] = src.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
}

await src.backup(outPath);
src.close();

const copy = new Database(outPath, { readonly: true, fileMustExist: true });

const integrity = copy.pragma('integrity_check', { simple: true });
if (integrity !== 'ok') {
  copy.close();
  console.error(`Копия не прошла integrity_check: ${integrity}`);
  process.exit(1);
}

const problems = [];
for (const [table, count] of Object.entries(expected)) {
  const got = copy.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;
  if (got !== count) problems.push(`${table}: в источнике ${count}, в копии ${got}`);
}
copy.close();

if (problems.length > 0) {
  console.error('Копия не совпадает с источником:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const sizeKb = Math.round(statSync(outPath).size / 1024);
const totalRows = Object.values(expected).reduce((a, b) => a + b, 0);
console.log(`Готово: ${outPath}`);
console.log(`  ${sizeKb} КБ, таблиц ${tables.length}, строк ${totalRows}, integrity ok`);

/**
 * Ротация: оставляем KEEP последних.
 *
 * Сортировка по имени, а не по mtime: имя содержит дату в ISO, поэтому порядок
 * совпадает с хронологическим, и ротация не зависит от того, как файловая
 * система хранит время.
 */
const backups = readdirSync(outDir)
  .filter((f) => /^ezoffer-.*\.db$/.test(f))
  .sort();

const stale = backups.slice(0, Math.max(0, backups.length - KEEP));
for (const f of stale) {
  unlinkSync(path.join(outDir, f));
  console.log(`  удалён старый бэкап ${f}`);
}
