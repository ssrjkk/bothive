import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Уведомления в Telegram.
 *
 * Функции `notifyUser` и `notifyAll` были написаны и не вызывались ниоткуда:
 * бот обещал «прогресс придёт сообщением», а сообщения не приходили никогда.
 * Показывать прогресс можно было только в кабинете — то есть ровно тем, кто
 * ради экономии времени и подключал бота.
 *
 * Проверяются два свойства, без которых уведомления вреднее их отсутствия:
 * не спамить и не повторяться.
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;

let db: Database;
let formatDigest: typeof import('../src/lib/telegram-digest').formatDigest;
let digestWindow: typeof import('../src/lib/telegram-digest').digestWindow;
let sendDigests: typeof import('../src/lib/telegram-digest').sendDigests;
let sendAlerts: typeof import('../src/lib/telegram-digest').sendAlerts;
let resetNotificationState: () => void;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  /*
   * Токен обязателен: sendTelegramMessage выходит сразу, если его нет, и
   * возвращает false. Без него проверялось бы «уведомлений нет», а не
   * «уведомления не отправляются» — а это разные вещи.
   */
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  db = (await import('../src/lib/db')).db;
  const digest = await import('../src/lib/telegram-digest');
  formatDigest = digest.formatDigest;
  digestWindow = digest.digestWindow;
  sendDigests = digest.sendDigests;
  sendAlerts = digest.sendAlerts;
  resetNotificationState = digest.resetNotificationState;
  // Перехват fetch ставится до первого вызова: telegram.ts читает глобальный
  // fetch в момент отправки, так что порядок импорта не важен.
});

/**
 * Перехват отправки.
 *
 * Подменить экспорт telegram.ts нельзя: модуль ESM отдаёт привязки только
 * для чтения, да и telegram-digest уже импортировал sendTelegramMessage по
 * значению. Поэтому перехватывается fetch — там видно и chat_id, и текст.
 *
 * Заодно проверяется настоящий путь: если отправка сломается, тест упадёт
 * вместе с ней, а не обойдёт её сторонней заглушкой.
 */
let lastText = '';
let sendOk = true;

function captureFetch(): { bodies: { chat_id?: string; text?: string }[]; restore: () => void } {
  const bodies: { chat_id?: string; text?: string }[] = [];
  const saved = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.includes('/sendMessage')) {
      return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
    }
    const parsed = JSON.parse(String(init?.body ?? '{}')) as { chat_id?: string; text?: string };
    bodies.push(parsed);
    lastText = parsed.text ?? '';
    if (!sendOk) return { ok: false, status: 500, text: async () => '{}' } as unknown as Response;
    return { ok: true, status: 200, text: async () => '{"ok":true}' } as unknown as Response;
  }) as typeof globalThis.fetch;

  return {
    bodies,
    restore: () => {
      globalThis.fetch = saved;
    },
  };
}

const net = captureFetch();

beforeEach(() => {
  db.exec(
    'DELETE FROM applications; DELETE FROM searches; DELETE FROM resumes; DELETE FROM users; DELETE FROM meta;',
  );
  resetNotificationState();
  net.bodies.length = 0;
  lastText = '';
  sendOk = true;
});

function seedUser(id = 1): number {
  return Number(
    db
      .prepare(
        `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, telegram_chat_id)
         VALUES (?, ?, 'h', 'pro', ?, ?, 'chat-1')`,
      )
      .run(id, `u${id}@example.com`, Date.now() + 100_000, Date.now()).lastInsertRowid,
  );
}

/**
 * Отклик для тестов.
 *
 * `response` — ВНУТРЕННИЙ код результата ("interview" / "decline" /
 * "question"), который кладёт синхронизация с hh. Компания туда никогда не
 * писалась: раньше тест подставлял туда «ООО Ромашка», потому что код
 * выводил `Компания: ${row.response}` — то есть подпись врала, а тест это
 * закреплял. Причина ответа живёт в `response_note`.
 */
function seedApp(
  userId: number,
  over: Partial<{
    slug: string;
    status: string;
    message: string;
    /** Внутренний код результата: interview / decline / question. */
    response: string;
    /** Текст ответа площадки: причина отказа или подпись состояния. */
    responseNote: string;
    sentAt: number;
    viewedAt: number | null;
    respondedAt: number | null;
    notifiedAt: number | null;
  }> = {},
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO applications (user_id, job_slug, status, message, response, response_note, sent_at, viewed_at, responded_at, notified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        over.slug ?? 'hh-1',
        over.status ?? 'sent',
        over.message ?? '',
        over.response ?? '',
        over.responseNote ?? '',
        over.sentAt ?? Date.now(),
        over.viewedAt ?? null,
        over.respondedAt ?? null,
        over.notifiedAt ?? null,
      ).lastInsertRowid,
  );
}

/** Приглашение на собеседование: так его записывает синхронизация с hh. */
function seedInvitation(userId: number, over: Parameters<typeof seedApp>[1] = {}): number {
  return seedApp(userId, {
    status: 'responded',
    response: 'interview',
    respondedAt: Date.now() - 7200_000,
    sentAt: Date.now() - 7200_000,
    ...over,
  });
}

// ------------------------------------------------------------------ тишина

/**
 * Пустое окно не порождает сообщение.
 *
 * «За последние 6 часов ничего не произошло» хуже отсутствия сообщения:
 * человек перестаёт открывать бота после третьего такого.
 */
test('пустое окно не порождает сообщение', () => {
  assert.equal(
    formatDigest(
      { id: 1 },
      {
        applied: 0,
        withLetter: 0,
        viewed: 0,
        responded: 0,
        invites: 0,
        declines: 0,
      },
    ),
    null,
    'нулевой дайджест всё равно отправляется',
  );
});

test('пустое окно по данным пользователя тоже молчит', () => {
  const uid = seedUser();
  seedApp(uid, { sentAt: Date.now() - 48 * 3600_000 });
  assert.equal(
    formatDigest({ id: uid }, digestWindow(uid, Date.now() - 3600_000)),
    null,
    'по пустому окну отправлено сообщение',
  );
});

test('одно применение — тоже повод для сообщения', () => {
  /*
   * Тишина при одном отклике ошибочна: человек нажал «отклик» в боте и ждёт
   * подтверждения. Молчание читалось бы как «не сработало».
   */
  const uid = seedUser();
  seedApp(uid);
  const text = formatDigest({ id: uid }, digestWindow(uid, Date.now() - 3600_000));
  assert.ok(text, 'единственный отклик не дал сообщения');
  assert.match(text!, /Отправлено откликов: 1/, `в тексте нет числа: ${text}`);
});

// ------------------------------------------------------------------ приоритет

/**
 * Приглашение на собеседование — самое срочное сообщение в продукте.
 *
 * Человек ждёт звонка часами, и ответ «вы отказались на 12 вакансиях» в этот
 * момент — шум. Поэтому приглашение идёт первым и отдельной строкой.
 */
test('приглашение на собеседование идёт первым и выделено', () => {
  const text = formatDigest(
    { id: 1 },
    { applied: 3, withLetter: 3, viewed: 2, responded: 1, invites: 1, declines: 4 },
  );
  assert.ok(text, 'приглашение не дало сообщения');
  const lines = text!.split('\n');
  assert.match(lines[0]!, /Приглашение на собеседование/, 'приглашение не в первой строке');
  assert.match(text!, /Подготовьтесь/, 'не сказано, что делать с приглашением');
  assert.match(text!, /\/dashboard/, 'не сказано, где готовиться');
});

test('отказы не тонут среди откликов', () => {
  const text = formatDigest(
    { id: 1 },
    { applied: 0, withLetter: 0, viewed: 0, responded: 0, invites: 0, declines: 3 },
  );
  assert.ok(text, 'отказы не дали сообщения');
  assert.match(text!, /Отказов: 3/, 'нет числа отказов');
  assert.match(text!, /dashboard/, 'не сказано, где смотреть разбор');
});

test('склоняется по-русски', () => {
  assert.match(
    formatDigest(
      { id: 1 },
      { applied: 1, withLetter: 1, viewed: 0, responded: 0, invites: 0, declines: 0 },
    )!,
    /Отправлено откликов: 1 \(/,
  );
  assert.match(
    formatDigest(
      { id: 1 },
      { applied: 3, withLetter: 3, viewed: 0, responded: 0, invites: 0, declines: 0 },
    )!,
    /Отправлено откликов: 3 \(/,
  );
  assert.match(
    formatDigest(
      { id: 1 },
      { applied: 11, withLetter: 11, viewed: 0, responded: 0, invites: 0, declines: 0 },
    )!,
    /Отправлено откликов: 11 \(/,
  );
  // Часть без письма называется явно: молчаливое «3 из 3» не читается.
  assert.match(
    formatDigest(
      { id: 1 },
      { applied: 5, withLetter: 2, viewed: 0, responded: 0, invites: 0, declines: 0 },
    )!,
    /с письмами: 2/,
  );
});

// ------------------------------------------------------------------ окно

test('в окно попадают только свежие отклики', () => {
  const uid = seedUser();
  const now = Date.now();
  seedApp(uid, { slug: 'hh-old', sentAt: now - 48 * 3600_000 });
  seedApp(uid, { slug: 'hh-new', sentAt: now - 3600_000 });

  const w = digestWindow(uid, now - 6 * 3600_000);
  assert.equal(w.applied, 1, 'в окно попал отклик старше границы');
});

test('отозванные отклики не показываются', () => {
  const uid = seedUser();
  db.prepare(
    "INSERT INTO applications (user_id, job_slug, status, sent_at, withdrawn) VALUES (?, 'hh-x', 'sent', ?, 1)",
  ).run(uid, Date.now());
  assert.equal(
    digestWindow(uid, Date.now() - 3600_000).applied,
    0,
    'отозванный отклик попал в дайджест',
  );
});

// ------------------------------------------------------------------ рассылка

test('дайджест уходит одному сообщением, а не по одному на отклик', async () => {
  const uid = seedUser();
  for (let i = 0; i < 4; i++) seedApp(uid, { slug: `hh-${i}` });

  const sent = await sendDigests();
  assert.equal(sent, 1, `ожидалось одно сообщение, ушло ${sent}`);
});

test('повторный дайджест в том же окне не отправляется', async () => {
  const uid = seedUser();
  seedApp(uid);

  const first = await sendDigests();
  const second = await sendDigests();
  assert.equal(first, 1, 'первый дайджест не ушёл');
  assert.equal(second, 0, 'второй дайджест ушёл в том же окне — это спам');
});

test('пользователю без привязанного чата ничего не отправляется', async () => {
  db.prepare(
    "INSERT INTO users (id, email, password_hash, plan, created_at) VALUES (1, 'a@b.test', 'h', 'pro', ?)",
  ).run(Date.now());
  seedApp(1);
  assert.equal(await sendDigests(), 0, 'сообщение ушло в никуда');
});

// ------------------------------------------------------------------ алерты

/**
 * Приглашение должно прийти один раз.
 *
 * Синхронизация с hh видит одно и то же состояние, пока человек не откроет
 * отклик. Без отметки приглашение приходило бы снова и снова, и человек
 * перестал бы открывать бота — то есть уведомления сделали бы хуже, чем их
 * отсутствие.
 */
test('приглашение на собеседование уходит ровно один раз', async () => {
  const uid = seedUser();
  const appId = seedInvitation(uid);

  const first = await sendAlerts((s) => `Вакансия ${s}`);
  assert.equal(first, 1, 'приглашение не ушло');

  const second = await sendAlerts((s) => `Вакансия ${s}`);
  assert.equal(second, 0, 'приглашение ушло повторно');

  const row = db.prepare('SELECT notified_at FROM applications WHERE id = ?').get(appId) as {
    notified_at: number | null;
  };
  assert.ok(row.notified_at, 'отметка об отправке не проставлена');
});

test('в тексте приглашения есть вакансия и куда идти', async () => {
  const uid = seedUser();
  seedInvitation(uid, { responseNote: 'Компания Ромашка пригласила на собеседование' });

  await sendAlerts((s) => (s === 'hh-1' ? 'Senior React Developer' : null));
  const text = await lastSentText();
  assert.match(text, /Senior React Developer/, 'в сообщении нет названия вакансии');
  assert.match(text, /Ромашка/, 'в сообщении нет текста ответа площадки');
  assert.match(text, /dashboard/i, 'не сказано, что делать дальше');
});

/**
 * Регрессия: счётчик приглашений всегда был нулём.
 *
 * Дайджест считал `status = 'invited'`, но это значение не писалось НИГДЕ:
 * синхронизация с hh записывала приглашение как `status='responded'`. То
 * есть человек, которого пригласили на собеседование, получал «HR ответил на
 * отклик» вместо «Приглашение на собеседование» — без совета готовиться.
 */
test('приглашение считается и звучит как приглашение, а не как «ответ HR» (regression)', async () => {
  const uid = seedUser();
  seedInvitation(uid);

  const w = digestWindow(uid, Date.now() - 6 * 3600_000);
  assert.equal(w.invites, 1, `приглашений посчитано ${w.invites}, а не 1`);

  const text = await sendDigests();
  assert.ok(text > 0, 'дайджест молчит при реальном приглашении');
  const body = await lastSentText();
  assert.match(
    body,
    /Приглашение на собеседование/,
    `в дайджесте нет приглашения: ${body.slice(0, 200)}`,
  );
});

test("статус 'invited' больше не решает ничего сам по себе", async () => {
  /*
   * Значение, которого в коде не существует. Отклик с ним и без ответа от
   * площадки НЕ должен ни уйти в уведомления, ни попасть в приглашения.
   * Иначе при возврате синхронизации к записи `status='invited'` мы бы снова
   * считали несуществующий факт.
   */
  const uid = seedUser();
  seedApp(uid, {
    status: 'invited',
    response: '',
    respondedAt: null,
    sentAt: Date.now() - 7200_000,
  });

  assert.equal(await sendAlerts(() => 'Вакансия'), 0, 'несуществующий статус разослал уведомление');
  assert.equal(
    digestWindow(uid, Date.now() - 6 * 3600_000).invites,
    0,
    'несуществующий статус посчитан',
  );
});

test('уведомление уходит, даже если вакансия удалена из каталога', async () => {
  /*
   * Каталог чистят регулярно, и приглашение может прийти на вакансию, которой
   * в базе уже нет. Молчать тогда нельзя: человек потеряет единственное, что
   * ему важно, из-за того, что у нас не нашлось названия.
   */
  const uid = seedUser();
  seedInvitation(uid);

  assert.equal(await sendAlerts(() => null), 1, 'уведомление потеряно из-за отсутствия вакансии');
  const text = await lastSentText();
  assert.match(text, /Приглашение/i, 'сообщение без вакансии не содержит самого главного');
});

test('упавшая отправка не помечает отклиск как отправленный дважды', async () => {
  /*
   * Отметка ставится ПОСЛЕ успешной отправки. Раньше было наоборот, и сбой
   * Telegram на середине рассылки съедал уведомление навсегда.
   */
  const uid = seedUser();
  seedInvitation(uid);

  sendOk = false;
  assert.equal(await sendAlerts(() => 'Вакансия'), 0, 'упавшая отправка засчитана как успешная');
  sendOk = true;

  const row = db.prepare('SELECT notified_at FROM applications').get() as {
    notified_at: number | null;
  };
  /*
   * Отметка ставится ПОСЛЕ успешной отправки, а не до неё. Раньше было
   * наоборот: `pendingAlerts` выбирает строки с notified_at IS NULL, поэтому
   * отмеченная сбойная строка отправки больше не выбиралась никогда. Один
   * сетевой сбой Telegram — и человек терял приглашение на собеседование,
   * не узнав об этом. Повторное сообщение — просто повтор; молчание — провал.
   */
  assert.equal(
    row.notified_at,
    null,
    'после сбоя отметка выставлена — приглашение потеряно навсегда',
  );

  // Следующий тик обязан повторить попытку.
  assert.equal(
    await sendAlerts(() => 'Вакансия'),
    1,
    'после сбоя уведомление не повторилось — приглашение потеряно',
  );
});

async function lastSentText(): Promise<string> {
  return lastText;
}
