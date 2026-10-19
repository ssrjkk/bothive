import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareInterview, vacancyBrief } from '../src/lib/interview';

/**
 * Подготовка к собеседованию.
 *
 * Проверяется не «список вопросов вернулся», а то, что он построен из
 * ЭТОЙ вакансии и ЭТОГО резюме. Общий список советов, одинаковый для всех,
 * не помогает готовиться: человек тратит время на чтение и не узнаёт ничего
 * о своей конкретной ситуации.
 */

const VACANCY = {
  title: 'Senior Data Engineer',
  company: 'ООО Дата',
  level: 'Senior' as const,
  about: 'Строим платформу на Kafka и ClickHouse. Нужны Python и Airflow.',
  requirements: [
    'Опыт с Kafka и ClickHouse',
    'Python для обработки данных',
    'Airflow для оркестрации',
  ],
};

const RESUME =
  'Data Engineer, 6 лет. Python, PostgreSQL, Spark, Docker. Сократил время обработки на 40%.';

test('вопросы строятся из требований вакансии', () => {
  const prep = prepareInterview(VACANCY, RESUME, 'Senior Data Engineer');

  const all = prep.questions.map((q) => q.question).join(' | ');
  assert.match(all, /Kafka|ClickHouse|Airflow|Python/i, `требования не отражены: ${all}`);

  const firstRequirement = prep.questions.find((q) => q.category === 'experience');
  assert.ok(firstRequirement, 'нет вопроса по опыту');
  assert.match(
    firstRequirement.question,
    /Kafka/i,
    `вопрос по опыту не опирается на требование: ${firstRequirement.question}`,
  );
});

test('пробелы в резюме становятся вопросами', () => {
  /*
   * Самая ценная часть: о том, чего в резюме нет, спросят почти наверняка, и
   * почти всегда это то, чего человек не ждёт. Подготовить список заранее
   * дешевле, чем отвечать на ходу.
   */
  const prep = prepareInterview(VACANCY, RESUME, 'Senior Data Engineer');

  assert.ok(prep.riskyGaps.length > 0, 'пробелы не найдены');
  assert.ok(
    prep.riskyGaps.includes('Kafka'),
    `Kafka не найден среди пробелов: ${prep.riskyGaps.join(', ')}`,
  );

  const gapQuestions = prep.questions.filter((q) => q.category === 'gaps');
  assert.ok(gapQuestions.length > 0, 'вопросов по пробелам нет');
  /*
   * Проверяется любой из найденных пробелов, а не конкретный: порядок
   * задаётся словарём навыков, и он может измениться без правки теста.
   * Существенно то, что вопрос назван тем требованием, которого нет в
   * резюме, а не абстрактным «что бы вас спросили».
   */
  for (const q of gapQuestions) {
    assert.ok(
      prep.riskyGaps.some((gap) => q.question.includes(gap)),
      `вопрос по пробелу назван не тем требованием: ${q.question}`,
    );
    assert.ok(q.hint.length > 20, 'нет подсказки, как отвечать');
  }
  assert.ok(
    gapQuestions.every((q) => !q.question.includes('Python')),
    'Python спрошен как пробел, хотя он есть в резюме',
  );
});

test('пробелов не бывает, если резюме закрывает всё', () => {
  const fullResume =
    'Data Engineer. Kafka, ClickHouse, Python, Airflow, Docker, PostgreSQL. Опыт 6 лет.';
  const prep = prepareInterview(VACANCY, fullResume, 'Senior Data Engineer');

  assert.equal(prep.riskyGaps.length, 0, `найдены лишние пробелы: ${prep.riskyGaps.join(', ')}`);
});

test('сильные стороны отделены от пробелов', () => {
  const prep = prepareInterview(VACANCY, RESUME, 'Senior Data Engineer');
  assert.ok(
    prep.strongCards.includes('Python'),
    `Python не найден среди козырей: ${prep.strongCards.join(', ')}`,
  );
  assert.ok(!prep.strongCards.includes('Kafka'), 'Kafka попал и в козыри, и в пробелы');
});

test('есть вопрос о компании и о зарплате', () => {
  const prep = prepareInterview(VACANCY, RESUME, 'Senior Data Engineer');
  const categories = prep.questions.map((q) => q.category);

  assert.ok(categories.includes('company'), 'нет вопроса о компании');
  assert.ok(categories.includes('salary'), 'нет вопроса о зарплате');
});

test('вопрос о компании называет конкретную компанию', () => {
  // Общий вопрос «расскажите о компании» без названия бесполезен: человек
  // не знает, о ком говорить.
  const prep = prepareInterview(VACANCY, RESUME, 'Senior Data Engineer');
  const company = prep.questions.find((q) => q.category === 'company')!;
  assert.match(
    company.question,
    /ООО Дата/,
    `название компании не подставлено: ${company.question}`,
  );
});

test('есть вопрос о себе, привязанный к позиции', () => {
  /*
   * Ищем по категории, а не по индексу. Раньше вопрос о себе был первым
   * всегда; теперь перед ним идут вопросы о достижениях из резюме — они
   * важнее, потому что именно на них человек чаще всего спотыкается.
   * Привязка к позиции проверяется здесь, порядок — отдельно.
   */
  const prep = prepareInterview(VACANCY, RESUME, 'Senior Data Engineer');
  const about = prep.questions.find((q) => q.category === 'about-you')!;
  assert.ok(about, 'нет вопроса о себе');
  /*
   * Вопрос называет либо позицию, либо конкретные пересечения с резюме. Раньше
   * проверялась только позиция, и после перехода на козыри тест стал проверять
   * не то свойство: называть пересечения полезнее, чем повторять название
   * вакансии, которое человек и так видит в шапке.
   */
  assert.match(
    about.question,
    /Senior Data Engineer|пересекается/i,
    `вопрос не привязан ни к позиции, ни к пересечениям: ${about.question}`,
  );
});

test('вопросы о достижениях идут раньше общего рассказа о себе', () => {
  // Порядок — часть ценности: разбор своих достижений готовит к вопросу,
  // который придёт сразу после «расскажите о себе».
  const prep = prepareInterview(VACANCY, RESUME, 'Senior Data Engineer');
  const aboutIdx = prep.questions.findIndex((q) => q.category === 'about-you');
  const achievementIdx = prep.questions.findIndex((q) => q.category === 'achievement');
  if (achievementIdx === -1) return; // резюме без достижений — порядок не важен
  assert.ok(
    achievementIdx < aboutIdx,
    `вопрос о себе идёт раньше разбора достижений: ${achievementIdx} / ${aboutIdx}`,
  );
});

test('подсказка к зарплате говорит, что говорить', () => {
  const prep = prepareInterview(VACANCY, RESUME, 'Senior Data Engineer');
  const salary = prep.questions.find((q) => q.category === 'salary')!;
  assert.match(salary.hint, /вилк/i, `нет совета о вилке: ${salary.hint}`);
});

test('чеклист пригоден и не пуст', () => {
  const prep = prepareInterview(VACANCY, RESUME, 'Senior Data Engineer');
  assert.ok(prep.checklist.length >= 4, 'чеклист слишком короткий');
  assert.ok(
    prep.checklist.some((c) => c.includes('ООО Дата')),
    'в чеклисте нет компании — готовиться будет не о чем',
  );
});

test('разбор вакансии объясним и сходится с суммой факторов', () => {
  const vacancy = {
    ...VACANCY,
    slug: 'x',
    source: 'hh' as const,
    source_id: '1',
    salary: '200000',
    salary_min: 200000,
    salary_max: null,
    format: 'Удалённо' as const,
    city: 'Москва',
    posted: '',
    published_at: null,
    category: '',
    responsibilities: [],
    bonus: [],
    source_url: null,
    contact_email: null,
    contact_phone: null,
  };

  const brief = vacancyBrief(vacancy, RESUME, 'Senior Data Engineer');
  const sum = brief.factors.reduce((acc, f) => acc + f.earned, 0);

  assert.equal(brief.score, sum, 'итог не равен сумме факторов');
  assert.equal(brief.leadRequirement, VACANCY.requirements[0]);
  for (const f of brief.factors) {
    assert.ok(f.detail.length > 0, `фактор «${f.label}» без объяснения`);
  }
});

test('подготовка работает и без требований в вакансии', () => {
  const prep = prepareInterview(
    { ...VACANCY, requirements: [], about: '' },
    RESUME,
    'Senior Data Engineer',
  );
  assert.ok(prep.questions.length >= 3, 'вопросов слишком мало');
  assert.equal(
    prep.questions.filter((q) => q.category === 'experience').length,
    0,
    'вопрос по опыту без требований выдуман',
  );
});
