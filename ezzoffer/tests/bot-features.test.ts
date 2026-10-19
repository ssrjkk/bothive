import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Подготовка к собеседованию, избранное и подсказки в боте.
 *
 * Всё это было в продукте, но доступно только из кабинета. Бот умел найти
 * вакансию и отправить отклик — и на этом человек оставался один перед самым
 * интересным: что спросят.
 *
 * Проверяется поведение, а не наличие команд. Кнопка, которая выглядит
 * рабочей и молчит, хуже отсутствующей — именно так проявилась кнопка паузы
 * в прошлый раз: правка сообщения возвращала `true`, обработчик на этом выходил,
 * а состояние так и не менялось.
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;

let db: Database;
let bot: typeof import('../src/lib/telegram-bot');
let resetCatalogCache: () => void;
let resetPacing: () => void;
let sent: { chatId: string; text: string; keyboard?: unknown }[];

const HOUR = 60 * 60 * 1000;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  // Рабочее окно раскрыто: бот не шлёт ночью, иначе проверки зависели бы от
  // времени запуска.
  process.env.AUTOAPPLY_WORK_START = '0';
  process.env.AUTOAPPLY_WORK_END = '24';

  db = (await import('../src/lib/db')).db;
  bot = await import('../src/lib/telegram-bot');
  resetCatalogCache = (await import('../src/lib/vacancies')).resetCatalogCache;
  resetPacing = (await import('../src/lib/autoapply')).resetPacing;

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = (() => {
      try {
        return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    if (u.includes('/sendMessage') || u.includes('/editMessageText')) {
      sent.push({
        chatId: String(body.chat_id ?? ''),
        text: String(body.text ?? ''),
        keyboard: body.reply_markup,
      });
    }
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
  }) as typeof globalThis.fetch;
});

beforeEach(() => {
  db.exec(
    // Порядок обязателен: bookmarks и applications ссылаются на users, поэтому
    // дети удаляются раньше родителя — иначе SQLITE_CONSTRAINT_FOREIGNKEY.
    'DELETE FROM bookmarks; DELETE FROM applications; DELETE FROM letters; DELETE FROM searches; DELETE FROM resumes; DELETE FROM users; DELETE FROM vacancies;',
  );
  resetCatalogCache();
  resetPacing();
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
     VALUES (1, 'Frontend-разработчик', 'Сократил время загрузки на 40% благодаря оптимизации рендеринга', 'hh-front', ?, ?)`,
  ).run(Date.now(), Date.now());
  db.prepare(
    "INSERT INTO searches (user_id, title, keywords, active, started_at, created_at) VALUES (1, 's', 'react', 1, ?, ?)",
  ).run(Date.now(), Date.now());
}

function seedVacancy(slug: string, title: string): void {
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, salary_min, salary_max,
       level, format, city, posted, published_at, category, about, responsibilities, requirements, bonus,
       contact_email, contact_phone, fetched_at)
     VALUES (?, 'hh', ?, ?, 'Авито', '200000', 200000, 300000, 'Middle', 'Удалённо', 'Москва',
       'сегодня', ?, 'Разработка', 'Требуются: React, TypeScript, Next.js', '[]', '["React","TypeScript","Next.js"]', '[]', NULL, NULL, ?)`,
  ).run(slug, slug, title, Date.now(), Date.now());
}

function seedApplication(slug: string): void {
  db.prepare(
    `INSERT INTO applications (user_id, job_slug, resume_id, letter_id, message, status, sent_at)
     VALUES (1, ?, 'hh-front', NULL, '', 'sent', ?)`,
  ).run(slug, Date.now());
}

function seedBookmark(slug: string): void {
  db.prepare('INSERT INTO bookmarks (user_id, job_slug, created_at) VALUES (1, ?, ?)').run(
    slug,
    Date.now(),
  );
}

async function click(data: string, messageId = 100) {
  await bot.handleUpdate({
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: { id: 'cb1', data, message_id: messageId, chat: { id: 777 } },
  });
}

async function say(text: string) {
  await bot.handleUpdate({
    update_id: Math.floor(Math.random() * 1e9),
    message: { chat: { id: 777 }, text },
  });
}

function lastText(): string {
  return sent[sent.length - 1]?.text ?? '';
}

function labelsOf(msg: (typeof sent)[number]): string[] {
  const kb = msg.keyboard as { inline_keyboard: { text: string }[] } | undefined;
  return (kb?.inline_keyboard ?? []).flat().map((b) => b.text);
}

// --------------------------------------------------- подготовка к собеседованию

test('подготовка к собеседованию даёт вопросы, а не отписку', async () => {
  seedUser();
  seedVacancy('hh-i1', 'Frontend-разработчик');
  seedApplication('hh-i1');

  await say('/собеседование');

  const text = lastText();
  assert.match(text, /Frontend-разработчик/, 'не названа вакансия');
  assert.match(text, /Авито/, 'не названа компания');
  assert.match(text, /Вопросы 1 из/, 'вопросы не показаны');
  assert.ok(text.length > 200, `подготовка слишком короткая: ${text.length} символов`);
});

test('подготовка строится по резюме, а не по общему шаблону', async () => {
  seedUser();
  seedVacancy('hh-i2', 'Frontend-разработчик');
  seedApplication('hh-i2');

  await say('/собеседование');
  const withResume = lastText();

  /*
   * Строка из резюме обязана появиться в ответе.
   *
   * Проверки «ответы различаются» и «есть слово Вопросы» оба проходят и тогда,
   * когда вопросы подставлены константой: меняться будут разделы про стороны и
   * пробелы, а сами вопросы останутся общими. Поэтому проверяется прямая
   * связь: то, что человек написал в резюме, должно попасть в подготовку.
   */
  assert.match(
    withResume,
    /40%/,
    `достижение из резюме не попало в подготовку: ${withResume.slice(0, 200)}`,
  );

  // Убираем достижение с цифрой — подготовка обязана измениться.
  db.prepare(
    "UPDATE resumes SET content = 'Опыт: несколько лет фронтенда' WHERE user_id = 1",
  ).run();
  await say('/собеседование');
  const withoutResume = lastText();

  assert.doesNotMatch(
    withoutResume,
    /40%/,
    'достижение осталось в ответе после того, как убрали его из резюме',
  );
  assert.notEqual(
    withResume,
    withoutResume,
    'подготовка не зависит от резюме — это общий список вопросов, а не личный',
  );
});

test('вопросы листаются кнопкой', async () => {
  seedUser();
  seedVacancy('hh-i3', 'Frontend-разработчик');
  seedApplication('hh-i3');

  await say('/собеседование');
  const first = lastText();
  const buttons = labelsOf(sent[sent.length - 1]!);
  assert.ok(
    buttons.some((b) => /Ещё вопросы/.test(b)),
    `нет кнопки листания: ${buttons.join(', ')}`,
  );

  await click('interview:2');
  const second = lastText();
  assert.notEqual(first, second, 'нажатие «Ещё вопросы» не изменило сообщение');
  assert.match(second, /Вопросы 2 из/, 'вторая страница не показана');
});

test('без откликов подготовка объясняет, что делать дальше', async () => {
  seedUser();
  await say('/собеседование');
  const text = lastText();
  assert.match(text, /нет ни одного отклика/i, `ответ невнятен: ${text.slice(0, 80)}`);
  assert.match(text, /подбор/i, 'не сказано, что делать дальше');
});

test('без резюме подготовка не выдумывает вопросы', async () => {
  seedUser();
  db.prepare('DELETE FROM resumes WHERE user_id = 1').run();
  seedVacancy('hh-i4', 'Frontend-разработчик');
  seedApplication('hh-i4');

  await say('/собеседование');
  assert.match(lastText(), /нет резюме/i, 'вопросы выданы без резюме — выдуманы');
});

test('исчезнувшая вакансия не ломает подготовку', async () => {
  seedUser();
  seedApplication('hh-gone');
  await say('/собеседование');
  assert.match(lastText(), /больше нет в каталоге/i, 'не сказано, что вакансия исчезла');
});

test('у вакансии со «собачьим именем» подготовка не падает', async () => {
  /*
   * Название приходит с площадки и может содержать что угодно. Раньше такие
   * данные шли в сообщение без экранирования и ломали разметку целиком.
   */
  seedUser();
  seedVacancy('hh-i5', 'Rust <dev> & co');
  seedApplication('hh-i5');

  await say('/собеседование');
  const text = lastText();
  assert.ok(!text.includes('<dev>'), `неэкранированные данные в сообщении: ${text.slice(0, 120)}`);
  assert.match(text, /&lt;dev&gt;|&amp;/, 'название потеряно');
});

test('вопросы зависят от вакансии, а не от шаблона', async () => {
  /*
   * Предыдущая проверка ловила зависимость от резюме, но вопросы при этом
   * оставались общей константой: менялись разделы про стороны и пробелы, а сами
   * вопросы — нет. Поэтому сравниваются два разных отклика: у разных вакансий
   * вопросы обязаны различаться.
   */
  seedUser();
  seedVacancy('hh-q1', 'Frontend-разработчик');
  seedApplication('hh-q1');
  await say('/собеседование');
  const frontend = lastText();

  db.prepare('DELETE FROM applications').run();
  seedVacancy('hh-q2', 'Бэкенд-разработчик Go');
  seedApplication('hh-q2');
  await say('/собеседование');
  const backend = lastText();

  assert.notEqual(frontend, backend, 'вопросы одинаковы для разных вакансий');

  /*
   * Сравнивается сам раздел вопросов: он идёт после заголовка «Вопросы N из».
   * По отдельным строкам сравнивать нельзя — вопрос не обязан кончаться
   * вопросительным знаком («Расскажите о себе» — тоже вопрос), и первая версия
   * проверки искала именно знак и therefore ничего не находила.
   */
  const section = (text: string): string => {
    const at = text.indexOf('Вопросы 1 из');
    assert.ok(at >= 0, `раздел вопросов не найден: ${text.slice(0, 160)}`);
    return text.slice(at);
  };
  const a = section(frontend);
  const b = section(backend);
  assert.ok(a.length > 40, `раздел вопросов пуст: ${a}`);
  assert.notEqual(a, b, 'раздел вопросов не зависит от вакансии');
});

test('вопросы заданы вопросами, а не заголовками разделов', async () => {
  seedUser();
  seedVacancy('hh-q3', 'Frontend-разработчик');
  seedApplication('hh-q3');
  await say('/собеседование');
  const text = lastText();
  const at = text.indexOf('Вопросы 1 из');
  const body = at >= 0 ? text.slice(at) : '';
  const questions = (body.match(/^— /gm) ?? []).length;
  assert.ok(questions >= 2, `вопросов в разделе: ${questions}`);
});

// ------------------------------------------------------------------ избранное

test('избранное показывает отложенные вакансии', async () => {
  seedUser();
  seedVacancy('hh-b1', 'React-разработчик');
  seedBookmark('hh-b1');

  await say('/избранное');
  const text = lastText();
  assert.match(text, /React-разработчик/, 'вакансия из избранного не показана');
  assert.match(text, /Авито/, 'компания не показана');
});

test('пустое избранное объясняет, как им пользоваться', async () => {
  seedUser();
  await say('/избранное');
  assert.match(lastText(), /пусто/i);
  assert.ok(labelsOf(sent[sent.length - 1]!).length > 0, 'в пустом избранном некуда нажать');
});

test('отклик из избранного действительно отправляется', async () => {
  seedUser();
  seedVacancy('hh-b2', 'React-разработчик');
  seedBookmark('hh-b2');

  const saved = globalThis.fetch;
  let sentToHh = false;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/negotiations')) {
      sentToHh = true;
      return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
    }
    if (u.includes('/token')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'user-token', expires_in: 3600 }),
      } as unknown as Response;
    }
    return saved(url, init);
  }) as typeof globalThis.fetch;

  try {
    await click('bookmarkApply:1');
  } finally {
    globalThis.fetch = saved;
  }

  assert.ok(sentToHh, 'кнопка отклика из избранного не отправила отклик');
});

test('удаление из избранного убирает вакансию', async () => {
  seedUser();
  seedVacancy('hh-b3', 'React-разработчик');
  seedBookmark('hh-b3');

  await click('bookmarkRemove:hh-b3');
  const row = db.prepare('SELECT COUNT(*) AS c FROM bookmarks WHERE user_id = 1').get() as {
    c: number;
  };
  assert.equal(row.c, 0, 'вакансия осталась в избранном');
});

test('избранное листается кнопкой «Ещё»', async () => {
  /*
   * Ветка `bookmarks:<страница>` достижима только со второй страницы: при одной
   * отложенной вакансии кнопки «Ещё» нет, и обработчик молча не проверялся.
   *
   * Порядок при одинаковом времени вставки не определён, поэтому сравниваются
   * не номера, а множества: обе страницы вместе закрывают все восемь вакансий
   * и не повторяют ни одну. Проверка по номерам была неверной и падала.
   */
  seedUser();
  for (let i = 0; i < 8; i++) {
    seedVacancy(`hh-p${i}`, `Вакансия ${i}`);
    seedBookmark(`hh-p${i}`);
  }

  await say('/избранное');
  const firstPage = lastText();
  assert.match(firstPage, /страница 1 из/, 'первая страница не показана');
  assert.ok(
    labelsOf(sent[sent.length - 1]!).some((b) => b === 'Ещё'),
    'при восьми вакансиях должна быть вторая страница',
  );

  await click('bookmarks:2');
  const secondPage = lastText();
  assert.match(secondPage, /страница 2 из/, 'вторая страница не показана');

  const listed = (text: string): string[] => text.match(/Вакансия \d+/g) ?? [];
  const fromFirst = new Set(listed(firstPage));
  const fromSecond = listed(secondPage);
  assert.ok(fromSecond.length > 0, `вторая страница пустая: ${secondPage}`);
  for (const item of fromSecond) {
    assert.ok(!fromFirst.has(item), `«${item}» показана на обеих страницах`);
  }
  assert.equal(
    fromFirst.size + fromSecond.length,
    8,
    `на страницах ${fromFirst.size + fromSecond.length} вакансий из 8 — часть потеряна`,
  );
});

test('несуществующий номер из избранного не ломает бота', async () => {
  seedUser();
  await click('bookmarkApply:99');
  assert.match(lastText(), /больше нет в каталоге/i);
});

test('избранное другого человека не видно', async () => {
  seedUser();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at,
       telegram_chat_id, autoapply_blocked_until, autoapply_block_reason, mode)
     VALUES (2, 'other@example.test', 'h', 'pro', ?, ?, '888', 0, '', 'live')`,
  ).run(Date.now() + 100_000, Date.now());
  seedVacancy('hh-b4', 'Чужая вакансия');
  db.prepare("INSERT INTO bookmarks (user_id, job_slug, created_at) VALUES (2, 'hh-b4', ?)").run(
    Date.now(),
  );

  await click('bookmarkRemove:hh-b4');
  const row = db.prepare('SELECT COUNT(*) AS c FROM bookmarks WHERE user_id = 2').get() as {
    c: number;
  };
  assert.equal(row.c, 1, 'чужое избранное изменилось — это не изоляция, а дыра');
});

// ------------------------------------------------------------------- меню

test('в главном меню есть собеседование и избранное', () => {
  const labels = bot
    .mainKeyboard()
    .inline_keyboard.flat()
    .map((b) => b.text);
  assert.ok(labels.includes('Собеседование'), `нет кнопки подготовки: ${labels.join(', ')}`);
  assert.ok(labels.includes('Избранное'), `нет кнопки избранного: ${labels.join(', ')}`);
});

test('кнопка «Собеседование» из меню открывает подготовку', async () => {
  seedUser();
  seedVacancy('hh-m1', 'Frontend-разработчик');
  seedApplication('hh-m1');

  await click('menu:interview');
  const text = lastText();
  assert.match(text, /Вопросы 1 из/, `кнопка открыла не подготовку: ${text.slice(0, 90)}`);
});

test('кнопка «Избранное» из меню открывает список', async () => {
  seedUser();
  seedVacancy('hh-m2', 'React-разработчик');
  seedBookmark('hh-m2');

  await click('menu:bookmarks');
  assert.match(lastText(), /React-разработчик/, 'кнопка открыла не избранное');
});

test('подсказки не обещают того, чего нет', async () => {
  seedUser();
  await say('/советы');
  const text = lastText();
  // Без активных поисков подсказки должны говорить о поисках, а не выдумывать.
  assert.ok(text.length > 0, 'нет ответа');
  assert.ok(!/оффер(?!ы|а|ов)/i.test(text), `подсказка обещает оффер: ${text.slice(0, 100)}`);
});

void HOUR;
