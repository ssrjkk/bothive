/**
 * Сканер «приведений типов, которые врут» — версия 2, против реальной схемы.
 *
 * Первая версия сравнивала ключи приведения с текстом SELECT регулярками и
 * разобрала 33 приведения из 160 — слишком слабо, чтобы доверять. Здесь
 * источником истины служит схема: скрипт поднимает пустую базу по миграциям
 * проекта и берёт реальные колонки из PRAGMA table_info. Ключ приведения,
 * которого нет ни среди колонок таблицы, ни среди алиасов SELECT, — это
 * опечатка, которая даёт `undefined` в рантайме и молча ломает фичу.
 *
 * Запуск: node scripts/scan-typecast.mjs [корень]
 */
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? 'src';

// ---------------------------------------------------------------- схема

// db.ts открывает файл при импорте и отдаёт готовый экземпляр `db`.
// Импортируем его один раз и работаем уже с ним — схема после миграций.
const { db: real } = await import('../src/lib/db.ts');

function columnsOf(table) {
  try {
    return new Set(
      real
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => String(c.name).toLowerCase()),
    );
  } catch {
    return null; // таблицы нет (миграция ещё не дошла) — не судим
  }
}

const tableCache = new Map();
function tableCols(t) {
  if (!tableCache.has(t)) tableCache.set(t, columnsOf(t));
  return tableCache.get(t);
}

const SYSTEM = new Set(['rowid', 'oid', '_rowid_', 'id']);

// ---------------------------------------------------------------- разбор SQL

/** Таблица в FROM/JOIN. */
function tablesOf(sql) {
  return [...sql.matchAll(/\b(?:from|join)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/gi)].map((m) =>
    m[1].toLowerCase(),
  );
}

/** Имена, которые SELECT реально отдаёт: колонки плюс алиасы. */
function selectAliases(sql) {
  const out = new Set();
  for (const m of sql.matchAll(/\bas\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/gi))
    out.add(m[1].toLowerCase());
  for (const m of sql.matchAll(
    /`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\.\s*`?([A-Za-z_][A-Za-z0-9_]*)`?\s+as\s+/gi,
  )) {
    out.add(m[2].toLowerCase());
  }
  return out;
}

function typeKeys(lit) {
  return [...lit.matchAll(/(^|[{;,\n])\s*([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/g)].map((m) => m[2]);
}

// ---------------------------------------------------------------- обход

const files = globSync(join(ROOT, '**', '*.{ts,tsx}'), { posix: true });
const findings = [];
const seen = new Set();
let casts = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    // SQL может быть многострочным шаблонным литералом — склеиваем окно.
    const window = lines.slice(i, i + 14).join('\n');
    const pm = window.match(/prepare\(\s*`([\s\S]*?)`/);
    if (!pm) continue;
    const sql = pm[1];

    const cm = window.slice(pm.index + pm[0].length).match(/\bas\s*\{([^{}]*)\}/);
    if (!cm) continue;

    const aliases = selectAliases(sql);
    const keys = typeKeys(cm[1]).filter(Boolean);
    if (!keys.length) continue;
    casts++;

    // Колонки — объединение всех таблиц запроса: строка могла прийти из JOIN.
    const cols = new Set();
    let knownTables = 0;
    for (const t of tablesOf(sql)) {
      const c = tableCols(t);
      if (c) {
        knownTables++;
        for (const x of c) cols.add(x);
      }
    }
    if (!knownTables) continue; // подзапрос/CTE/временная таблица — не судим

    const missing = keys.filter(
      (k) =>
        !aliases.has(k.toLowerCase()) && !cols.has(k.toLowerCase()) && !SYSTEM.has(k.toLowerCase()),
    );
    if (!missing.length) continue;

    const lineNo = window.slice(0, window.indexOf(cm[0])).split('\n').length + i - 1;
    // Окна в 14 строк перекрываются, поэтому одно и то же расхождение
    // находится несколько раз. Ключ дедупликации — файл, строка, имя поля.
    const fresh = missing.filter((k) => {
      const id = `${file}|${lineNo}|${k}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (!fresh.length) continue;

    findings.push(
      `${file}:${lineNo}  в схеме нет: ${fresh.join(', ')}\n    SQL: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`,
    );
  }
}

for (const f of findings) console.log(f);
console.log(
  `\nфайлов: ${files.length}, приведений разобрано: ${casts}, расхождений: ${findings.length}`,
);
real.close();
