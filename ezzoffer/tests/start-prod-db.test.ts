import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Локальный production-запуск (scripts/start-prod.mjs).
 *
 * Сервер стартует с cwd = .next/standalone, поэтому путь data/ezoffer.db
 * разрешался внутрь сборки, а не в корень репозитория. Последствия были
 * неочевидны и дороги:
 *
 *  - npm run build удаляет .next вместе с базой, куда писал прошлый npm start;
 *  - аккаунты и резюме, созданные в dev, оказывались в другой базе;
 *  - выглядело это как «данные пропали», хотя никто их не удалял.
 *
 * Тест фиксирует, что скрипт задаёт EZOFFER_DB_PATH явно. В Docker этого кода
 * нет: там CMD запускает node server.js напрямую, а /app/data — volume.
 */

const START = readFileSync('scripts/start-prod.mjs', 'utf8');

test('локальный запуск указывает путь к БД явно', () => {
  assert.match(
    START,
    /EZOFFER_DB_PATH:\s*dbPath/,
    'EZOFFER_DB_PATH не прокидывается в окружение сервера',
  );
});

test('путь к БД по умолчанию указывает в корень репозитория', () => {
  assert.match(
    START,
    /EZOFFER_DB_PATH\s*\?\?\s*path\.join\(root,\s*"data",\s*"ezoffer\.db"\)/,
    'путь по умолчанию должен быть data/ezoffer.db рядом с package.json, а не внутри .next/standalone',
  );
});

test('явно заданный EZOFFER_DB_PATH не перетирается', () => {
  // ?? а не || и не принудительное присваивание: в контейнерах и тестах путь
  // задают снаружи, и стартер не должен его игнорировать.
  assert.doesNotMatch(START, /EZOFFER_DB_PATH:\s*path\.join\(root/);
});

test('старт печатает, какую базу использует', () => {
  assert.match(
    START,
    /console\.log\(`[^`]*\$\{dbPath\}/,
    'путь к базе не выводится — расхождение баз почти невозможно заметить',
  );
});

/*
 * Регрессия: сигналы не доходили до сервера.
 *
 * Родитель (этот скрипт) умирал по Ctrl+C / SIGTERM, а потомок (server.js)
 * оставался сиротой на порту. Следующий запуск падал с «порт занят», и
 * человек шёл убивать процессы вручную. В start-hosting.mjs проброс был, здесь
 * — нет.
 */
test('сигналы завершения пробрасываются серверу', () => {
  // Форма любая (цикл по сигналам или два process.on), лишь бы оба сигнала
  // доходили до потомка: проверяется наличие имён сигналов рядом с child.kill.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    assert.ok(START.includes(sig), `сигнал ${sig} в скрипте не упомянут`);
  }
  assert.match(
    START,
    /child\.kill\(/,
    'сигналы не пробрасываются потомку — сервер останется сиротой на порту',
  );
});

test('Docker не запускает скрипт и полагается на volume', () => {
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  assert.match(
    dockerfile,
    /CMD \["node",\s*"server\.js"\]/,
    'в Docker сервер должен запускаться напрямую, иначе путь из start-prod.mjs уедет в образ',
  );
  assert.doesNotMatch(
    dockerfile,
    /start-prod\.mjs/,
    'Docker не должен использовать локальный стартер: тот перезаписывает EZOFFER_DB_PATH путём в образе',
  );
});
