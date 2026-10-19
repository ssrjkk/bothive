#!/usr/bin/env node
/**
 * Статический экспорт публичных страниц для GitHub Pages.
 *
 * Что здесь происходит и что не происходит. Приложение целиком на Pages не
 * работает и не может: там 38 роутов API, SQLite-файл, планировщик и вебхук
 * Telegram, а GitHub Pages раздаёт файлы и не исполняет ничего. Нужен сервер
 * для кабинета — это docker-compose.prod.yml.
 *
 * Но ПУБЛИЧНАЯ часть сайта пререндерится при сборке (30 HTML-файлов), и для
 * маркетингового сайта этого достаточно. Скрипт копирует их вместе с
 * ассетами в каталог, который GitHub Pages отдаёт как есть.
 *
 * Почему не `output: "export"`: Next отказывается экспортировать проект с
 * динамическими маршрутами (/dashboard, /login, /api), а они нужны на
 * сервере. Поэтому экспорт собственный: берём ровно то, что Next уже собрал.
 *
 * Запуск: node scripts/export-pages.mjs [каталог]
 */
import {
  cpSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..',
);
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'pages-out'));
const appDir = path.join(root, '.next', 'server', 'app');

/**
 * Маршруты, которые на Pages показывать нельзя.
 *
 * Динамических страниц (кабинет, вход, регистрация) в пререндере нет, и
 * экспортировать их нечего. Но `/login` и `/signup` — это клиентские формы,
 * которые на статике всё равно упрутся в /api и получат 404. Их вырезаем
 * явно, чтобы в меню не было ссылок в никуда.
 */
const EXCLUDE = new Set([
  'login',
  'signup',
  'forgot-password',
  'reset-password',
  'dashboard',
  'api',
]);

if (!existsSync(appDir)) {
  console.error('Нет .next/server/app — сначала npm run build');
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
let pages = 0;

/** index.html → out/index.html; blog/x.html → out/blog/x/index.html */
function writePage(route, file) {
  const dir = route ? path.join(outDir, route) : outDir;
  mkdirSync(dir, { recursive: true });
  cpSync(file, path.join(dir, 'index.html'));
  pages++;
}

/** Обход пререндеренных HTML. */
function walk(dir, route) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry.startsWith('_') || entry.startsWith('.')) continue; // служебное: _app, _not-found-скелет

    if (statSync(full).isDirectory()) {
      walk(full, route ? `${route}/${entry}` : entry);
      continue;
    }

    // Имя маршрута — БЕЗ .html. С ним в пути получался каталог «статья.html»,
    // и blog/kak-nastroit-autootkliki и blog/skolko-otklikov разъезжались.
    const clean = entry.replace(/\.html$/, '');
    if (!entry.endsWith('.html') || EXCLUDE.has(clean)) continue;
    // Корневой index.html кладём в корень, а не в каталог index/ — иначе
    // главная страница сайта просто не находится.
    const target = route ? `${route}/${clean}` : clean === 'index' ? '' : clean;
    writePage(target, full);
  }
}

walk(appDir, '');

// Ассеты Next и файлы из public/.
const staticDir = path.join(root, '.next', 'static');
if (existsSync(staticDir)) {
  const dest = path.join(outDir, '_next', 'static');
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(staticDir, dest, { recursive: true });
}
if (existsSync(path.join(root, 'public'))) {
  cpSync(path.join(root, 'public'), outDir, { recursive: true });
}

/*
 * .nojekyll обязателен. Без него GitHub Pages прогоняет выгрузку через
 * Jekyll, который начинает обработку с подчёркивания — и каталог _next
 * молча исчезает вместе со всем CSS и скриптами. Страница открывается белой.
 */
writeFileSync(path.join(outDir, '.nojekyll'), '');

/*
 * 404. GitHub Pages отдаёт 404.html при любом несовпавшем пути. Копия
 * пререндеренной страницы «не найдено» — лучше, чем стандартная страница
 * GitHub, и сохраняет оформление сайта.
 */
const notFound = path.join(appDir, '_not-found.html');
if (existsSync(notFound)) {
  cpSync(notFound, path.join(outDir, '404.html'));
}

// robots.txt: статическая копия указывает на основной домен, а не на страницу проекта.
const robots = path.join(outDir, 'robots.txt');
if (existsSync(robots)) {
  const body = readFileSync(robots, 'utf8')
    .replace(
      /^Sitemap:.*$/m,
      `Sitemap: ${process.env.SITE_URL ?? 'https://ezoffer.ru'}/sitemap.xml`,
    )
    .replace(/^Disallow: \/dashboard.*$/m, 'Disallow: /\nDisallow: /api/');
  writeFileSync(robots, body);
}

const bytes = readdirSync(outDir).length;
console.log(`Готово: ${outDir}`);
console.log(
  `  страниц ${pages}, каталогов верхнего уровня ${bytes}, basePath «${basePath || '—'}»`,
);
if (basePath) {
  console.log(
    `  ВНИМАНИЕ: префикс /${basePath.replace(/^\//, '')} — публиковать нужно из репозитория с этим именем.`,
  );
}
