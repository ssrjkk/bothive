/**
 * Локальный production-запуск standalone-сборки (как в Dockerfile).
 * Копирует .next/static и public в .next/standalone и запускает сервер.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(root, '.next', 'standalone');

if (!existsSync(path.join(standalone, 'server.js'))) {
  console.error('Сборка не найдена. Сначала выполните: npm run build');
  process.exit(1);
}

mkdirSync(path.join(standalone, '.next'), { recursive: true });
if (existsSync(path.join(root, '.next', 'static'))) {
  cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), {
    recursive: true,
  });
}
if (existsSync(path.join(root, 'public'))) {
  cpSync(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
}

// Шрифт с кириллицей для PDF-экспорта: путь к нему вычисляется в рантайме,
// поэтому Turbopack не может его отследить, и копируем вручную — так же, как
// в Dockerfile. Без него экспорт резюме в PDF вернёт 503.
const FONT_FILES = ['DejaVuSans.ttf', 'DejaVuSansCondensed.ttf'];
const fontSrc = path.join(root, 'node_modules', 'dejavu-fonts-ttf', 'ttf');
const fontDst = path.join(standalone, 'node_modules', 'dejavu-fonts-ttf', 'ttf');
const missingFonts = FONT_FILES.filter((f) => !existsSync(path.join(fontSrc, f)));
if (missingFonts.length > 0) {
  console.warn(
    `Внимание: не найдены файлы шрифта (${missingFonts.join(', ')}). PDF-экспорт вернёт ошибку. Установите пакет dejavu-fonts-ttf.`,
  );
} else {
  mkdirSync(fontDst, { recursive: true });
  for (const file of FONT_FILES) {
    cpSync(path.join(fontSrc, file), path.join(fontDst, file));
  }
}

/**
 * Путь к БД.
 *
 * Сервер запускается с cwd = .next/standalone, поэтому data/ezoffer.db
 * ищется внутри сборки, а не в корне репозитория. Раньше это проходило
 * незаметно и оборачивалось потерей данных: npm run build удаляет .next,
 * вместе с базой, куда писал предыдущий npm start, а аккаунты и резюме,
 * созданные через npm run dev (или прошлый npm start), оказывались в другой
 * базе — «пропали», хотя ничего не удаляли.
 *
 * Локально указываем путь явно. В Docker этого кода нет: там CMD запускает
 * node server.js напрямую, а каталог /app/data — смонтированный volume.
 */
const dbPath = process.env.EZOFFER_DB_PATH ?? path.join(root, 'data', 'ezoffer.db');

const env = {
  ...process.env,
  NODE_ENV: 'production',
  EZOFFER_DB_PATH: dbPath,
  // Раньше здесь стояло `process.env.HOSTNAME ?? "0.0.0.0"`. Это ломало деплой:
  // переменная HOSTNAME выставляется окружением, а не нами — в Docker она равна
  // ID контейнера, в systemd — имени хоста. Next подставляет её в server.js
  // как bind-адрес, и сервер слушал «my-container-a1b2c3» вместо 0.0.0.0,
  // то есть не принимал внешние соединения вообще. Свой адрес задаём явно.
  HOSTNAME: process.env.APP_HOST ?? '0.0.0.0',
  PORT: process.env.PORT ?? '3000',
};

console.log(`EZOffer запускается на http://localhost:${env.PORT} (standalone)`);
// Путь печатаем всегда: расхождение баз — самая дорогая ошибка при локальном
// запуске, и заметить её без этой строки почти невозможно.
console.log(`База данных: ${dbPath}`);
const child = spawn(process.execPath, ['server.js'], {
  cwd: standalone,
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));

/*
 * Проброс сигналов потомку.
 *
 * Без этого Ctrl+C / SIGTERM убивал только родителя (этот скрипт), а сервер
 * продолжал висеть сиротой на порту: следующий запуск падал с «порт занят»,
 * и человек шёл убивать процессы вручную. Тот же приём уже есть в
 * start-hosting.mjs — здесь его не было.
 */
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
