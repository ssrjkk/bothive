#!/usr/bin/env node
/**
 * Запуск плоского пакета хостинга (Waifly, Pterodactyl).
 *
 * Отличие от scripts/start-prod.mjs: там раскладка репозитория, и сервер
 * лежит в .next/standalone/server.js. Здесь пакет уже развёрнут — server.js
 * в корне, рядом .next/static, public/ и node_modules. Так устроены все
 * хостинги без Docker: команда запуска — `node scripts/start.mjs`.
 *
 * Обязательно выставляется HOSTNAME=0.0.0.0. Панель хостинга подключается к
 * контейнеру снаружи, и если сервер слушает только localhost, панель видит
 * «порт открыт, ответа нет» и показывает ошибку соединения.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(root, 'server.js'))) {
  console.error('В пакете нет server.js — пакет собран неверно');
  process.exit(1);
}

// База рядом с приложением. На хостинге диск один, и положить её в /tmp
// нельзя: там файлы живут до перезапуска, и все аккаунты пропадут.
const dbPath = process.env.EZOFFER_DB_PATH || path.join(root, 'data', 'ezoffer.db');

// Каталог для базы создаём заранее: на хостинге файловая система бывает
// закрыта на создание подкаталогов, и первый же запрос упал бы с ENOENT.
mkdirSync(path.dirname(dbPath), { recursive: true });

/*
 * Порт.
 *
 * Pterodactyl не выдаёт приложению порт 3000: контейнеру назначают свободный
 * порт хоста и передают его в переменной SERVER_PORT. Если слушать 3000, то
 * прокси панели стучится в другой порт и показывает «соединение закрыто» —
 * выглядит как падение приложения, хотя оно работает.
 *
 * Поэтому приоритет: явный PORT из .env → SERVER_PORT от панели → 3000 для
 * локального запуска.
 */
const port = process.env.PORT ?? process.env.SERVER_PORT ?? '3000';

const env = {
  ...process.env,
  NODE_ENV: 'production',
  EZOFFER_DB_PATH: dbPath,
  PORT: port,
  HOSTNAME: '0.0.0.0',
};

console.log(`EZOffer: http://0.0.0.0:${env.PORT}`);
console.log(`База: ${dbPath}`);
if (process.env.SERVER_PORT && !process.env.PORT) {
  console.log(`Порт взят из SERVER_PORT (назначен панелью): ${port}`);
}

const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
