import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Автоотклик отправляет сопроводительное письмо.
 *
 * Главная регрессия продукта. `hhProvider.apply` умеет отправлять письмо
 * (`payload.message`), раздел писем в кабинете написан, на главной
 * персонализированные письма заявлены как отличие сервиса — а автоотклик
 * передавал `message: undefined`. То есть не уходило НИ ОДНОГО письма.
 *
 * Проверяется не «функция вызвалась», а что уходит на сервер: `payload.message`
 * в теле POST /negotiations. Пустая строка и отсутствие поля — разные вещи,
 * и обе означают, что половина ценности не работает.
 *
 * Сеть перехватывается подменой `fetch`, поэтому тест видит настоящий путь
 * данных: автоотклик → hhProvider.apply → httpFetch → fetch.
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;
let db: Database;
let runAutoApply: (opts?: {
  pacing?: Partial<import('../src/lib/anti-ban').PacingConfig>;
}) => Promise<import('../src/lib/autoapply').AutoApplyRun>;
let resetPacing: () => void;
let resetCatalogCache: () => void;

/**
 * Вакансия в каталоге: создаём напрямую, чтобы не ждать сеть провайдеров.
 *
 * `publishedAt` по умолчанию — «только что». Это не украшение: автоотклик
 * отбрасывает вакансии старше двух дней, и без даты публикации (NULL) запись
 * считается непригодной. Фикстура без даты прошла бы только потому, что
 * фильтра ещё не было, и тесты перестали бы проверять то, что заявляют.
 */
function seedVacancy(
  slug: string,
  title: string,
  skills: string[],
  publishedAt: number = Date.now(),
) {
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, salary_min, salary_max,
      level, format, city, posted, category, about, responsibilities, requirements, bonus,
      source_url, contact_email, contact_phone, published_at, fetched_at)
     VALUES (?, 'hh', ?, ?, 'Тест', '200000', 200000, 250000, 'Middle', 'Удалённо', 'Москва',
      'сегодня', 'Разработка', ?, '[]', ?, '[]', NULL, NULL, NULL, ?, ?)`,
  ).run(
    slug,
    slug.replace('hh-', ''),
    title,
    `Требуются: ${skills.join(', ')}`,
    JSON.stringify(skills),
    publishedAt,
    Date.now(),
  );
  /*
   * Сброс кэша каталога — обязателен, а не гигиена.
   *
   * getCatalog() кэширует выборку на 30 секунд и сам сбрасывается только когда
   * запись идёт через upsertMany. Прямая вставка в SQL кэш не трогает, и
   * вакансия, добавленная после первого прогона, в подбор не попадает —
   * молча. Из-за этого первые пять тестов этого файла проходили не по той
   * причине: вакансия первого теста была в кэше, вакансии следующих — нет,
   * и проверка «отклик ушёл» выполнялась на записи первого теста. Проверки
   * отсева устаревших вакансий на этом фоне просто не о чем было.
   */
  resetCatalogCache();
}

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  // Паузер анти-бана разрешает отправку только в «рабочие часы» часового
  // пояса раннера (09:00–20:00). Ночной прогон в другом поясе обнулял
  // applied — suite падал от расписания, а не от кода. Окно раздвигаем
  // здесь: само расписание отдельно и явно проверяет anti-ban.test.ts.
  process.env.AUTOAPPLY_WORK_START = '1';
  process.env.AUTOAPPLY_WORK_END = '24';
  const dbMod = await import('../src/lib/db');
  db = dbMod.db;
  const aa = await import('../src/lib/autoapply');
  // Часы прогона фиксированы: см. helpers/run-autoapply — иначе ночью
  // паузер не отправляет, и тесты падали по настенным часам.
  runAutoApply = (await import('./helpers/run-autoapply')).runAutoApply;
  resetPacing = aa.resetPacing;
  const vacancies = await import('../src/lib/vacancies');
  resetCatalogCache = vacancies.resetCatalogCache;
});

/**
 * Чистая база перед каждым тестом.
 *
 * runAutoApply обходит ВСЕХ пользователей базы, а не переданного. Тесты этого
 * файла накапливали пользователей и вакансии: к четвёртому тесту в базе было
 * четыре пользователя с одинаковым поиском «react» и четыре вакансии, и каждый
 * прогон откликался по разу за пользователя на каждую подходящую вакансию.
 * Проверки вида «ожидался один отклик» держались только на том, что каталог был
 * закеширован и в подбор попадала одна-единственная вакансия из первого теста.
 *
 * То есть тесты проходили не потому, что проверяли. Изоляция здесь — условие
 * того, что утверждение «ровно один отклик» вообще осмысленно.
 */
beforeEach(() => {
  db.exec(
    'DELETE FROM applications; DELETE FROM letters; DELETE FROM resumes; DELETE FROM searches; DELETE FROM users; DELETE FROM vacancies;',
  );
  resetCatalogCache();
  resetPacing();
});

/** Создаёт пользователя с hh-токеном, резюме, письмом и активным поиском. */
function seedUser(options: {
  letters?: { title: string; content: string }[];
  resume?: string;
  keywords?: string;
  /** id резюме на hh; если не задан, резюме считается ручным (без привязки). */
  resumeHhId?: string | null;
  /** Общее hh_resume_id на уровне аккаунта — запасной источник отправки. */
  accountResumeId?: string | null;
}): number {
  const accountResume = options.accountResumeId === undefined ? 'res123' : options.accountResumeId;
  const uid = Number(
    db
      .prepare(
        // mode='live' обязателен: в demo-режиме автоотклик не отправляет ничего,
        // и тест письма проверял бы пустоту вместо самого письма.
        `INSERT INTO users (email, password_hash, plan, plan_expires_at, created_at, hh_token, hh_resume_id, mode)
         VALUES (?, 'h', 'pro', ?, ?, 'user-token', ?, 'live')`,
      )
      .run(
        `u${Math.random().toString(36).slice(2)}@example.com`,
        Date.now() + 100000,
        Date.now(),
        accountResume,
      ).lastInsertRowid,
  );

  db.prepare(
    `INSERT INTO resumes (user_id, title, content, hh_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    uid,
    'Frontend Developer',
    options.resume ?? 'Опыт 5 лет. React, TypeScript, Next.js.',
    options.resumeHhId ?? null,
    Date.now(),
    Date.now(),
  );

  for (const l of options.letters ?? []) {
    db.prepare(
      'INSERT INTO letters (user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(uid, l.title, l.content, Date.now(), Date.now());
  }

  db.prepare(
    `INSERT INTO searches (user_id, title, keywords, active, started_at, created_at) VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(uid, 's', options.keywords ?? 'react', Date.now(), Date.now());

  return uid;
}

/**
 * Перехватывает POST /negotiations и возвращает тело запроса.
 *
 * Скорость ответа на POST /token нужна, потому что getValidHhToken может
 * обновить протухший токен.
 *
 * `respond` позволяет задать ответ платформы — для проверки того, что отказ
 * по закрытой вакансии не включает backoff, нужно, чтобы hh реально вернул 404.
 */
function interceptApplies(respond?: (vacancyId: string) => { status: number; body: string }): {
  bodies: Record<string, unknown>[];
  restore: () => void;
} {
  const bodies: Record<string, unknown>[] = [];
  const saved = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/token')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: 'user-token', expires_in: 3600 }),
      } as unknown as Response;
    }
    if (u.includes('/negotiations')) {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      bodies.push(parsed);
      const reply = respond?.(String(parsed.vacancy_id ?? ''));
      if (reply) {
        return {
          /*
           * ok обязан следовать за статусом. Раньше здесь стоял ok: false
           * безусловно, и «успешный» ответ 200 от платформы обрабатывался как
           * отказ — тест на продолжение прогона после закрытой вакансии
           * падал на собственной заглушке, а не на коде.
           */
          ok: reply.status >= 200 && reply.status < 300,
          status: reply.status,
          text: async () => reply.body,
        } as unknown as Response;
      }
      return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  return {
    bodies,
    restore: () => {
      globalThis.fetch = saved;
    },
  };
}

test('отклик уходит с письмом, а не без него', async () => {
  const uid = seedUser({
    letters: [
      { title: 'Фронтенд', content: 'Пишу на React и TypeScript, Next.js в продакшене.' },
      { title: 'Бэкенд', content: 'Python, Django, PostgreSQL, микросервисы.' },
    ],
  });
  seedVacancy('hh-react-1', 'React-разработчик', ['React', 'TypeScript']);

  const net = interceptApplies();
  try {
    resetPacing();
    const result = await runAutoApply();
    assert.ok(result.applied > 0, 'отклик не отправлен');

    assert.equal(net.bodies.length, result.applied, 'число запросов не совпало с числом откликов');

    for (const body of net.bodies) {
      assert.equal(typeof body.message, 'string', 'в теле отклика нет поля message');
      const message = String(body.message ?? '');
      assert.ok(
        message.trim().length > 40,
        `письмо пустое или слишком короткое: ${JSON.stringify(message.slice(0, 60))}`,
      );
    }

    const row = db
      .prepare('SELECT message, letter_id FROM applications WHERE user_id = ?')
      .get(uid) as { message: string; letter_id: number | null };
    assert.ok(row.message.length > 40, 'письмо не сохранено в applications');
    assert.ok(row.letter_id, 'письмо не связано с откликом через letter_id');
  } finally {
    net.restore();
  }
});

test('выбирается письмо, релевантное вакансии', async () => {
  seedUser({
    letters: [
      { title: 'Фронтенд', content: 'Пишу на React и TypeScript, Next.js в продакшене.' },
      { title: 'Бэкенд', content: 'Python, Django, PostgreSQL, микросервисы и очереди.' },
    ],
    keywords: 'react',
  });
  seedVacancy('hh-react-2', 'React-разработчик', ['React', 'TypeScript']);

  const net = interceptApplies();
  try {
    resetPacing();
    await runAutoApply();
    assert.equal(net.bodies.length, 1, 'ожидался один отклик');
    const message = String(net.bodies[0]!.message ?? '');
    assert.match(message, /React|TypeScript/i, `выбрано не то письмо: ${message.slice(0, 120)}`);
    assert.doesNotMatch(message, /Django|PostgreSQL/i, 'выбрано письмо про бэкенд');
  } finally {
    net.restore();
  }
});

test('без сохранённых писем отклик всё равно уходит — с шаблоном', async () => {
  const uid = seedUser({ letters: [], keywords: 'react' });
  seedVacancy('hh-react-3', 'React-разработчик', ['React']);

  const net = interceptApplies();
  try {
    resetPacing();
    await runAutoApply();
    assert.equal(net.bodies.length, 1, 'отклик не отправлен без писем');
    const message = String(net.bodies[0]!.message ?? '');
    assert.ok(message.length > 40, 'шаблонное письмо не подставлено');
    assert.match(message, /React/i, 'в шаблонном письме нет названия вакансии');

    const row = db
      .prepare('SELECT message, letter_id FROM applications WHERE user_id = ?')
      .get(uid) as {
      message: string;
      letter_id: number | null;
    };
    assert.ok(row.message.length > 40, 'письмо не сохранено');
    assert.equal(row.letter_id, null, 'шаблонное письмо не должно притворяться сохранённым');
  } finally {
    net.restore();
  }
});

test('отклик содержит достижение с цифрой из резюме', async () => {
  seedUser({
    letters: [],
    keywords: 'react',
    resume:
      'Разработчик\nОпыт 5 лет\nСократил время загрузки приложения на 40%, LCP с 4.2с до 1.6с',
  });
  seedVacancy('hh-react-4', 'React-разработчик', ['React']);

  const net = interceptApplies();
  try {
    resetPacing();
    await runAutoApply();
    const message = String(net.bodies[0]?.message ?? '');
    assert.match(
      message,
      /40%|1\.6с|загрузк/i,
      `письмо не содержит достижения из резюме: ${message.slice(0, 160)}`,
    );
  } finally {
    net.restore();
  }
});

test('в статистике видно, сколько откликов ушло с письмом', async () => {
  seedUser({ letters: [], keywords: 'react' });
  seedVacancy('hh-react-5', 'React-разработчик', ['React']);

  const net = interceptApplies();
  try {
    resetPacing();
    const result = await runAutoApply();
    assert.ok(result.applied > 0, 'отклик не отправлен');
    assert.equal(result.withLetter, result.applied, 'письмо не учтено в статистике прогона');
    assert.equal(result.withoutLetter, 0, 'отклик без письма при наличии шаблона');
  } finally {
    net.restore();
  }
});

/**
 * Сквозная проверка: на устаревшие вакансии отклик не уходит.
 *
 * Отдельные тесты `onlyFresh` тут не помогли: сняв вызов функции в
 * автоотклике, я получил зелёные тесты функции и полностью неработающую
 * защиту. Функция может быть написана верно и не вызываться — тогда отклики
 * на закрытые вакансии пойдут как раньше. Поэтому проверяется результат
 * прогона: в сеть уходят только вакансии свежее двух дней.
 *
 * Что стоит за этим. Каталог держит записи неделю (EXTERNAL_TTL_MS). Отклик
 * на закрытую вакансию стоит двойного: съедает слот дневного лимита, а он у
 * человека один, и вызывает recordFailure("platform") — экспоненциальную
 * паузу, которая замедляет все последующие отклики. То есть одна запись,
 * пролежавшая в каталоге неделю, отравляла прогон целиком.
 */
test('на устаревшие вакансии отклик не уходит', async () => {
  /*
   * Изолируем прогон двумя приёмами, и оба важны.
   *
   * 1. Свой навык в поиске и в вакансиях. Terraform не встречается в остальных
   *    фикстурах этого файла, поэтому в сеть не попадёт ничего лишнего, и
   *    утверждение про состав отправленных откликов будет точным.
   *
   * 2. Нулевая пауза между откликами. Обычный decide() после первой отправки
   *    возвращает "backoff" (пауза 45–180 с до следующей отправки), и прогон
   *    делает ровно один отклик за тик. За один тик отбор по дате не виден:
   *    тест проходит и с полностью отключённой проверкой свежести, просто
   *    попав на первую вакансию. Пауза здесь не про скорость теста, а про то,
   *    чтобы прогон увидел все три вакансии.
   */
  seedUser({ letters: [], keywords: 'Terraform' });
  const now = Date.now();
  const day = 86_400_000;
  /*
   * Порядок вставки — часть проверки, а не её деталь.
   *
   * Каталог сортируется по источнику и названию, а при равных — по порядку
   * строк. Если свежую вакансию вставить первой, тест проходит и с полностью
   * отключённым фильтром: за тик успевает уйти ровно один отклик, и он попадает
   * на tf-fresh просто потому, что она первая. Я на это наступил: сняв сначала
   * фильтр, а потом паузу между откликами, получил зелёный тест при отключённых
   * обеих защитах.
   *
   * Устаревшая вакансия идёт первой специально: тогда без фильтра отклик уйдёт
   * на неё и тест покраснеет.
   */
  seedVacancy('hh-tf-stale', 'Terraform-разработчик', ['Terraform'], now - 5 * day);
  seedVacancy('hh-tf-old', 'Terraform-разработчик', ['Terraform'], now - 30 * day);
  seedVacancy('hh-tf-fresh', 'Terraform-разработчик', ['Terraform'], now - 2 * 3_600_000);

  const net = interceptApplies();
  try {
    resetPacing();
    const result = await runAutoApply({
      pacing: { minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 },
    });

    const sent = net.bodies.map((b) => String(b.vacancy_id));
    assert.deepEqual(sent, ['tf-fresh'], `отклик ушёл не туда: ${sent.join(', ') || '(ничего)'}`);
    assert.equal(result.applied, 1, 'число откликов не совпало с числом запросов');
    assert.ok(
      result.skipped >= 2,
      `устаревшие вакансии не попали в пропущенные: ${result.skipped}`,
    );
  } finally {
    net.restore();
  }
});

/**
 * Закрытая вакансия не останавливает прогон.
 *
 * Backoff нужен ради риска блокировки: если платформа начала отклонять, надо
 * замедлиться. Отказ по закрытой вакансии — не про риск, а про то, что вакансии
 * больше нет, и включать по нему паузу нельзя.
 *
 * Раньше стояло безусловное `recordFailure("platform")` на любой неудаче.
 * Каталог держит записи неделю, поэтому одна пролежавшая в нём мёртвая запись
 * включала экспоненциальную паузу и замедляла все последующие отклики — то есть
 * отравляла прогон целиком.
 *
 * Проверяется не «функция классификации верна», а то, что после отказа по
 * закрытой вакансии следующая отправка всё равно происходит. Первая вакансия
 * получает 404, вторая должна получить отклик.
 */
test('отказ по закрытой вакансии не останавливает отправку', async () => {
  seedUser({ letters: [], keywords: 'Kubernetes' });
  const now = Date.now();
  seedVacancy('hh-k8s-dead', 'Kubernetes-инженер', ['Kubernetes'], now - 3_600_000);
  seedVacancy('hh-k8s-live', 'Kubernetes-инженер', ['Kubernetes'], now - 2 * 3_600_000);

  // Закрытой отвечаем только первая вакансия.
  const net = interceptApplies((id) =>
    id === 'k8s-dead'
      ? { status: 404, body: '{"message":"vacancy not found"}' }
      : { status: 200, body: '{}' },
  );
  try {
    resetPacing();
    const result = await runAutoApply({
      pacing: { minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 },
    });

    const sent = net.bodies.map((b) => String(b.vacancy_id));
    assert.ok(
      sent.includes('k8s-dead'),
      `закрытая вакансия не была опробована: ${sent.join(', ')}`,
    );
    assert.ok(
      sent.includes('k8s-live'),
      `после отказа по закрытой вакансии прогон остановился вместо того, чтобы отправить следующую: ${sent.join(', ')}`,
    );
    assert.equal(result.applied, 1, 'вторая вакансия не получила отклик');
    assert.notEqual(
      result.pausedFor,
      'backoff',
      `включён backoff на закрытой вакансии: ${result.pausedFor}`,
    );
  } finally {
    net.restore();
  }
});

/**
 * А настоящий отказ платформы паузу включает — иначе первая проверка выше
 * проходила бы и при полностью сломанном backoff.
 *
 * 429 означает «платформа тормозит», и замедлиться здесь правильно.
 */
test('настоящий отказ платформы включает backoff', async () => {
  seedUser({ letters: [], keywords: 'Elixir' });
  const now = Date.now();
  seedVacancy('hh-ex-1', 'Elixir-разработчик', ['Elixir'], now - 3_600_000);
  seedVacancy('hh-ex-2', 'Elixir-разработчик', ['Elixir'], now - 2 * 3_600_000);

  const net = interceptApplies(() => ({ status: 429, body: '{"message":"too many requests"}' }));
  try {
    resetPacing();
    const result = await runAutoApply({
      pacing: { minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 },
    });

    assert.equal(result.failed, 1, `отказ не учтён как неудачный: ${JSON.stringify(result)}`);
    assert.equal(result.applied, 0, 'отклик засчитан при отказе платформы');
    /*
     * Проверяется, что вторая вакансия не была опробована: после 429 пауза
     * включена и прогон обязан остановиться. Считаем фактические запросы, а не
     * логические отклики: httpFetch повторяет попытку при таком ответе, поэтому
     * число попыток больше единицы, а вакансия при этом одна.
     */
    const sent = net.bodies.map((b) => String(b.vacancy_id));
    assert.ok(
      !sent.includes('ex-2'),
      `после 429 прогон пошёл к следующей вакансии вместо паузы: ${sent.join(', ')}`,
    );
    assert.equal(result.pausedFor, 'backoff', `на 429 пауза не включена: ${result.pausedFor}`);
  } finally {
    net.restore();
  }
});

/**
 * Внешние паузы действительно применяются.
 *
 * runAutoApply принимает opts.pacing для тестов и инструментов. Раньше эти
 * значения молча не применялись: createPacing получал их, но следом
 * `pacing.configure({ ...base, ... })` делал Object.assign по значениям из
 * конфигурации и затирал их дефолтами. То есть параметр был задокументирован,
 * принимался и не делал ничего — и это обнаруживалось только тем, что тест,
 * просивший нулевую паузу, получал 45 секунд и упирался в один отклик за тик.
 *
 * Проверяется поведением, а не строчкой кода: с большой паузой прогон делает
 * один отклик, с нулевой — все подходящие.
 */
test('переданная пауза влияет на число откликов за тик', async () => {
  /*
   * Один пользователь, две вакансии, один прогон.
   *
   * Два прогона подряд в одном тесте не годится: первый оставляет строки в
   * applications и паузу в паузере, и второй измеряет уже другое состояние.
   * Два пользователя тоже не годится — у каждого свой паузер, и оба успевают
   * по одному отклику независимо от переданной паузы. Поэтому разница
   * проверяется на одном прогоне с одной вакансией сверх.
   */
  const now = Date.now();
  seedUser({ letters: [], keywords: 'Erlang' });
  seedVacancy('hh-er-1', 'Erlang-разработчик', ['Erlang'], now - 3_600_000);
  seedVacancy('hh-er-2', 'Erlang-разработчик', ['Erlang'], now - 2 * 3_600_000);

  const net = interceptApplies();
  try {
    resetPacing();
    const slow = await runAutoApply({
      pacing: { minDelayMs: 600_000, maxDelayMs: 600_000, jitterMinutes: 0 },
    });
    assert.equal(slow.applied, 1, `длинная пауза не ограничила тик: ${JSON.stringify(slow)}`);

    // Тот же набор, но нулевая пауза: обходится ограничение тика.
    db.prepare('DELETE FROM applications').run();
    resetPacing();
    const fast = await runAutoApply({ pacing: { minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 } });
    assert.equal(
      fast.applied,
      2,
      `нулевая пауза не пропустила второй отклик: ${JSON.stringify(fast)}`,
    );
  } finally {
    net.restore();
  }
});

/**
 * Отклик уходит с тем резюме, которым вакансия оценивалась.
 *
 * Главная регрессия этого блока. Раньше подбор шёл по последнему обновлённому
 * резюме, а отправлялся `users.hh_resume_id` — то есть другое. Человек с
 * резюме «Python» и «React» получал вакансии по Python, а уходило резюме
 * React, и он об этом не знал.
 *
 * Проверяется по телу запроса: resume_id обязан совпадать с резюме, которое
 * подобрано под конкретную вакансию.
 */
test('на вакансию уходит подходящее резюме, а не одно на всё', async () => {
  const uid = seedUser({
    letters: [],
    keywords: 'React или Python',
    resumeHhId: 'hh-front',
    accountResumeId: null,
    // Своё достижение с цифрой: письмо строится по строке резюме с числом,
    // и по нему видно, ЧЬЕ резюме использовалось.
    resume: 'React-разработчик. Сократил LCP с 4.2с до 1.6с на каталоге.',
  });
  db.prepare(
    `INSERT INTO resumes (user_id, title, content, hh_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    uid,
    'Python Developer',
    'Python-разработчик. Перевёл отчётность на PostgreSQL, сократил время сбора с 40с до 3с.',
    'hh-back',
    Date.now() - 60_000,
    Date.now() - 60_000,
  );
  const now = Date.now();
  // Бэкенд вставлен первым: при старой сортировке он и получил бы приоритет.
  seedVacancy(
    'hh-tf-back',
    'Python-разработчик',
    ['Python', 'Django', 'PostgreSQL'],
    now - 2 * 3_600_000,
  );
  seedVacancy(
    'hh-tf-front',
    'React-разработчик',
    ['React', 'TypeScript', 'Next.js'],
    now - 3_600_000,
  );

  const net = interceptApplies();
  try {
    resetPacing();
    const result = await runAutoApply({
      pacing: { minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 },
    });
    assert.equal(result.applied, 2, `ожидалось два отклика: ${JSON.stringify(result)}`);

    const by = new Map(net.bodies.map((b) => [String(b.vacancy_id), String(b.resume_id)]));
    assert.equal(
      by.get('tf-front'),
      'hh-front',
      `на фронтенд ушло не то резюме: ${by.get('tf-front')}`,
    );
    assert.equal(by.get('tf-back'), 'hh-back', `на бэкенд ушло не то резюме: ${by.get('tf-back')}`);

    // И в истории откликов записано то же, что ушло.
    const rows = db
      .prepare('SELECT job_slug, resume_id FROM applications WHERE user_id = ?')
      .all(uid) as { job_slug: string; resume_id: string }[];
    const stored = new Map(rows.map((r) => [r.job_slug.replace('hh-', ''), r.resume_id]));
    assert.equal(stored.get('tf-front'), 'hh-front', 'в истории записано другое резюме, чем ушло');
    assert.equal(stored.get('tf-back'), 'hh-back', 'в истории записано другое резюме, чем ушло');

    /*
     * Письмо пишется по тому же резюме, которое ушло.
     *
     * Раньше письмо строилось по последнему обновлённому резюме, а уходило
     * users.hh_resume_id — то есть человек писал работодателю «сократил LCP» про
     * фронтенд и отправлял резюме, где этого достижения нет. Для человека это
     * выглядит как ложь в заявке: в письме одно, в резюме другое.
     */
    const letters = new Map(net.bodies.map((b) => [String(b.vacancy_id), String(b.message ?? '')]));
    assert.match(
      letters.get('tf-front') ?? '',
      /1\.6с|4\.2с/,
      `письмо на фронтенд построено не по фронтендовому резюме: ${(letters.get('tf-front') ?? '').slice(0, 160)}`,
    );
    assert.match(
      letters.get('tf-back') ?? '',
      /40с|3с/,
      `письмо на бэкенд построено по чужому резюме: ${(letters.get('tf-back') ?? '').slice(0, 160)}`,
    );
    assert.doesNotMatch(
      letters.get('tf-back') ?? '',
      /1\.6с/,
      'в письмо на бэкенд попало достижение из фронтендового резюме',
    );
  } finally {
    net.restore();
  }
});

/**
 * Резюме без привязки к hh не подставляется как resume_id.
 *
 * hh принимает только свой id. Подставить локальный — значит отправить вместо
 * резюме мусор. Если подходящего привязанного нет, берётся общее
 * `hh_resume_id` аккаунта — так продолжают работать люди, у которых резюме
 * заведено вручную.
 */
test('ручное резюме не уходит на hh вместо привязанного', async () => {
  const uid = seedUser({ letters: [], keywords: 'react', resumeHhId: null });
  const now = Date.now();
  seedVacancy('hh-manual-1', 'React-разработчик', ['React', 'TypeScript'], now - 3_600_000);

  const net = interceptApplies();
  try {
    resetPacing();
    const result = await runAutoApply({
      pacing: { minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 },
    });
    assert.ok(result.applied > 0, 'отклик не отправлен');
    for (const body of net.bodies) {
      const id = String(body.resume_id ?? '');
      assert.ok(id.length > 0, 'в отклике нет resume_id');
      assert.ok(!/^\d+$/.test(id), `в hh ушло локальное id резюме (${id}) — hh его не примет`);
    }
    const row = db.prepare('SELECT resume_id FROM applications WHERE user_id = ?').get(uid) as {
      resume_id: string;
    };
    assert.equal(row.resume_id, 'res123', `взято не то резюме: ${row.resume_id}`);
  } finally {
    net.restore();
  }
});

/**
 * Привязанное резюме важнее общего.
 *
 * Раньше единственным источником был `users.hh_resume_id`. Теперь у человека
 * может быть несколько резюме, и общее — лишь запасной вариант, когда
 * подходящего привязанного нет.
 */
test('привязанное резюме побеждает общее', async () => {
  seedUser({ letters: [], keywords: 'react', resumeHhId: 'hh-linked', accountResumeId: 'res123' });
  const now = Date.now();
  seedVacancy('hh-link-1', 'React-разработчик', ['React', 'TypeScript'], now - 3_600_000);

  const net = interceptApplies();
  try {
    resetPacing();
    await runAutoApply({ pacing: { minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0 } });
    assert.equal(net.bodies.length, 1, 'отклик не отправлен');
    assert.equal(
      String(net.bodies[0]!.resume_id),
      'hh-linked',
      `взято общее резюме вместо привязанного: ${net.bodies[0]!.resume_id}`,
    );
  } finally {
    net.restore();
  }
});
