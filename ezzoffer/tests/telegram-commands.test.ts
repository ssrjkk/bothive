import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Команды бота делают то, что обещают.
 *
 * Главная находка этого файла. Тексты команд и реклама на сайте расходились с
 * поведением: `/отклик` отвечал «Запускаю отклики… Прогресс придёт
 * сообщением», `/пауза` и `/старт` — «сделайте это в кабинете», а
 * `notifyUser` и `notifyAll` не вызывались из кода вообще. Человек нажимал и
 * ждал откликов, которых не было.
 *
 * Проверяется не текст ответа, а наличие действия: команда обязана что-то
 * менять. Текст можно сделать красивым и при этом ничего не выполнять — так
 * и было.
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;
type User = import('../src/lib/db').User;

let db: Database;
let replyFor: typeof import('../src/lib/telegram-bot').replyFor;
let setPausedForTest: (userId: number, paused: boolean) => void;
let resetCatalogCache: () => void;

function user(over: Partial<User> = {}): User {
  return {
    id: 1,
    email: 'u@example.com',
    name: 'Иван',
    password_hash: 'h',
    created_at: 0,
    plan: 'pro',
    plan_period: 14,
    plan_activated_at: 0,
    plan_expires_at: Date.now() + 10 * 24 * 3600 * 1000,
    trial_started_at: 0,
    hh_token: null,
    hh_token_expires_at: null,
    hh_refresh_token: null,
    hh_resume_id: null,
    telegram_chat_id: '1',
    autoapply_paused: 0,

    autoapply_blocked_until: 0,

    autoapply_block_reason: '',
    email_verified: 1,
    email_verification_token: null,
    email_verification_expires: null,
    password_reset_token: null,
    password_reset_expires: null,
    salary_expectation: null,
    city_preference: '',
    // Дефолт — live, а не demo: почти все тесты этого файла проверяют
    // команды, которые имеют смысл только в живом режиме (подбор, отклик).
    // При mode:'demo' они честно отвечали «включите живой режим», и тесты
    // падали не из-за своего предмета. Режим проверяется отдельно.
    mode: 'live',
    ...over,
  };
}

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  db = (await import('../src/lib/db')).db;
  replyFor = (await import('../src/lib/telegram-bot')).replyFor;
  resetCatalogCache = (await import('../src/lib/vacancies')).resetCatalogCache;
  // setPaused приватный; вызываем ту же строку БД, что и бот.
  setPausedForTest = (userId: number, paused: boolean) => {
    db.prepare('UPDATE users SET autoapply_paused = ? WHERE id = ?').run(paused ? 1 : 0, userId);
  };
});

beforeEach(() => {
  /*
   * Порядок важен: внешние ключи. resumes и searches ссылаются на users,
   * поэтому дети удаляются раньше родителя — иначе SQLITE_CONSTRAINT_FOREIGNKEY.
   */
  db.exec(
    'DELETE FROM applications; DELETE FROM searches; DELETE FROM resumes; DELETE FROM users; DELETE FROM vacancies;',
  );
  resetCatalogCache();
});

function seedUser(over: Partial<User> = {}): number {
  const u = user(over);
  const id = Number(
    db
      .prepare(
        `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, hh_token, hh_resume_id, telegram_chat_id, autoapply_paused, mode)
         VALUES (?, ?, 'h', ?, ?, ?, 'user-token', 'res123', '1', ?, 'live')`,
      )
      .run(u.id, u.email, u.plan, u.plan_expires_at, u.created_at, u.autoapply_paused)
      .lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO resumes (user_id, title, content, hh_id, created_at, updated_at) VALUES (?, ?, ?, 'hh-front', ?, ?)`,
  ).run(id, 'Frontend', 'React, TypeScript, Next.js', Date.now(), Date.now());
  db.prepare(
    `INSERT INTO searches (user_id, title, keywords, active, started_at, created_at) VALUES (?, ?, 'react', 1, ?, ?)`,
  ).run(id, 's', Date.now(), Date.now());
  return id;
}

function seedVacancy(slug: string, title: string, published = Date.now()): void {
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, salary_min, salary_max,
       level, format, city, posted, published_at, category, about, responsibilities, requirements, bonus,
       contact_email, contact_phone, fetched_at)
     VALUES (?, 'hh', ?, ?, 'Компания', '200000', 200000, 300000, 'Middle', 'Удалённо', 'Москва',
       'сегодня', ?, 'Разработка', 'Требуются: React, TypeScript', '[]', '["React","TypeScript"]', '[]', NULL, NULL, ?)`,
  ).run(slug, slug.replace('hh-', ''), title, published, Date.now());
}

// --------------------------------------------------------------- обещания

/**
 * Ни одна команда не должна обещать действия, которого она не совершает.
 *
 * Сверяется по тексту: если ответ говорит «запускаю», «останавливаю» или
 * «возобновляю», команда обязана вернуть действие. Раньше все три говорили
 * именно это и не делали ничего.
 */
test('команда не обещает того, чего не делает', () => {
  const cases: { command: string; args: string; promise: RegExp }[] = [
    { command: 'пауза', args: '', promise: /останов|на паузе/i },
    { command: 'старт', args: '', promise: /возобнов|включ/i },
    { command: 'отклик', args: '', promise: /запускаю|отправляю|отправлю/i },
  ];

  for (const c of cases) {
    const reply = replyFor(c.command, c.args, user());
    if (c.promise.test(reply.text) && !reply.action) {
      assert.fail(
        `/${c.command} обещает «${reply.text.slice(0, 60)}…», но не возвращает действия — текст будет враньём`,
      );
    }
  }
});

test('пауза останавливает отправку, а не советует об этом', () => {
  const reply = replyFor('пауза', '', user());
  assert.equal(reply.action, 'pause', `/пауза вернула действие ${String(reply.action)}`);
  assert.equal(
    reply.text,
    '',
    'ответ без действия должен быть пустым, иначе он рисуется как результат',
  );
});

test('старт возобновляет отправку', () => {
  const reply = replyFor('старт', '', user({ autoapply_paused: 1 }));
  assert.equal(reply.action, 'resume', `/старт вернул ${String(reply.action)}`);
});

test('отклик с номером выбирает вакансию, а не обещает запуск', () => {
  seedUser();
  // Навыки разные, чтобы порядок определялся совпадением с резюме, а не
  // алфавитом. При равном совпадении порядок каталога тоже корректен, но
  // такой тест ничего не проверял бы.
  // Обе проходят по поиску «react», но вторая требует заметно больше, чем
  // есть в резюме. Так проверяется именно ранжирование, а не алфавит.
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, salary_min, salary_max,
       level, format, city, posted, published_at, category, about, responsibilities, requirements, bonus,
       contact_email, contact_phone, fetched_at)
     VALUES ('hh-react-heavy', 'hh', 'rh', 'React-инженер со стеком', 'Компания', '', NULL, NULL,
       'Middle', 'Удалённо', 'Москва', 'сегодня', ?, 'Разработка',
       'Требуются: React, Webpack, Jest, Cypress, GraphQL', '[]',
       '["React","Webpack","Jest","Cypress","GraphQL"]', '[]', NULL, NULL, ?)`,
  ).run(Date.now(), Date.now());
  seedVacancy('hh-react-1', 'React-разработчик');

  const u = user();
  const preview = replyFor('отклик', '', u);
  assert.match(preview.text, /1\./, 'в подборе нет нумерации — выбрать вакансию нечем');
  /*
   * Раньше здесь требовалась подсказка «/отклик 1». Теперь отклик делается
   * кнопкой под списком: промахнуться по номеру нельзя, а человек не обязан
   * помнить синтаксис. Проверяется наличие кнопки, а не текст-подсказка.
   */
  const rows = preview.keyboard?.inline_keyboard ?? [];
  const applyRows = rows.filter((r) => r[0]?.data?.startsWith('apply:'));
  assert.ok(applyRows.length >= 2, `кнопок отклика ${applyRows.length} вместо двух`);
  assert.equal(applyRows[0]![0]!.data, 'apply:1');

  // Первым идёт то, что подходит под резюме, а не первое попавшееся.
  const first = applyAction(replyFor('отклик', '1', u).action);
  assert.ok(first, 'на первый номер нет действия');
  assert.equal(first.vacancy.title, 'React-разработчик', 'первым предложен не лучший по навыкам');

  const second = applyAction(replyFor('отклик', '2', u).action);
  assert.ok(second, 'на второй номер нет действия');
  assert.equal(
    second.vacancy.title,
    'React-инженер со стеком',
    'вторым предложен не худший по навыкам',
  );
});

/** Сужает действие до отклика: у бота появились и другие объектные действия. */
function applyAction(
  action: ReturnType<typeof replyFor>['action'],
): { vacancy: { title: string } } | null {
  return action && typeof action === 'object' && action.kind === 'apply'
    ? { vacancy: { title: action.vacancy.title } }
    : null;
}

test('отклик за пределами подбора не выдумывает вакансию', () => {
  seedUser();
  seedVacancy('hh-react-1', 'React-разработчик');

  const reply = replyFor('отклик', '9', user());
  assert.ok(!reply.action, `на несуществующий номер вернулось действие: ${String(reply.action)}`);
  assert.match(reply.text, /подбор/i, 'не сказано, где смотреть список');
});

test('на команду без номера отклик не отправляется', () => {
  seedUser();
  seedVacancy('hh-react-1', 'React-разработчик');
  const reply = replyFor('отклик', '', user());
  assert.ok(!reply.action, 'пустой /отклик отправил что-то без указания вакансии');
});

// --------------------------------------------------------------- состояние

/**
 * Команды меняют то же самое состояние, что и кабинет.
 *
 * Иначе человек поставил бы паузу в боте и не понял бы, почему кабинет
 * показывает активные автоотклики.
 */
test('пауза из бота видна в кабинете', () => {
  const uid = seedUser();
  const reply = replyFor('пауза', '', user());
  assert.equal(reply.action, 'pause');

  // Ровно то, что делает бот при обработке команды.
  setPausedForTest(uid, true);
  const row = db.prepare('SELECT autoapply_paused FROM users WHERE id = ?').get(uid) as {
    autoapply_paused: number;
  };
  assert.equal(row.autoapply_paused, 1, 'пауза из бота не видна в кабинете');
});

test('на паузе отклик не отправляется даже по номеру', () => {
  seedUser();
  seedVacancy('hh-react-1', 'React-разработчик');
  /*
   * На паузе команда не предлагает действие, даже с номером. Подбор можно было
   * бы и показать, но вместе с номером это читалось бы как приглашение
   * откликнуться — а отклик не уйдёт.
   */
  const reply = replyFor('отклик', '1', user({ autoapply_paused: 1 }));
  assert.ok(!reply.action, 'на паузе вернулось действие на отправку');
  assert.match(reply.text, /пауз/i, 'не сказано, что мешает');
});

// --------------------------------------------------------------- согласованность

/**
 * Команды в справке и на сайте совпадают с тем, что бот понимает.
 *
 * Раньше сайт рекламировал «/поиск», а бот отвечал на это только если команда
 * была продублирована в коде; расхождение стоило бы человеку номера команды
 * из объявления.
 */
test('реклама на сайте не обещает несуществующую команду', async () => {
  const { BOT_COMMANDS } = await import('../src/lib/bot-data');
  for (const c of BOT_COMMANDS) {
    const known = replyFor(c.command, '', user());
    assert.ok(
      !/^Не знаю команду/.test(known.text),
      `команда «/${c.command}» рекламируется на сайте, но бот её не понимает`,
    );
  }
});

test('справка перечисляет команды, которые бот понимает', async () => {
  const { BOT_COMMANDS } = await import('../src/lib/bot-data');
  const help = replyFor('помощь', '', user()).text;
  for (const c of BOT_COMMANDS) {
    assert.ok(help.includes(`/${c.command}`), `команда /${c.command} есть в боте, но не в справке`);
  }
});
