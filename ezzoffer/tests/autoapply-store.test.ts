import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Хранение итога прогона.
 *
 * Отдельный файл, а не блок в autoapply-report.test.ts, из-за порядка загрузки
 * модулей: `db` создаётся в момент импорта, и путь к базе обязан быть задан
 * ДО него. В одном файле с тестами разбора этого не вышло бы — импорт разбора
 * тянет за собой БД раньше, чем тест успевает подменить путь.
 *
 * Такая ошибка уже случилась: тест подставил путь слишком поздно и записал
 * «битую» мета-запись в рабочую базу. Разделение на два модуля (чистый разбор и
 * хранилище) делает такую ошибку структурно невозможной: тест разбора вообще не
 * касается БД.
 */

type AutoApplyRun = import('../src/lib/autoapply').AutoApplyRun;

let saveLastRun: (r: AutoApplyRun, at?: number) => void;
let loadLastRun: () => import('../src/lib/autoapply-report').LastRunReport | null;
let db: import('better-sqlite3').Database;

function run(over: Partial<AutoApplyRun> = {}): AutoApplyRun {
  return {
    ran: true,
    searches: 1,
    applied: 0,
    failed: 0,
    skipped: 0,
    stale: 0,
    pausedFor: null,

    pausedDetail: null,
    pausedUsers: 0,

    blockedUsers: 0,
    withLetter: 0,
    withoutLetter: 0,
    demoUsers: 0,
    erroredUsers: 0,
    ...over,
  };
}

before(async () => {
  // До любого импорта модулей с БД.
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  const store = await import('../src/lib/autoapply-store');
  saveLastRun = store.saveLastRun;
  loadLastRun = store.loadLastRun;
  db = (await import('../src/lib/db')).db;
});

test('до первого прогона отчёта нет', () => {
  assert.equal(loadLastRun(), null, 'отчёт появился без единого прогона');
});

test('прогон сохраняется и читается обратно', () => {
  const at = 1_800_000_000_000;
  saveLastRun(run({ applied: 2, withLetter: 2, stale: 3, failed: 1 }), at);

  const loaded = loadLastRun();
  assert.ok(loaded, 'отчёт не сохранился');
  assert.equal(loaded!.at, at, 'время прогона не сохранилось');
  assert.equal(loaded!.applied, 2, 'число откликов не сохранилось');
  assert.equal(loaded!.stale, 3, 'число устаревших не сохранилось');
  assert.equal(loaded!.failed, 1, 'число неудач не сохранилось');
  assert.ok(loaded!.reasons.length > 0, 'причины не построены при чтении');
});

test('повторный прогон заменяет предыдущий, а не дописывает', () => {
  saveLastRun(run({ applied: 5, withLetter: 5 }), 1_800_000_000_000);
  saveLastRun(run({ applied: 1, withLetter: 1 }), 1_800_000_100_000);

  const loaded = loadLastRun();
  assert.equal(
    loaded!.applied,
    1,
    `в панели показано ${loaded!.applied} — старый прогон не заменён`,
  );
  assert.equal(loaded!.at, 1_800_000_100_000, 'показан старый прогон');
});

test('битая запись не роняет кабинет', () => {
  /*
   * Запись в meta пишется без транзакции и может остаться обрезанной, если
   * процесс убит посреди сохранения. Панель автооткликов — второстепенный блок,
   * и падать из-за него весь кабинет нельзя.
   */
  db.prepare('UPDATE meta SET value = ? WHERE key = ?').run('{не json', 'autoapply:last_run');
  assert.equal(loadLastRun(), null, 'битая запись не обработана — страница упадёт');
});

test('восстановление после битой записи: следующий прогон снова пишется', () => {
  saveLastRun(run({ applied: 3, withLetter: 3 }), 1_800_000_200_000);
  const loaded = loadLastRun();
  assert.ok(loaded, 'после битой записи отчёт перестал сохраняться');
  assert.equal(loaded!.applied, 3);
});
