import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Пробелы в навыках.
 *
 * Раздел «повышения квалификации» строит��я из данных человека, а не из
 * каталога курсов. Поэтому проверяется не «список есть», а три вещи, на которых
 * держится смысл: порядок определяется отказами, а не популярностью; навыки,
 * уже закрытые резюме, не попадают в список; и список принадлежит тому, кому
 * принадлежит.
 *
 * Третье — не теория. Первая версия брала «последнее резюме вообще» и все
 * отклики без фильтра: в общей базе это показывало человеку чужое резюме.
 * TypeScript такое не ловит, линтер — только как неиспользуемый параметр.
 */

type Database = ReturnType<typeof import('../src/lib/db').createDatabase>;

let db: Database;
let gaps: typeof import('../src/lib/skill-gaps');
let bot: typeof import('../src/lib/telegram-bot');
let resetCatalogCache: () => void;

before(async () => {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  db = (await import('../src/lib/db')).db;
  gaps = await import('../src/lib/skill-gaps');
  bot = await import('../src/lib/telegram-bot');
  resetCatalogCache = (await import('../src/lib/vacancies')).resetCatalogCache;
});

beforeEach(() => {
  db.exec(
    'DELETE FROM bookmarks; DELETE FROM applications; DELETE FROM searches; DELETE FROM resumes; DELETE FROM users; DELETE FROM vacancies;',
  );
  resetCatalogCache();
});

function seedUser(id: number, email: string): void {
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_expires_at, created_at, hh_token,
       hh_resume_id, telegram_chat_id, autoapply_paused, autoapply_blocked_until, autoapply_block_reason)
     VALUES (?, ?, 'h', 'pro', ?, ?, 't', 'r', ?, 0, 0, '')`,
  ).run(id, email, Date.now() + 100_000, Date.now(), String(id));
}

function seedResume(userId: number, content: string): void {
  db.prepare(
    `INSERT INTO resumes (user_id, title, content, hh_id, created_at, updated_at)
     VALUES (?, 'Frontend', ?, 'hh-1', ?, ?)`,
  ).run(userId, content, Date.now(), Date.now());
}

function seedVacancy(slug: string, title: string, company: string, about: string): void {
  db.prepare(
    `INSERT INTO vacancies (slug, source, source_id, title, company, salary, level, format, city,
       posted, published_at, category, about, requirements, fetched_at)
     VALUES (?, 'hh', ?, ?, ?, '200000', 'Middle', 'Удалённо', 'Москва',
       'сегодня', ?, 'Разработка', ?, '[]', ?)`,
  ).run(slug, slug, title, company, Date.now(), about, Date.now());
}

function seedApplication(userId: number, slug: string, response: string): void {
  db.prepare(
    `INSERT INTO applications (user_id, job_slug, status, response, response_note, message, sent_at, withdrawn)
     VALUES (?, ?, 'sent', ?, '', '', ?, 0)`,
  ).run(userId, slug, response, Date.now());
}

function seedSearch(userId: number, title: string, keywords: string): void {
  db.prepare(
    'INSERT INTO searches (user_id, title, keywords, active, started_at, created_at) VALUES (?, ?, ?, 1, ?, ?)',
  ).run(userId, title, keywords, Date.now(), Date.now());
}

test('отказ поднимает навык выше просто частого', () => {
  seedUser(1, 'a@example.test');
  seedResume(1, 'JavaScript, React');

  // Redis — частое требование, но отказов на него нет: с ним и так всё в порядке.
  for (let i = 0; i < 6; i++) {
    seedVacancy(`hh-redis-${i}`, 'Разработчик', 'Компания', 'Обязательно: Redis, Kafka');
    seedApplication(1, `hh-redis-${i}`, 'invite');
  }
  // Docker — редкое требование, но три отказа подряд.
  for (let i = 0; i < 3; i++) {
    seedVacancy(`hh-docker-${i}`, 'Разработчик', 'Компания', 'Обязательно: Docker, PostgreSQL');
    seedApplication(1, `hh-docker-${i}`, 'decline');
  }

  const report = gaps.computeSkillGaps(1);
  const order = report.gaps.map((g) => g.skill);
  const docker = order.indexOf('Docker');
  const redis = order.indexOf('Redis');

  assert.notEqual(docker, -1, `Docker не попал в список: ${JSON.stringify(order)}`);
  assert.notEqual(redis, -1, `Redis не попал в список: ${JSON.stringify(order)}`);
  assert.ok(
    docker < redis,
    `Docker должен стоять выше Redis, хотя встречается реже: порядок ${order.join(', ')}`,
  );
});

test('навык, который уже есть в резюме, в пробелы не попадает', () => {
  seedUser(1, 'a@example.test');
  seedResume(1, 'JavaScript, React, TypeScript, PostgreSQL');
  seedVacancy(
    'hh-one',
    'Разработчик',
    'Компания',
    'Требуется: React, TypeScript, PostgreSQL, Kubernetes',
  );
  seedApplication(1, 'hh-one', 'decline');

  const report = gaps.computeSkillGaps(1);
  const listed = report.gaps.map((g) => g.skill);

  for (const covered of ['React', 'TypeScript', 'PostgreSQL']) {
    assert.ok(!listed.includes(covered), `${covered} есть в резюме, но попал в пробелы`);
  }
  assert.ok(listed.includes('Kubernetes'), 'Kubernetes в резюме нет и должен попасть');
  assert.ok(
    report.covered.includes('React'),
    `закрытые навыки должны быть видны: ${JSON.stringify(report.covered)}`,
  );
});

test('подбор отсекает и чужие вакансии, и навыки, уже закрытые резюме', () => {
  seedUser(1, 'a@example.test');
  seedResume(1, 'JavaScript, React');
  seedSearch(1, 'Go-разработчик', 'golang');
  seedVacancy('hh-go-1', 'Go-разработчик в банк', 'Банк', 'Требуется: Go, PostgreSQL, Docker');
  // Подходит под поиск, но требует React — он в резюме есть, пробелом быть не может.
  seedVacancy('hh-go-2', 'Go-разработчик в сервис', 'Сервис', 'Требуется: Go, Redis, React');
  // Совсем не подходит: дизайнерская вакансия в каталоге есть, к поиску отношения не имеет.
  seedVacancy('hh-other', 'Дизайнер интерфейсов', 'Студия', 'Требуется: Figma, Terraform');

  const report = gaps.computeSkillGaps(1);
  const listed = report.gaps.map((g) => g.skill);

  assert.ok(listed.includes('Docker'), `Docker не найден: ${JSON.stringify(listed)}`);
  assert.ok(listed.includes('Redis'), `Redis не найден: ${JSON.stringify(listed)}`);
  assert.ok(
    !listed.includes('Terraform'),
    `ваканция вне подбора попала в пробелы: ${JSON.stringify(listed)}`,
  );
  assert.ok(
    !listed.includes('React'),
    `React есть в резюме, но попал в пробелы: ${JSON.stringify(listed)}`,
  );
  const docker = report.gaps.find((g) => g.skill === 'Docker')!;
  assert.ok(
    docker.inTarget > 0,
    `в подборе Docker считается как требование: ${JSON.stringify(docker)}`,
  );
  /*
   * targetedVacancies — число ВАКАНСИЙ в подборе, а не упоминаний навыков.
   *
   * Раньше здесь ожидалось 5: Go (2 вакансии) + PostgreSQL + Docker + Redis —
   * то есть считались упоминания, а называлось «вакансиями». Правильное
   * значение — 2: hh-go-1 и hh-go-2. hh-other в подбор не входит.
   */
  assert.equal(
    report.basis.targetedVacancies,
    2,
    `считаются вакансии, а не упоминания навыков: ${JSON.stringify(report.basis)}`,
  );
});

test('список принадлежит своему человеку: чужие отклики и резюме не видны', () => {
  seedUser(1, 'a@example.test');
  seedUser(2, 'b@example.test');
  seedResume(1, 'JavaScript');
  seedResume(2, 'JavaScript, React, TypeScript');

  seedVacancy('hh-mine', 'Разработчик', 'Моя', 'Требуется: Docker, Redis');
  seedVacancy('hh-theirs', 'Разработчик', 'Чужая', 'Требуется: Kubernetes, Terraform');
  seedApplication(1, 'hh-mine', 'decline');
  seedApplication(2, 'hh-theirs', 'decline');

  const first = gaps.computeSkillGaps(1).gaps.map((g) => g.skill);
  const second = gaps.computeSkillGaps(2).gaps.map((g) => g.skill);

  assert.ok(
    first.includes('Docker'),
    `у первого должны быть его пробелы: ${JSON.stringify(first)}`,
  );
  assert.ok(
    !first.includes('Kubernetes'),
    `у первого не должно быть чужих пробелов: ${JSON.stringify(first)}`,
  );
  assert.ok(
    !second.includes('Docker'),
    `у второго не должно быть чужих пробелов: ${JSON.stringify(second)}`,
  );
  assert.ok(
    second.includes('Kubernetes'),
    `у второго должны быть его пробелы: ${JSON.stringify(second)}`,
  );
});

test('без резюме список не выдумывается, а честно говорит, чего не хватает', () => {
  seedUser(1, 'a@example.test');
  seedVacancy('hh-one', 'Разработчик', 'Компания', 'Требуется: Docker');
  seedApplication(1, 'hh-one', 'decline');

  const report = gaps.computeSkillGaps(1);
  assert.equal(report.basis.resumeFound, false);
  assert.equal(report.gaps.length, 0, 'без резюме нельзя знать, чего не хватает');

  const reply = bot.replyFor('навыки', '', { id: 1 } as never);
  assert.match(
    reply.text,
    /резюм/i,
    `бот должен звать добавить резюме, а не выдумывать список: ${reply.text}`,
  );
});

test('команда /навыки в боте отдаёт список и ссылку на планы', () => {
  seedUser(1, 'a@example.test');
  seedResume(1, 'JavaScript, React');
  seedVacancy('hh-one', 'Разработчик', 'Компания', 'Требуется: Docker, PostgreSQL');
  seedApplication(1, 'hh-one', 'decline');

  const reply = bot.replyFor('навыки', '', { id: 1 } as never);
  assert.match(reply.text, /Docker/, `в ответе нет пробела: ${reply.text}`);
  assert.match(reply.text, /\/dashboard\/skills/, 'нет ссылки на полный список с планами');
  assert.ok(reply.keyboard, 'нет клавиатуры: из чата нечем вернуться в меню');
  /*
   * Список без «что делать» — это диагноз без лечения: человек узнаёт, чего
   * ему не хватает, и не получает ни первого шага. Для навыка с планом первый
   * шаг обязателен.
   */
  assert.match(reply.text, /Первым делом: /, `в ответе нет первого шага: ${reply.text}`);
  assert.match(reply.text, /Первым делом: [^<\s]/, `шаг не содержит текста: ${reply.text}`);
});

test('в ответе бота навык не ломает разметку', () => {
  seedUser(1, 'a@example.test');
  seedResume(1, 'JavaScript');
  // Название компании попадает в требования — и в строку ответа.
  seedVacancy('hh-x', 'Разработчик', 'Ромашка & Co', 'Требуется: Docker');
  seedApplication(1, 'hh-x', 'decline');

  const reply = bot.replyFor('навыки', '', { id: 1 } as never);
  // HTML-режим: «&» без экранирования ломает разметку Telegram.
  assert.ok(
    !/&(?![a-z]+;|#\d+;)/i.test(reply.text),
    `в ответе есть неэкранированный амперсанд: ${reply.text}`,
  );
});

test('план есть не у каждого навыка, и это не выдумывается', async () => {
  const { learningPath, skillsWithPaths } = await import('../src/lib/learning-paths');
  assert.ok(skillsWithPaths().length >= 10, 'планов должно быть достаточно, чтобы быть полезными');
  assert.ok(learningPath('Docker'), 'у Docker должен быть план');
  assert.equal(
    learningPath('Какой-то навык из воздуха'),
    null,
    'для неизвестного навыка план выдумываться не должен',
  );
});

test('каждый пункт плана проверяем: есть чем понять, что он закрыт', async () => {
  const { skillsWithPaths, learningPath } = await import('../src/lib/learning-paths');
  for (const skill of skillsWithPaths()) {
    const path = learningPath(skill)!;
    assert.ok(path.topics.length >= 2, `${skill}: слишком короткий план (${path.topics.length})`);
    for (const topic of path.topics) {
      assert.ok(topic.topic.length > 0, `${skill}: пункт без названия`);
      assert.ok(
        topic.done.length > 0,
        `${skill}: пункт «${topic.topic}» без критерия — как понять, что закрыт?`,
      );
      assert.ok(
        !/почувствуйте|освоить|понимать разницу|и так далее/i.test(topic.done),
        `${skill}: «${topic.done}» непроверяемо`,
      );
    }
  }
});
