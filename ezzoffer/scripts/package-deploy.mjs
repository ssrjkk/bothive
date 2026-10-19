#!/usr/bin/env node
/**
 * Сборка исполняемого пакета для хостинга без Docker (Waifly, Pterodactyl).
 *
 * Зачем отдельный пакет, если есть Dockerfile: там образ собирается на сервере
 * и нужен C++-тулчейн под better-sqlite3. Здесь наоборот — собираем здесь,
 * заливаем готовым. На Pterodactyl с 300 МБ RAM `npm ci` и `next build` не
 * пройдут, а запуск готового standalone проходит.
 *
 * ГЛАВНОЕ: база данных в пакет НЕ попадает. Локальный data/ezoffer.db содержит
 * хэши паролей и OAuth-токены; уехав на хостинг, он стал бы доступен всем,
 * кто скачает архив. Это не бдительность, а утечка по умолчанию: забыть
 * исключить — значит выложить базу чужих паролей.
 *
 * Запуск: node scripts/package-deploy.mjs [каталог]
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'deploy-out'));

if (!existsSync(path.join(root, '.next', 'standalone', 'server.js'))) {
  console.error('Нет .next/standalone — сначала npm run build');
  process.exit(1);
}

/** Что копируем: [из, куда внутри пакета]. */
const FILES = [
  ['.next/standalone', '.'],
  ['.next/static', '.next/static'],
  ['public', 'public'],
  // Шрифт кириллицы для PDF. Без него экспорт резюме вернёт 503, и это
  // выясняется только в момент, когда человек нажимает «скачать PDF».
  ['node_modules/dejavu-fonts-ttf/ttf', 'node_modules/dejavu-fonts-ttf/ttf'],
  ['scripts/start-prod.mjs', 'scripts/start-prod.mjs'],
  ['scripts/start-hosting.mjs', 'scripts/start-hosting.mjs'],
  ['scripts/backup.mjs', 'scripts/backup.mjs'],
  ['deploy', 'deploy'],
  ['.env.example', '.env.example'],
];

const MISSING_OK = new Set(['.env.example', 'deploy']);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let copied = 0;
const skipped = [];

for (const [from, to] of FILES) {
  const src = path.join(root, from);
  if (!existsSync(src)) {
    if (!MISSING_OK.has(from)) {
      console.error(`Нет обязательного: ${from}`);
      process.exit(1);
    }
    skipped.push(from);
    continue;
  }
  const dest = path.join(outDir, to);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  copied++;
}

/*
 * Вычистка после копии standalone.
 *
 * `.next/standalone` содержит не только сервер, но и копию проекта целиком —
 * Turbopack разворачивает туда всё, до чего дотягивается трассировка. Вместе с
 * исходниками туда попадает `data/` с рабочей базой: хэшами паролей и
 * OAuth-токенами. Просто скопировать нельзя — надо вырезать. Тот же приём, что
 * в Dockerfile, и по той же причине.
 */
const STRIP_DIRS = ['data', 'src', 'tests', 'docs', 'deploy-out', 'pages-out'];
for (const name of STRIP_DIRS) {
  rmSync(path.join(outDir, name), { recursive: true, force: true });
}
const STRIP_FILES = [
  'tsconfig.tsbuildinfo',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'AUDIT.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'LICENSE',
  'next.config.ts',
  'eslint.config.mjs',
  'postcss.config.mjs',
  'tsconfig.json',
  'docker-compose.yml',
  'docker-compose.prod.yml',
  'Dockerfile',
  'fly.toml',
  'package.json',
  'package-lock.json',
];
for (const file of STRIP_FILES) {
  rmSync(path.join(outDir, file), { force: true });
}

/*
 * Проверка на утечку. Дешёвая, но такая ошибка стоит дороже любой экономии
 * времени: архив с базой уезжает туда, откуда его скачает любой желающий.
 *
 * Раньше здесь стояло `existsSync(path.join(outDir, "data"))` — проверка
 * МЁРТВАЯ. Она смотрела только на `deploy-out/data`, а `STRIP_DIRS` этот
 * каталог уже удалял, то есть ветка не могла сработать никогда. Реальная
 * опасность была глубже: `.next/standalone` трассируется вместе с каталогом
 * `deploy-out` предыдущего прогона, поэтому в пакет попадало
 * `deploy-out/deploy-out/data/ezoffer.db*` — база, дошедшая до предыдущего
 * пакета и упакованная снова. Обратная связь срабатывала при каждой сборке.
 *
 * Теперь проверка рекурсивная и по СУЩЕСТВУ: ищется не каталог с каким-то
 * именем, а сама база — `ezoffer.db` и её WAL/SHM-файлы — где угодно внутри
 * пакета. Имя каталога не важно, поэтому ни одна вложенность его не спрячет.
 */
function findDatabaseFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findDatabaseFiles(full));
      continue;
    }
    // ezoffer.db, а также -wal/-shm/-journal: они содержат недавние записи,
    // которых нет в основном файле, и потерянный WAL — тоже утечка.
    if (/^ezoffer\.db(-wal|-shm|-journal)?$/.test(entry.name)) {
      found.push(path.relative(outDir, full));
    }
  }
  return found;
}

const leaked = findDatabaseFiles(outDir);
if (leaked.length > 0) {
  console.error(
    'В пакете оказалась база данных — это хэши паролей и OAuth-токены:\n  ' + leaked.join('\n  '),
  );
  process.exit(1);
}

/** Минимальный .env для первого запуска. Секретов здесь нет и быть не должно. */
writeFileSync(
  path.join(outDir, '.env'),
  [
    '# Замени SITE_URL на настоящий адрес сервера — он участвует в OAuth',
    '# redirect_uri, в письмах и в sitemap.',
    'SITE_URL=http://localhost:3000',
    'PORT=3000',
    'EZOFFER_DB_PATH=./data/ezoffer.db',
    'EZOFFER_SILENT=0',
    'TRUST_PROXY=1',
    'SCHEDULER_INTERVAL_MS=300000',
    '# Лимит автооткликов. 0 означает «без потолка», а не «выключено».',
    'AUTOAPPLY_DAILY_CAP=1',
    '',
    '# GitHub-вход: значения выдаёт dev.github.com, секрет сюда не вставлять.',
    'GITHUB_CLIENT_ID=',
    'GITHUB_CLIENT_SECRET=',
    '',
    '# Telegram-бот.',
    'TELEGRAM_BOT_TOKEN=',
    'TELEGRAM_WEBHOOK_SECRET=',
    '',
    '# Оплата: общий секрет подписи вебхуков. Сгенерируй случайную строку.',
    'PAYMENT_HMAC_SECRET=',
    'PAYMENT_CRYPTO_USDT_WALLET=',
    '',
    '# OAuth-вход: секрет подписи state. Тоже случайная строка.',
    'OAUTH_STATE_SECRET=',
    '',
  ].join('\n'),
  'utf8',
);

function sizeOf(dir) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    total += statSync(full).isDirectory() ? sizeOf(full) : statSync(full).size;
  }
  return total;
}

/*
 * .next/standalone может содержать предыдущий deploy-out (см. выше про
 * трассировку). Он удалён STRIP_DIRS, но чтобы база не доехала до следующей
 * сборки даже при смене имени каталога, вычищается всё, что похоже на неё.
 */
console.log('Вычищены вложенные артефакты предыдущих сборок.');
const mb = (sizeOf(outDir) / 1024 / 1024).toFixed(1);
console.log(`Готово: ${outDir}`);
console.log(`  скопировано блоков ${copied}, размер ${mb} МБ`);
if (skipped.length) console.log(`  не найдено (не критично): ${skipped.join(', ')}`);
console.log(`  базы в пакете нет — проверка пройдена (рекурсивный поиск ezoffer.db*)`);
