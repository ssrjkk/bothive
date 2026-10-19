import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const SEED = join(REPO, 'scripts', 'seed.js');

type SeedResult = { ok: boolean; stdout: string; stderr: string };

function runSeed(cwd: string): SeedResult {
  try {
    const stdout = execFileSync(process.execPath, [SEED], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function withFreshDb(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ezoffer-seed-'));
  try {
    // Каталог ./data, как после `npm run dev`: без него better-sqlite3
    // отказывается открывать файл.
    mkdirSync(join(dir, 'data'), { recursive: true });
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function probe(dir: string, script: string): string {
  return execFileSync(
    process.execPath,
    [
      '-e',
      `const D=require(${JSON.stringify(join(REPO, 'node_modules', 'better-sqlite3'))});
const db=new D(${JSON.stringify(join(dir, 'data', 'ezoffer.db'))});
${script}`,
    ],
    { encoding: 'utf8' },
  );
}

/**
 * scripts/seed.js дублировал схему приложения своей копией, которая разошлась
 * с src/lib/db.ts: в ней не было колонки email_verified, message, external_url
 * и таблицы vacancies. `npm run seed` падал с
 * "table users has no column named email_verified", а каталог вакансий
 * вообще не создавался. Теперь seed берёт схему из createDatabase.
 */
test('seed.js не содержит собственной копии схемы', () => {
  const src = readFileSync(SEED, 'utf8');
  assert.ok(
    !/CREATE TABLE IF NOT EXISTS/i.test(src),
    'seed.js не должен создавать таблицы сам — схема живёт в src/lib/db.ts',
  );
  assert.match(src, /createDatabase/, 'seed.js должен использовать общий createDatabase');
});

test('npm run seed отрабатывает на чистой БД', () => {
  withFreshDb((dir) => {
    const res = runSeed(dir);
    assert.ok(res.ok, `seed упал:\n${res.stderr.slice(0, 600)}`);
    assert.match(res.stdout, /demo@ezoffer\.ru/);
  });
});

test('seed идемпотентен: повторный запуск не плодит дубли', () => {
  withFreshDb((dir) => {
    assert.ok(runSeed(dir).ok);
    assert.ok(runSeed(dir).ok, 'второй запуск должен succeed');
    const out = probe(
      dir,
      `console.log(JSON.stringify({
        users: db.prepare("SELECT COUNT(*) c FROM users").get().c,
        resumes: db.prepare("SELECT COUNT(*) c FROM resumes").get().c,
        letters: db.prepare("SELECT COUNT(*) c FROM letters").get().c,
        searches: db.prepare("SELECT COUNT(*) c FROM searches").get().c,
        consultations: db.prepare("SELECT COUNT(*) c FROM consultations").get().c,
      }));`,
    );
    const counts = JSON.parse(out.trim());
    assert.equal(counts.users, 1);
    assert.equal(counts.resumes, 1);
    assert.equal(counts.letters, 1);
    assert.equal(counts.searches, 1);
    assert.equal(counts.consultations, 1);
  });
});

test('seed создаёт схему, которой раньше не хватало (regression)', () => {
  withFreshDb((dir) => {
    assert.ok(runSeed(dir).ok);
    const out = probe(
      dir,
      `const users=db.prepare("PRAGMA table_info(users)").all().map(c=>c.name);
       const apps=db.prepare("PRAGMA table_info(applications)").all().map(c=>c.name);
       const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t=>t.name);
       console.log(JSON.stringify({
         email_verified: users.includes("email_verified"),
         message: apps.includes("message"),
         external_url: apps.includes("external_url"),
         vacancies: tables.includes("vacancies"),
       }));`,
    );
    const schema = JSON.parse(out.trim());
    assert.equal(schema.email_verified, true, 'login требует email_verified');
    assert.equal(schema.message, true, 'applications.message используется API');
    assert.equal(schema.external_url, true, 'applications.external_url используется API');
    assert.equal(schema.vacancies, true, 'без vacancies каталог пуст');
  });
});

test('seed создаёт каталог данных, если его нет', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ezoffer-seed-nodata-'));
  try {
    // Без mkdir ./data: better-sqlite3 бросает "directory does not exist".
    const res = runSeed(dir);
    assert.ok(res.ok, `seed не создал каталог data:\n${res.stderr.slice(0, 400)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seed уважает EZOFFER_DB_PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ezoffer-seed-env-'));
  try {
    const target = join(dir, 'custom', 'nested.db');
    mkdirSync(join(dir, 'custom'), { recursive: true });
    const prev = process.env.EZOFFER_DB_PATH;
    process.env.EZOFFER_DB_PATH = target;
    try {
      const res = runSeed(dir);
      assert.ok(res.ok, `seed упал:\n${res.stderr.slice(0, 400)}`);
    } finally {
      if (prev === undefined) delete process.env.EZOFFER_DB_PATH;
      else process.env.EZOFFER_DB_PATH = prev;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
