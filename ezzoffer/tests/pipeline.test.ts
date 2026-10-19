import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Что делать дальше.
 *
 * Проверяется поведение на конкретных данных, а не «функция вернула массив»:
 * порядок действий отражает ценность, а сроки — единственное, что делает
 * подсказку полезной. Время внедрено параметром, поэтому «просмотрен три дня
 * назад» — это ровно три дня, а не «когда-нибудь».
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;
let db: Database;
let nextActions: typeof import('../src/lib/pipeline').nextActions;
let analyzeDeclines: typeof import('../src/lib/pipeline').analyzeDeclines;
let plural: typeof import('../src/lib/pipeline').plural;
let followupDraft: typeof import('../src/lib/pipeline').followupDraft;

const DAY = 86_400_000;
/** Фиксированная точка отсчёта: тесты не должны зависеть от времени запуска. */
const NOW = 1_800_000_000_000;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  db = (await import('../src/lib/db')).db;
  const p = await import('../src/lib/pipeline');
  nextActions = p.nextActions;
  analyzeDeclines = p.analyzeDeclines;
  plural = p.plural;
  followupDraft = p.followupDraft;
});

let seq = 0;
function user(): number {
  seq++;
  return Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, created_at, plan, plan_expires_at) VALUES (?, 'h', ?, 'pro', ?)",
      )
      .run(`p${seq}@example.com`, NOW, NOW + 10 ** 7).lastInsertRowid,
  );
}

function vacancy(slug: string, title: string): string {
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, salary_min, salary_max,
      level, format, city, posted, category, about, responsibilities, requirements, bonus,
      source_url, contact_email, contact_phone, fetched_at)
     VALUES (?, 'hh', ?, ?, 'ООО Тест', '200000', 200000, 250000, 'Middle', 'Удалённо', 'Москва',
      'сегодня', 'Разработка', '', '[]', '[]', '[]', NULL, NULL, NULL, ?)`,
  ).run(slug, slug, title, NOW);
  return slug;
}

function application(opts: {
  uid: number;
  slug: string;
  sentDaysAgo: number;
  viewedDaysAgo?: number | null;
  respondedDaysAgo?: number | null;
  response?: string;
  message?: string;
  searchId?: number | null;
}) {
  db.prepare(
    `INSERT INTO applications (user_id, job_slug, search_id, status, response, message, sent_at, viewed_at, responded_at)
     VALUES (?, ?, ?, 'sent', ?, ?, ?, ?, ?)`,
  ).run(
    opts.uid,
    opts.slug,
    opts.searchId ?? null,
    opts.response ?? '',
    opts.message ?? '',
    NOW - opts.sentDaysAgo * DAY,
    opts.viewedDaysAgo == null ? null : NOW - opts.viewedDaysAgo * DAY,
    opts.respondedDaysAgo == null ? null : NOW - opts.respondedDaysAgo * DAY,
  );
}

test('без откликов единственное действие — начать', () => {
  const uid = user();
  const actions = nextActions(uid, NOW);

  assert.equal(actions.length, 1);
  assert.equal(actions[0]!.kind, 'start');
  assert.equal(actions[0]!.href, '/dashboard/searches');
});

test('просмотренный без ответа отклик даёт напоминание написать', () => {
  const uid = user();
  const slug = vacancy('hh-1', 'React-разработчик');
  application({ uid, slug, sentDaysAgo: 6, viewedDaysAgo: 5 });

  const actions = nextActions(uid, NOW);
  const followup = actions.find((a) => a.kind === 'followup');

  assert.ok(followup, 'нет напоминания написать');
  assert.equal(followup!.count, 1);
  assert.equal(followup!.urgency, 1, 'напоминание должно быть срочным');
  assert.ok(followup!.draft && followup!.draft.length > 40, 'нет готового текста');
});

test('свежий просмотр не беспокоит: три дня — не порог', () => {
  const uid = user();
  const slug = vacancy('hh-2', 'React-разработчик');
  application({ uid, slug, sentDaysAgo: 2, viewedDaysAgo: 1 });

  const actions = nextActions(uid, NOW);
  assert.equal(
    actions.find((a) => a.kind === 'followup'),
    undefined,
    'напоминание через день после просмотра — навязчиво',
  );
});

test('очень старый просмотр не беспокоит: две недели — потолок', () => {
  const uid = user();
  const slug = vacancy('hh-3', 'React-разработчик');
  application({ uid, slug, sentDaysAgo: 40, viewedDaysAgo: 30 });

  const actions = nextActions(uid, NOW);
  assert.equal(
    actions.find((a) => a.kind === 'followup'),
    undefined,
    'напоминание через месяц выглядит навязчивым',
  );
});

test('получивший ответ не попадает в напоминания', () => {
  const uid = user();
  const slug = vacancy('hh-4', 'React-разработчик');
  application({
    uid,
    slug,
    sentDaysAgo: 8,
    viewedDaysAgo: 7,
    respondedDaysAgo: 6,
    response: 'question',
  });

  const actions = nextActions(uid, NOW);
  assert.equal(
    actions.find((a) => a.kind === 'followup'),
    undefined,
    'написать предложено тому, кому уже ответили',
  );
});

test('отказ не попадает в напоминания', () => {
  const uid = user();
  const slug = vacancy('hh-5', 'React-разработчик');
  application({ uid, slug, sentDaysAgo: 10, viewedDaysAgo: 9, response: 'decline' });

  const actions = nextActions(uid, NOW);
  assert.equal(
    actions.find((a) => a.kind === 'followup'),
    undefined,
  );
});

test('приглашение на собеседование — срочное действие', () => {
  const uid = user();
  const slug = vacancy('hh-6', 'React-разработчик');
  application({
    uid,
    slug,
    sentDaysAgo: 3,
    viewedDaysAgo: 3,
    respondedDaysAgo: 2,
    response: 'interview',
  });

  const actions = nextActions(uid, NOW);
  const interview = actions.find((a) => a.kind === 'interview');

  assert.ok(interview, 'приглашение не выделено');
  assert.equal(interview!.urgency, 1);
});

test('приоритет: то, что протухает, раньше того, что подождёт', () => {
  const uid = user();
  const stale = vacancy('hh-7', 'React-разработчик');
  const invite = vacancy('hh-8', 'Node.js-разработчик');

  application({ uid, slug: stale, sentDaysAgo: 6, viewedDaysAgo: 5 });
  application({
    uid,
    slug: invite,
    sentDaysAgo: 3,
    viewedDaysAgo: 3,
    respondedDaysAgo: 1,
    response: 'interview',
  });

  const actions = nextActions(uid, NOW);
  const kinds = actions.map((a) => a.kind);
  assert.ok(kinds.indexOf('interview') < kinds.indexOf('profile') || !kinds.includes('profile'));
  // Срочные идут раньше менее срочных — это сортировка по urgency.
  const urgencies = actions.map((a) => a.urgency);
  assert.deepEqual(
    urgencies,
    [...urgencies].sort((a, b) => a - b),
  );
});

test('отказы с общим требованием превращаются в совет, что исправить', () => {
  /*
   * Это то, ради чего воронка вообще нужна: не «Отказы: 5», а «5 отказов,
   * и все они на вакансии с Kafka».
   */
  const uid = user();
  for (let i = 0; i < 6; i++) {
    const slug = vacancy(`hh-kafka-${i}`, `Data Engineer (Kafka, ClickHouse)`);
    application({ uid, slug, sentDaysAgo: 20 + i, viewedDaysAgo: 19 + i, response: 'decline' });
  }

  const actions = nextActions(uid, NOW);
  const declines = actions.find((a) => a.kind === 'declines');

  assert.ok(declines, 'разбор отказов не предложен');
  assert.ok(
    /Kafka/i.test(declines!.detail),
    `в совете нет повторяющегося требования: ${declines!.detail}`,
  );
  assert.equal(declines!.count, 6);
});

test('разбор отказов не выдумывает причину при малом числе отказов', () => {
  const uid = user();
  for (let i = 0; i < 2; i++) {
    const slug = vacancy(`hh-rare-${i}`, 'Аналитик (Tableau)');
    application({ uid, slug, sentDaysAgo: 20, viewedDaysAgo: 19, response: 'decline' });
  }

  const actions = nextActions(uid, NOW);
  assert.equal(
    actions.find((a) => a.kind === 'declines'),
    undefined,
    'по двум отказам делается вывод о причине — это шум',
  );
});

test('анализ отказов: при отсутствии общего требования говорит прямо об этом', () => {
  const apps = [
    { title: 'Дизайнер интерфейсов' },
    { title: 'Менеджер по продажам' },
    { title: 'Инженер по надёжности' },
  ].map((a, i) => ({
    id: i,
    job_slug: `x${i}`,
    response: 'decline',
    response_note: '',
    message: '',
    sent_at: NOW,
    viewed_at: NOW,
    responded_at: NOW,
    title: a.title,
    company: '',
    source_url: null,
  }));

  const result = analyzeDeclines(apps as never);
  assert.ok(result, 'разбор не выполнен');
  assert.deepEqual(result!.skills, [], 'общие навыки не найдены, но выдуманы');
  assert.match(result!.detail, /не видно|не работают|не туда/i);
});

test('поиск без просмотров при многих откликах выделяется', () => {
  const uid = user();
  const searchId = Number(
    db
      .prepare(
        "INSERT INTO searches (user_id, title, keywords, active, created_at) VALUES (?, 'Узкий поиск', 'cobol', 1, ?)",
      )
      .run(uid, NOW).lastInsertRowid,
  );

  for (let i = 0; i < 6; i++) {
    const slug = vacancy(`hh-dead-${i}`, 'Программист');
    application({ uid, slug, sentDaysAgo: 10 + i, searchId });
  }

  const actions = nextActions(uid, NOW);
  const dead = actions.find((a) => a.kind === 'search');

  assert.ok(dead, 'мёртвый поиск не выделен');
  assert.match(dead!.title, /Узкий поиск/);
  assert.equal(dead!.count, 6);
});

test('поиск с просмотрами мёртвым не считается', () => {
  const uid = user();
  const searchId = Number(
    db
      .prepare(
        "INSERT INTO searches (user_id, title, keywords, active, created_at) VALUES (?, 'Рабочий поиск', 'react', 1, ?)",
      )
      .run(uid, NOW).lastInsertRowid,
  );

  for (let i = 0; i < 6; i++) {
    const slug = vacancy(`hh-live-${i}`, 'React-разработчик');
    application({ uid, slug, sentDaysAgo: 10 + i, viewedDaysAgo: 9 + i, searchId });
  }

  const actions = nextActions(uid, NOW);
  assert.equal(
    actions.find((a) => a.kind === 'search'),
    undefined,
  );
});

test('отклики без письма отмечаются, когда их достаточно много', () => {
  const uid = user();
  for (let i = 0; i < 4; i++) {
    const slug = vacancy(`hh-noletter-${i}`, 'React-разработчик');
    application({ uid, slug, sentDaysAgo: 5 + i, message: '' });
  }

  const actions = nextActions(uid, NOW);
  const noLetter = actions.find((a) => a.kind === 'profile');

  assert.ok(noLetter, 'отклики без письма не отмечены');
  assert.equal(noLetter!.count, 4);
});

test('разбор отказов показывает факт, а не порог отсечения', () => {
  /*
   * Регрессия формулировки: в текст подставлялась величина порога, а не
   * реальное число. Для четырёх отказов, где Kafka встречалась во всех
   * четырёх, выводилось «требовалось в 2 из 4». Человек читал это как «две
   * из четырёх вакансий требовали Kafka» и делал неверный вывод о том,
   * что дело в чём-то ещё.
   */
  const apps = Array.from({ length: 4 }, (_, i) => ({
    id: i,
    job_slug: `k${i}`,
    response: 'decline',
    response_note: '',
    message: '',
    sent_at: NOW,
    viewed_at: NOW,
    responded_at: NOW,
    title: 'Data Engineer Kafka ClickHouse',
    company: '',
    source_url: null,
  }));

  const result = analyzeDeclines(apps as never);
  assert.ok(result, 'разбор не выполнен');
  assert.match(result!.detail, /Kafka — 4 из 4/, `факт не показан: ${result!.detail}`);
  assert.doesNotMatch(
    result!.detail,
    /требовалось в 2 из 4/,
    'в тексте порог отсечения вместо фактического числа',
  );
});

/*
 * Регрессия: разбор читал только заголовок вакансии.
 *
 * Навыки отказа живут в требованиях («Требуется: Kafka» в requirements), а в
 * заголовке — «Backend-разработчик». Разбор видел «общих требований нет» там,
 * где все отказы были по одной Kafka, и советовал «проверьте резюме» вместо
 * «добавьте Kafka».
 */
test('разбор отказов видит требования, а не только заголовок (regression)', () => {
  const apps = Array.from({ length: 3 }, (_, i) => ({
    id: i,
    job_slug: `r${i}`,
    response: 'decline',
    response_note: '',
    message: '',
    sent_at: NOW,
    viewed_at: NOW,
    responded_at: NOW,
    title: 'Backend-разработчик',
    company: '',
    source_url: null,
    requirements: JSON.stringify(['Kafka, ClickHouse', 'Docker']),
    about: 'Команда ищет разработчика',
  }));

  const result = analyzeDeclines(apps as never);
  assert.ok(result, 'разбор не выполнен');
  assert.ok(
    result!.skills.includes('Kafka'),
    `Kafka из требований не найдена: ${JSON.stringify(result!.skills)}`,
  );
  assert.match(
    result!.title,
    /одних и тех же требованиях/,
    `паттерн не распознан: ${result!.title}`,
  );
});

test('склонение чисел не по умолчанию', () => {
  assert.equal(plural(1, 'чат', 'чата', 'чатов'), 'чат');
  assert.equal(plural(2, 'чат', 'чата', 'чатов'), 'чата');
  assert.equal(plural(5, 'чат', 'чата', 'чатов'), 'чатов');
  assert.equal(plural(11, 'чат', 'чата', 'чатов'), 'чатов', '11 — это «чатов», а не «чат»');
  assert.equal(plural(21, 'чат', 'чата', 'чатов'), 'чат', '21 — это «чат»');
  assert.equal(plural(12, 'чат', 'чата', 'чатов'), 'чатов');
});

test('текст напоминания короткий и без извинений', () => {
  const draft = followupDraft('ООО Тест', 'React-разработчик');
  assert.ok(draft.includes('ООО Тест'), 'компания не подставлена');
  assert.ok(draft.includes('React-разработчик'), 'вакансия не подставлена');
  assert.ok(draft.length < 400, `слишком длинное напоминание: ${draft.length} символов`);
  assert.doesNotMatch(draft, /извин|простите|смущ/i, 'извинения снижают шанс на ответ');
});
