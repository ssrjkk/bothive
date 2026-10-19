import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Ограничение аккаунта площадкой — сквозной путь.
 *
 * Отдельные функции проверяются в anti-ban-classification.test.ts. Здесь
 * важно другое: что ограничение не теряется между тиками планировщика и что
 * человек узнаёт о нём раньше, чем потеряет отклики.
 *
 * Важно про обходы: `db` создаётся в момент импорта, а путь к базе задаётся в
 * before(). Статический импорт autoapply наверху файла поднял бы БД раньше, чем
 * путь задан, — и тест писал бы в рабочую базу.
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;

let db: Database;
let autoapply: typeof import('../src/lib/autoapply');
let bot: typeof import('../src/lib/telegram-bot');
let sent: { chatId: string; text: string }[];
let resetCatalogCache: () => void;

const BLOCK_UNTIL = Date.now() + 6 * 60 * 60 * 1000;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  db = (await import('../src/lib/db')).db;
  resetCatalogCache = (await import('../src/lib/vacancies')).resetCatalogCache;
  autoapply = await import('../src/lib/autoapply');
  bot = await import('../src/lib/telegram-bot');

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    /*
     * Кнопки правят сообщение на месте, а не отправляют новое, поэтому ловится
     * и editMessageText. Без него нажатие выглядело бы как «бот ничего не
     * ответил», и тест падал бы не из-за поведения, а из-за заглушки.
     */
    if (u.includes('/sendMessage') || u.includes('/editMessageText')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      sent.push({ chatId: String(body.chat_id ?? ''), text: String(body.text ?? '') });
    }
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
  }) as typeof globalThis.fetch;
});

beforeEach(() => {
  // Порядок обязателен: дети удаляются раньше родителя.
  db.exec(
    'DELETE FROM applications; DELETE FROM searches; DELETE FROM resumes; DELETE FROM users; DELETE FROM vacancies;',
  );
  /*
   * getCatalog() кэширует выборку на 30 секунд и сам сбрасывается только
   * при записи через upsertMany. Прямая вставка в SQL кэш не трогает, и подбор
   * молча показывает вакансии из предыдущего теста, а не текущего. Из-за
   * этого тест с двумя вакансиями видел одну и цикл не доходил до паузы.
   */
  resetCatalogCache();
  sent = [];
  bot.resetSeenUpdates();
});

function seedUser(): void {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, hh_token,
       hh_resume_id, telegram_chat_id, autoapply_paused, autoapply_blocked_until, autoapply_block_reason, mode)
     VALUES (1, 'u@example.test', 'h', 'pro', ?, ?, 'user-token', 'res123', '777', 0, 0, '', 'live')`,
  ).run(Date.now() + 100_000, Date.now());

  db.prepare(
    `INSERT INTO resumes (user_id, title, content, hh_id, created_at, updated_at)
     VALUES (1, 'Frontend', 'React', 'hh-front', ?, ?)`,
  ).run(Date.now(), Date.now());

  db.prepare(
    "INSERT INTO searches (user_id, title, keywords, active, started_at, created_at) VALUES (1, 's', 'react', 1, ?, ?)",
  ).run(Date.now(), Date.now());
}

/** Ставит ограничение так, как это делает планировщик после 403. */
function blockAccount(until = BLOCK_UNTIL, reason = 'hh.ru ограничил доступ к аккаунту'): void {
  db.prepare(
    'UPDATE users SET autoapply_blocked_until = ?, autoapply_block_reason = ? WHERE id = 1',
  ).run(until, reason);
}

/**
 * Паузер без пауз и с круглосуточным рабочим днём.
 *
 * `workStartHour`/`workEndHour` закреплены, потому что иначе результат теста
 * зависит от времени запуска: ночью паузер честно отказывается отправлять, и
 * прогоны на настоящем 403 или 429 просто не доходили до отправки. Тесты
 * проходили утром и падали вечером — и выглядели при этом исправными.
 */
/** Полдень сегодняшнего дня: любое время суток одинаково годно для прогона. */
const NOON = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime();
})();

const FAST_PACING = {
  pacing: { minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 },
  now: () => NOON,
};

/** Действует ли ограничение прямо сейчас. */
function isBlocked(): boolean {
  return autoapply.blockedUntil(1) > 0;
}

// ------------------------------------------------------------- классификация

test('403 от hh остановливает аккаунт, а сетевой сбой — нет', () => {
  assert.equal(autoapply.toFailureKind('auth'), 'blocked');
  assert.equal(autoapply.toFailureKind('rate_limit'), 'rate_limit');
  assert.equal(autoapply.toFailureKind('network'), 'network');
  assert.equal(autoapply.toFailureKind('other'), 'network');
});

test('закрытая вакансия не считается отказом площадки', () => {
  assert.equal(
    autoapply.toFailureKind('closed'),
    'network',
    'закрытая вакансия не должна попадать в паузер — её и не отправляют',
  );
});

test('истёкший токен не останавливает аккаунт', () => {
  /*
   * 401 — это не ограничение площадки. Если считать его блокировкой, человек с
   * истёкшим токеном получил бы шесть часов ожидания вместо минутной
   * перепривязки, и отклики стояли бы впустую.
   */
  assert.notEqual(
    autoapply.toFailureKind('token'),
    'blocked',
    'истёкший токен снова блокирует аккаунт на часы',
  );
  assert.equal(
    autoapply.toFailureKind('token'),
    autoapply.toFailureKind('rate_limit'),
    'истёкший токен должен ждать так же, как просьба площадки замедлиться',
  );
});

// ------------------------------------------------------------- сохранение

test('ограничение переживает перезапуск процесса', () => {
  /*
   * Состояние в памяти паузера обнулилось бы при рестарте, и сервис снова
   * пошёл бы откликаться в аккаунт, который hh только что отклонил.
   */
  seedUser();
  blockAccount();

  // Читаем «новым процессом» — напрямую из базы, без кэша в памяти.
  const row = db
    .prepare('SELECT autoapply_blocked_until, autoapply_block_reason FROM users WHERE id = 1')
    .get() as { autoapply_blocked_until: number; autoapply_block_reason: string };

  assert.ok(row.autoapply_blocked_until > Date.now(), 'ограничение не сохранено');
  assert.equal(row.autoapply_block_reason, 'hh.ru ограничил доступ к аккаунту');
  assert.equal(autoapply.blockedUntil(1), row.autoapply_blocked_until);
  assert.equal(autoapply.blockedReason(1), 'hh.ru ограничил доступ к аккаунту');
});

test('истёкшее ограничение не считается действующим', () => {
  seedUser();
  blockAccount(Date.now() - 1000);
  assert.equal(autoapply.blockedUntil(1), 0, 'прошедшее ограничение должно сняться само');
  assert.equal(autoapply.blockedReason(1), 'hh.ru ограничил доступ к аккаунту');
});

test('ограничение не действует на чужой аккаунт', () => {
  seedUser();
  blockAccount();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at,
       autoapply_blocked_until, autoapply_block_reason, mode)
     VALUES (2, 'other@example.test', 'h', 'pro', ?, ?, 0, '', 'live')`,
  ).run(Date.now() + 100_000, Date.now());

  assert.equal(autoapply.blockedUntil(1) > 0, true);
  assert.equal(autoapply.blockedUntil(2), 0, 'ограничение одного аккаунта не действует на другой');
});

// -------------------------------------------------------------------- бот

test('бот не даёт возобновить отклики при ограничении', async () => {
  /*
   * Раньше нажатие «Продолжить» снимало паузу и писало «Отправка
   * возобновлена» — а планировщик тут же упирался в ограничение. Человек ждал
   * бы откликов, которых не будет, и не понимал почему.
   */
  seedUser();
  blockAccount();

  await bot.handleUpdate({
    update_id: 1,
    message: { chat: { id: 777 }, text: '/старт' },
  });

  const text = sent[sent.length - 1]?.text ?? '';
  assert.match(text, /нельзя|огранич/i, `бот ответил «${text}» вместо отказа`);
  assert.doesNotMatch(text, /возобновлена/i, 'бот пообещал возобновление, которого не будет');

  const row = db.prepare('SELECT autoapply_paused FROM users WHERE id = 1').get() as {
    autoapply_paused: number;
  };
  assert.equal(row.autoapply_paused, 0, 'состояние изменилось, хотя возобновить нельзя');
});

test('кнопка «Продолжить» тоже не обходит ограничение', async () => {
  seedUser();
  blockAccount();

  await bot.handleUpdate({
    update_id: 2,
    callback_query: { id: 'cb', data: 'menu:resume', message_id: 5, chat: { id: 777 } },
  });

  const all = [...sent].map((s) => s.text).join('\n');
  assert.match(all, /огранич/i, 'нажатие «Продолжить» не упёрлось в ограничение');
  assert.doesNotMatch(all, /возобновлена/i, 'нажатие пообещало возобновление');
});

test('без ограничения возобновление работает как прежде', async () => {
  seedUser();
  db.prepare('UPDATE users SET autoapply_paused = 1 WHERE id = 1').run();

  await bot.handleUpdate({
    update_id: 3,
    message: { chat: { id: 777 }, text: '/старт' },
  });

  const row = db.prepare('SELECT autoapply_paused FROM users WHERE id = 1').get() as {
    autoapply_paused: number;
  };
  assert.equal(row.autoapply_paused, 0, 'без ограничения возобновление должно сработать');
});

test('остановка по причине блокировки не мешает остальным', () => {
  seedUser();
  blockAccount();

  // Второй пользователь без ограничения должен продолжать работать.
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at,
       hh_token, hh_resume_id, autoapply_blocked_until, autoapply_block_reason, mode)
     VALUES (2, 'other@example.test', 'h', 'pro', ?, ?, 'tok', 'res', 0, '', 'live')`,
  ).run(Date.now() + 100_000, Date.now());

  assert.equal(autoapply.blockedUntil(2), 0);
  assert.equal(autoapply.blockedReason(2), '');
});

// ------------------------------------------------------------- сквозной путь

/**
 * Реальный 403 от hh.
 *
 * Тесты выше проверяют чтение и выбор паузы, но не запись. Поэтому отдельный
 * тест гоняет настоящий runAutoApply с заглушкой hh, отвечающей 403: именно
 * здесь вызывается запись ограничения, и именно её не покрывали остальные
 * проверки — мутация, убирающая запись в базу, проходила незамеченной.
 */
test('403 от hh во время прогона останавливает аккаунт и пишет причину', async () => {
  seedUser();
  seedVacancy('hh-777', 'React-разработчик');
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, level, format, city,
       posted, published_at, category, about, requirements, fetched_at)
     VALUES ('hh-778', 'hh', '778', 'React-инженер', 'Компания', '200000', 'Middle', 'Удалённо',
       'Москва', 'сегодня', ?, 'Разработка', 'Требуются: React', '["React"]', ?)`,
  ).run(Date.now(), Date.now());

  const saved = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/token')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'user-token', expires_in: 3600 }),
      } as unknown as Response;
    }
    if (u.includes('/negotiations')) {
      attempts++;
      // 403 — аккаунт ограничен: дальше отправлять нельзя.
      return {
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ message: 'Доступ ограничен' }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  try {
    await autoapply.runAutoApply(FAST_PACING);
  } finally {
    globalThis.fetch = saved;
  }

  assert.ok(isBlocked(), 'после 403 от hh ограничение должно быть записано в базу');

  const reason = autoapply.blockedReason(1);
  assert.match(reason, /огранич/i, `причина ограничения не записана: «${reason}»`);

  /*
   * Цикл обязан оборваться. Две вакансии в подборе — и если бы ограничение не
   * останавливало прогон, планировщик продолжал бы стучаться в аккаунт, который
   * hh только что отклонил.
   */
  assert.equal(attempts, 1, `в аккаунт ограниченного доступа пошло запросов: ${attempts}`);
});

test('закрытая вакансия не останавливает аккаунт', async () => {
  seedUser();
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, level, format, city,
       posted, published_at, category, about, requirements, fetched_at)
     VALUES ('hh-779', 'hh', '779', 'React-инженер', 'Компания', '200000', 'Middle', 'Удалённо',
       'Москва', 'сегодня', ?, 'Разработка', 'Требуются: React', '["React"]', ?)`,
  ).run(Date.now(), Date.now());

  const saved = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/token')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'user-token', expires_in: 3600 }),
      } as unknown as Response;
    }
    if (u.includes('/negotiations')) {
      attempts++;
      // 404 — вакансию сняли. Это не отказ площадки.
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ message: 'Not found' }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  try {
    await autoapply.runAutoApply(FAST_PACING);
  } finally {
    globalThis.fetch = saved;
  }

  assert.ok(attempts > 0, 'прогон не дошёл до отправки — тест проверяет не то');
  assert.equal(
    isBlocked(),
    false,
    'закрытая вакансия остановила аккаунт: это не отказ платформы, ограничение незачем',
  );
});

/**
 * Retry-After доезжает до паузера.
 *
 * Отдельный тест, потому что проверять метод паузера бесполезно: так и вышло
 * в первый раз. `respectRetryAfter` был написан, проверен вызовом напрямую —
 * и остался мёртвым кодом, потому что из прогона его не звали, а заголовок
 * терялся в HTTP-клиенте. Тесты были зелёные, функции не существовало.
 *
 * Здесь проверяется весь путь: hh отвечает 429 с Retry-After → автоотклик
 * обязан передать срок паузеру. Раньше проверка обрывалась на методе.
 */
test('Retry-After от hh доезжает до паузера', async () => {
  /*
   * Проверяется весь путь, а не сам метод.
   *
   * С отдельной проверкой `respectRetryAfter` вышло ровно так, как можно было
   * не заметить: метод был написан, тесты звали его напрямую и были зелёные —
   * а из прогона его никто не звал, и заголовок терялся в HTTP-клиенте.
   * Функции не существовало.
   *
   * Нужны две вакансии: пауза объявляется на следующем шаге цикла, и с одной
   * вакансией цикл просто заканчивается, ни разу не спросив паузер.
   */
  seedUser();
  seedVacancy('hh-780', 'React-разработчик');
  seedVacancy('hh-781', 'React-инженер');

  const saved = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/token')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'user-token', expires_in: 3600 }),
      } as unknown as Response;
    }
    if (u.includes('/negotiations')) {
      attempts++;
      return {
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '2' }),
        text: async () => JSON.stringify({ message: 'Too many requests' }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  let run: Awaited<ReturnType<typeof autoapply.runAutoApply>> | null = null;
  try {
    run = await autoapply.runAutoApply(FAST_PACING);
  } finally {
    globalThis.fetch = saved;
  }

  assert.ok(attempts > 0, 'прогон не дошёл до отправки — тест проверяет не то');
  assert.equal(run!.pausedFor, 'backoff', 'после 429 отправка должна встать на паузу');

  /*
   * Соблюдение срока — суть проверки.
   *
   * Первая версия заканчивалась на «запрос был» и «аккаунт не заблокирован».
   * Оба проходят и тогда, когда заголовок не читается вовсе: мутация,
   * обнулявшая чтение заголовка, выживала. Теперь смотрим на причину паузы,
   * которую видит человек, — если срок доехал, пауза именно такая, какой её
   * назначили.
   */
  assert.match(
    run!.pausedDetail ?? '',
    /Retry-After/i,
    `пауза не объяснена сроком от площадки: «${run!.pausedDetail}»`,
  );

  /*
   * 429 — это не ограничение аккаунта, его снимать не нужно: пауза снимется сама.
   */
  assert.equal(isBlocked(), false, '429 не должен останавливать аккаунт, как 403');

  /*
   * Цикл обязан оборваться на сроке площадки, а не отстучать обе вакансии.
   */
  assert.equal(attempts, 1, `в ограниченный темп ушло запросов: ${attempts}`);
});

/** Заголовок Retry-After разбирается в обоих видах, которые разрешены. */
test('Retry-After разбирается и как число, и как дата', async () => {
  const http = await import('../src/lib/http-client');

  assert.equal(http.parseRetryAfter('30'), 30_000, 'число секунд не разобрано');
  assert.equal(http.parseRetryAfter('0'), 0, 'ноль не должен означать ожидание');
  assert.equal(http.parseRetryAfter(null), 0);
  assert.equal(http.parseRetryAfter('ерунда'), 0, 'мусор не должен превращаться в ожидание');

  const now = Date.UTC(2026, 0, 6, 12, 0, 0);
  const date = new Date(now + 90_000).toUTCString();
  assert.equal(
    http.parseRetryAfter(date, now),
    90_000,
    `дата из заголовка не разобрана: ${http.parseRetryAfter(date, now)} вместо 90000`,
  );
});

function seedVacancy(slug: string, title: string): void {
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, level, format, city,
       posted, published_at, category, about, requirements, fetched_at)
     VALUES (?, 'hh', ?, ?, 'Компания', '200000', 'Middle', 'Удалённо', 'Москва',
       'сегодня', ?, 'Разработка', 'Требуются: React', '["React"]', ?)`,
  ).run(slug, slug, title, Date.now(), Date.now());
}
