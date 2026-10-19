import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Важно: ни одного статического импорта модулей, которые тянут ./db.
 *
 * `db` создаётся в момент импорта, а EZOFFER_DB_PATH выставляется в before().
 * Статический импорт telegram.ts наверху файла поднял бы БД раньше, чем путь
 * задан, — и тест писал бы в рабочую базу. Ровно это случилось с тестом
 * хранения отчёта в этой же сессии.
 *
 * Без helpers/route-session: он поднимает mock.module, который требует флага
 * --experimental-test-module-mocks. Здесь аутентификация не нужна — бот работает
 * по chat_id из апдейта, а сессия подменяется строкой telegram_chat_id.
 */

let escapeHtml: (s: string) => string;
let resetCatalogCache: () => void;
let resetPacing: () => void;

/**
 * Кнопки и форматирование в боте.
 *
 * До этого бот отправлял голый текст: ни кнопок, ни ссылок, ни выделения.
 * Человек обязан был помнить синтаксис («/отклик 2») и угадывать, есть ли
 * такой номер, — а промах по цифре означает отклик на чужую вакансию.
 *
 * Проверяется не наличие клавиатуры, а то, что нажатие на неё приводит к
 * действию: кнопка, которая выглядит рабочей и молчит, хуже отсутствующей.
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;

let db: Database;
let bot: typeof import('../src/lib/telegram-bot');
let sent: { chatId: string; text: string; keyboard?: unknown; parseMode?: string }[];
let edited: { chatId: string; messageId: number; text: string }[];
let answered: { id: string; text?: string }[];

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  /*
   * Рабочее окно расширено на весь час.
   *
   * Бот отправляет отклик через applyToVacancy, и там рабочее окно 9:00–20:00:
   * ночью отклик не уходит, как и задумано. Через handleUpdate часы не
   * подменить, поэтому окно раскрывается переменными окружения — это штатная
   * настройка сервиса, а не обход проверки.
   */
  process.env.AUTOAPPLY_WORK_START = '0';
  // 24, а не 23: workEndHour() допускает 24, а при 23 час 23 всё ещё
  // считается ночным.
  process.env.AUTOAPPLY_WORK_END = '24';
  db = (await import('../src/lib/db')).db;
  bot = await import('../src/lib/telegram-bot');
  escapeHtml = (await import('../src/lib/telegram')).escapeHtml;
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

    if (u.includes('/sendMessage')) {
      sent.push({
        chatId: String(body.chat_id ?? ''),
        text: String(body.text ?? ''),
        keyboard: body.reply_markup,
        parseMode: body.parse_mode as string | undefined,
      });
      return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
    }
    if (u.includes('/editMessageText')) {
      edited.push({
        chatId: String(body.chat_id ?? ''),
        messageId: Number(body.message_id),
        text: String(body.text ?? ''),
      });
      return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
    }
    if (u.includes('/answerCallbackQuery')) {
      answered.push({ id: String(body.callback_query_id ?? ''), text: body.text as string });
      return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
    }
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
  }) as typeof globalThis.fetch;
});

beforeEach(() => {
  /*
   * Порядок обязателен: resumes и searches ссылаются на users, поэтому дети
   * удаляются раньше родителя — иначе SQLITE_CONSTRAINT_FOREIGNKEY.
   */
  db.exec(
    'DELETE FROM applications; DELETE FROM searches; DELETE FROM resumes; DELETE FROM users; DELETE FROM vacancies;',
  );
  // getCatalog() кэширует выборку на 30 секунд и сам сбрасывается только при
  // записи через upsertMany. Прямая вставка в SQL кэш не трогает, и каталог
  // молча не показывает вакансии из текущего теста — а из предыдущего.
  resetCatalogCache();
  /*
   * Паузер тоже живёт в кэше по пользователю. Без сброса отказ, пойманный
   * одним тестом, переходил в следующий: backoff и счётчик отказов не обнулялись,
   * и проверка «нажатие отправляет отклик» падала, хотя код исправен.
   */
  resetPacing();
  sent = [];
  edited = [];
  answered = [];
  bot.resetSeenUpdates();
});

function seedUser(over: Record<string, unknown> = {}): void {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, hh_token,
       hh_resume_id, telegram_chat_id, autoapply_paused, mode)
     VALUES (1, 'u@example.test', 'h', 'pro', ?, ?, 'user-token', 'res123', '777', ?, 'live')`,
  ).run(Date.now() + 100_000, Date.now(), (over.autoapply_paused as number) ?? 0);
  db.prepare(
    `INSERT INTO resumes (user_id, title, content, hh_id, created_at, updated_at)
     VALUES (1, 'Frontend', 'React, TypeScript, Next.js', 'hh-front', ?, ?)`,
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
     VALUES (?, 'hh', ?, ?, 'Компания', '200000', 200000, 300000, 'Middle', 'Удалённо', 'Москва',
       'сегодня', ?, 'Разработка', 'Требуются: React, TypeScript', '[]', '["React","TypeScript"]', '[]', NULL, NULL, ?)`,
  ).run(slug, slug, title, Date.now(), Date.now());
}

async function click(data: string, messageId = 100) {
  await bot.handleUpdate({
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: { id: 'cb1', data, message_id: messageId, chat: { id: 777 } },
  });
}

// ------------------------------------------------------------------ экранирование

/**
 * Данные с площадки экранируются.
 *
 * Название вакансии приходит извне и может содержать «<», «>» или «&».
 * Неэкранированная строка ломает разметку всего сообщения — Telegram отвергнет
 * его целиком, и человек не получит ни ответа, ни кнопок.
 */
test('спецсимволы в данных не ломают разметку', () => {
  assert.equal(escapeHtml('A & B'), 'A &amp; B');
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  // Амперсанд экранируется первым: иначе «&lt;» превратится в «&amp;lt;».
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('название вакансии с угловыми скобками не ломает сообщение', async () => {
  seedUser();
  seedVacancy('hh-xss', 'React <dev> & co');

  await bot.handleUpdate({ update_id: 1, message: { chat: { id: 777 }, text: '/подбор' } });
  assert.ok(sent.length > 0, 'подбор не ответил');
  const last = sent[sent.length - 1]!;
  assert.ok(!last.text.includes('<dev>'), `неэкранированные данные в сообщении: ${last.text}`);
  assert.ok(last.text.includes('&lt;dev&gt;'), `данные потеряны: ${last.text}`);
});

// ------------------------------------------------------------------ клавиатуры

test('у справки есть кнопки', async () => {
  seedUser();
  await bot.handleUpdate({ update_id: 2, message: { chat: { id: 777 }, text: '/помощь' } });

  const kb = sent[sent.length - 1]!.keyboard as
    { inline_keyboard: { text: string; data?: string; url?: string }[][] } | undefined;
  assert.ok(kb, 'у справки нет кнопок — человек обязан помнить команды');
  const labels = kb!.inline_keyboard.flat().map((b) => b.text);
  assert.ok(labels.length >= 2, `кнопок слишком мало: ${JSON.stringify(labels)}`);
});

test('подбор даёт кнопку на каждую вакансию', async () => {
  seedUser();
  seedVacancy('hh-r1', 'React-разработчик');
  seedVacancy('hh-r2', 'React-инженер');

  await bot.handleUpdate({ update_id: 3, message: { chat: { id: 777 }, text: '/подбор' } });
  const kb = sent[sent.length - 1]!.keyboard as
    { inline_keyboard: { text: string; data?: string }[][] } | undefined;
  assert.ok(kb, 'у подбора нет кнопок');

  const applyButtons = kb!.inline_keyboard.flat().filter((b) => b.data?.startsWith('apply:'));
  assert.ok(applyButtons.length >= 2, `кнопок отклика ${applyButtons.length} вместо 2`);
  assert.equal(applyButtons[0]!.data, 'apply:1');
});

test('подпись кнопки содержит номер и название', () => {
  const kb = bot.keyboardFor([{ title: 'Senior React Developer', company: 'Авито' }]);
  const label = kb!.inline_keyboard[0]![0]!.text;
  assert.match(label, /^1\./, `в подписи нет номера: ${label}`);
  assert.ok(label.includes('Авито'), `в подписи нет компании: ${label}`);
});

test('длинная подпись обрезается, а не вылезает за экран', () => {
  const kb = bot.keyboardFor([
    { title: 'Очень длинное название вакансии '.repeat(6), company: 'К' },
  ]);
  const label = kb!.inline_keyboard[0]![0]!.text;
  assert.ok(
    label.length <= 36,
    `подпись длиной ${label.length} — Telegram обрежет её сам, но многоточие не на месте`,
  );
});

test('подбор ограничен пятью вакансиями и говорит об этом', async () => {
  seedUser();
  for (let i = 0; i < 9; i++) seedVacancy(`hh-m${i}`, `React-разработчик ${i}`);

  await bot.handleUpdate({ update_id: 4, message: { chat: { id: 777 }, text: '/подбор' } });
  const kb = sent[sent.length - 1]!.keyboard as { inline_keyboard: { data?: string }[][] };
  const applyButtons = kb.inline_keyboard.flat().filter((b) => b.data?.startsWith('apply:'));
  assert.ok(
    applyButtons.length <= 5,
    `показано ${applyButtons.length} вакансий — список не читают`,
  );

  const text = sent[sent.length - 1]!.text;
  assert.match(text, /ещё|еще/i, 'не сказано, что список неполный — это молчаливое усечение');
});

// ------------------------------------------------------------------ нажатия

test('нажатие на кнопку подбора открывает подбор, а не молчит', async () => {
  seedUser();
  seedVacancy('hh-c1', 'React-разработчик');

  await click('menu:search');
  assert.ok(edited.length > 0, 'сообщение не изменилось — нажатие ничего не сделало');
  assert.match(edited[0]!.text, /Подбор/i, 'нажатие открыло не подбор');
});

test('нажатие подтверждается — иначе кнопка «часит» и её жмут ещё раз', async () => {
  /*
   * Без answerCallbackQuery Telegram держит «часики» на кнопке, пока бот думает.
   * Человек нажимает повторно — это второй отклик на ту же вакансию.
   *
   * Проверяются ВСЕ кнопки, а не одна: ветки обработки разные, и раньше
   * подтверждение подтверждалось только в одной из них.
   */
  seedUser();
  for (const [data, label] of [
    ['menu:stats', 'статистика'],
    ['menu:pause', 'пауза'],
    ['menu:resume', 'продолжить'],
    ['menu:search', 'подбор'],
    ['menu:help', 'помощь'],
  ] as const) {
    answered = [];
    await click(data);
    assert.ok(
      answered.length > 0,
      `кнопка «${label}» не подтвердила нажатие — будет выглядеть зависшей`,
    );
  }
});

test('нажатие меняет сообщение на месте, а не шлёт новое', async () => {
  /*
   * Новое сообщение после каждого нажатия превращало бы переписку в стопку
   * одинаковых сообщений, и нужный ответ уезжал бы наверх.
   *
   * Проверяется на паузе и статистике: это разные ветки обработки, и правка
   * на месте должна работать в обеих.
   */
  seedUser();
  for (const data of ['menu:stats', 'menu:pause']) {
    sent = [];
    edited = [];
    await click(data);
    assert.equal(
      sent.length,
      0,
      `${data}: отправлено ${sent.length} новых сообщений вместо правки`,
    );
    assert.equal(edited.length, 1, `${data}: сообщение не изменено`);
    assert.equal(edited[0]!.messageId, 100, `${data}: изменено не то сообщение`);
  }
});

test('нажатие «Пауза» реально останавливает отправку', async () => {
  seedUser();
  await click('menu:pause');

  const row = db.prepare('SELECT autoapply_paused FROM users WHERE id = 1').get() as {
    autoapply_paused: number;
  };
  assert.equal(row.autoapply_paused, 1, 'кнопка паузы не изменила состояние');

  const text = edited[0]?.text ?? sent[sent.length - 1]?.text ?? '';
  assert.match(text, /пауз/i, 'ответ не сообщает о результате');
});

test('нажатие «Продолжить» снимает паузу', async () => {
  seedUser({ autoapply_paused: 1 });
  await click('menu:resume');
  const row = db.prepare('SELECT autoapply_paused FROM users WHERE id = 1').get() as {
    autoapply_paused: number;
  };
  assert.equal(row.autoapply_paused, 0, 'кнопка не сняла паузу');
});

test('нажатие на отклик отправляет отклик', async () => {
  seedUser();
  seedVacancy('hh-a1', 'React-разработчик');

  // Перехватываем запрос к hh, чтобы отклик ушёл, а не упал.
  const savedFetch = globalThis.fetch;
  let sentToHh = false;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('api.hh.ru/negotiations')) {
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
    return savedFetch(url, init);
  }) as typeof globalThis.fetch;

  try {
    await click('apply:1');
  } finally {
    globalThis.fetch = savedFetch;
  }

  assert.ok(sentToHh, 'нажатие на «откликнуться» не отправило отклик');
  const apps = (db.prepare('SELECT COUNT(*) AS c FROM applications').get() as { c: number }).c;
  assert.equal(apps, 1, 'отклик не записан в историю');
});

test('нажатие без привязки объясняет, что делать', async () => {
  await click('menu:stats');
  assert.ok(sent.length + edited.length > 0, 'нажатие без привязки не получило ответа');
  const text = sent.map((s) => s.text).join('\n');
  assert.match(text, /привян|привяза/i, 'не сказано, что аккаунт не привязан');
});

test('устаревшая кнопка не выглядит как поломка', () => {
  // Кнопка из старого сообщения приходит с номером, которого уже нет в подборе.
  // Молчание читалось бы как «бот сломался».
  const reply = bot.replyFor('отклик', '99', null);
  assert.ok(reply.text.length > 0, 'на несуществующий номер нет ответа');
});

test('сообщения бота не содержат незакрытой разметки', async () => {
  seedUser();
  seedVacancy('hh-m1', 'React-разработчик');
  for (const cmd of ['/подбор', '/статистика', '/помощь']) {
    await bot.handleUpdate({
      update_id: 100 + cmd.length,
      message: { chat: { id: 777 }, text: cmd },
    });
  }
  for (const s of [...sent, ...edited]) {
    const open = (s.text.match(/<b>/g) ?? []).length;
    const close = (s.text.match(/<\/b>/g) ?? []).length;
    assert.equal(open, close, `незакрытое выделение: ${s.text.slice(0, 120)}`);
  }
});
