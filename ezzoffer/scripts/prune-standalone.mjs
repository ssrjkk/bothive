/**
 * Обрезка .next/standalone перед деплоем.
 *
 * Пути к файлам SQLite (db.ts) и к TTF-шрифту (resume-pdf.ts) вычисляются в
 * рантайме, поэтому Turbopack не может их отследить и при динамическом доступе
 * к файловой системе помечает сборку как "tracing of the whole project" —
 * вместе со всем корнем проекта. В итоге в образ попадают:
 *
 *   data/   — локальная ezoffer.db с хэшами паролей и OAuth-токенами;
 *   src/    — исходники;
 *   tests/  — тесты.
 *
 * Утечка данных неприемлема, поэтому каталоги удаляются после сборки.
 * Данные в рантайме приходят из volume, каталог создаётся при старте
 * (см. mkdirSync в src/lib/db.ts), а шрифт копируется отдельно — здесь
 * и в Dockerfile/scripts/start-prod.mjs.
 *
 * Скрипт идемпотентен и ничего не делает, если output не standalone.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(root, '.next', 'standalone');

if (!existsSync(path.join(standalone, 'server.js'))) {
  console.log('prune-standalone: .next/standalone не найден, пропуск.');
  process.exit(0);
}

// Каталоги верхнего уровня, которые копируются в standalone из корня проекта
// и не нужны серверу во время выполнения.
//
// Каталог .next внутри standalone НЕ трогаем: там лежит скомпилированный сервер
// (.next/server), без которого server.js не запускается. Удаление даёт
// "Could not find a production build in the './.next' directory".
const REMOVABLE = ['data', 'src', 'tests', 'scripts', '.git'];

let removed = 0;

for (const name of REMOVABLE) {
  const target = path.join(standalone, name);

  // Выход за пределы standalone — защита от опечатки в пути.
  if (path.dirname(target) !== standalone) continue;
  if (!existsSync(target)) continue;

  // Безопасность: каталог внутри standalone может оказаться
  // node_modules-подобным вложением — трогать нельзя.
  if (!statSync(target).isDirectory()) continue;

  rmSync(target, { recursive: true, force: true });
  removed++;
}

if (removed === 0) {
  console.log('prune-standalone: удалять нечего.');
} else {
  const entries = readdirSync(standalone).length;
  console.log(`prune-standalone: удалено каталогов ${removed} (${entries} осталось в standalone).`);
}
