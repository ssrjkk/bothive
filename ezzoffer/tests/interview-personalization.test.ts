import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareInterview, extractAchievements } from '../src/lib/interview';

/**
 * Подготовка к собеседованию опирается на резюме.
 *
 * До этого резюме влияло на подготовку только через подсчёт совпадений
 * навыков, а сами вопросы строились по вакансии. Для резюме «React» и «Python»
 * набор вопросов выходил практически одинаковым — то есть обещание
 * «подготовим под ваше резюме» не обеспечивалось ничем.
 *
 * Проверяется именно различимость: два разных резюме должны давать разные
 * вопросы. Проверка «вопросов достаточно много» этого не ловила — их и раньше
 * было много, просто одинаковых.
 */

const VACANCY = {
  title: 'Senior React Developer',
  company: 'ООО Дата',
  level: 'Senior' as const,
  about: 'Требуются: React, TypeScript, Next.js, Webpack',
  requirements: ['React', 'TypeScript', 'Next.js', 'Webpack'],
};

const FRONT_RESUME = [
  'Frontend Developer',
  'Опыт 6 лет.',
  'Сократил время загрузки приложения на 40%: LCP с 4.2с до 1.6с.',
  'Внедрил Storybook, онбординг сократился с 5 дней до 2.',
  'Пишу на React и TypeScript.',
].join('\n');

const BACK_RESUME = [
  'Backend Developer',
  'Опыт 8 лет.',
  'Сократил время отчёта с 40с до 3с за счёт перехода на PostgreSQL.',
  'Развернул Kafka для событийной обработки.',
].join('\n');

// ------------------------------------------------------------- извлечение

test('достижение с цифрой извлекается', () => {
  const a = extractAchievements(FRONT_RESUME);
  assert.equal(a.length, 2, `извлечено ${a.length}: ${JSON.stringify(a)}`);
  assert.match(a[0]!, /40%|LCP/, `первым должно идти достижение: ${a[0]}`);
});

test('тезис без цифры не считается достижением', () => {
  // «Пишу на React» — это тезис, а не результат. Вопрос «расскажите, как это
  // получилось» к такой строке бессмыслен.
  const a = extractAchievements(FRONT_RESUME);
  assert.ok(
    a.every((x) => !x.includes('Пишу на React')),
    `в достижения попал тезис без результата: ${JSON.stringify(a)}`,
  );
});

test('строка со стажем не считается достижением', () => {
  /*
   * Строка намеренно длинная: раньше порог длины отсекал её раньше фильтра
   * стажа, и фильтр можно было выбросить — тест оставался зелёным. Теперь
   * проверяется именно он.
   */
  const resume = [
    'Опыт: 8 лет коммерческой разработки, из них 3 года в команде.',
    'Сократил время сборки на 40% за счёт перехода на кеш зависимостей.',
  ].join('\n');
  const a = extractAchievements(resume);
  assert.equal(a.length, 1, `извлечено ${a.length}: ${JSON.stringify(a)}`);
  assert.ok(!a[0]!.startsWith('Опыт'), `в достижения попал стаж: ${a[0]}`);
});

test('телефон не попадает в достижения', () => {
  // Тоже длиннее порога: иначе проверялась бы длина, а не фильтр телефона.
  const resume = [
    'Мобильный +7 999 123-45-67, готов переехать в другой город.',
    'Сократил загрузку приложения на 40% за счёт кеширования ответов.',
  ].join('\n');
  const a = extractAchievements(resume);
  assert.equal(a.length, 1, `извлечено ${a.length}: ${JSON.stringify(a)}`);
  assert.ok(!a[0]!.includes('999'), `телефон попал в достижения: ${a[0]}`);
});

test('слишком длинная строка не считается достижением', () => {
  // Абзац с цифрой внутри: вопрос «как это получилось» к нему не по адресу.
  const long =
    'Мы внедрили платформу ' +
    'и очень подробно описали каждый этап внедрения. '.repeat(4) +
    'Она дала 40% прироста.';
  const resume = [long, 'Сократил загрузку приложения на 40% за счёт кеширования.'].join('\n');
  const a = extractAchievements(resume);
  assert.equal(a.length, 1, `извлечено ${a.length}: ${JSON.stringify(a)}`);
  assert.ok(a[0]!.length <= 220, `в достижения попал абзац длиной ${a[0]!.length}`);
});

test('маркеры списка снимаются', () => {
  // Резюме часто пишут буллитами; в вопросе маркер не нужен.
  const a = extractAchievements('- Сократил загрузку приложения на 40% за счёт кеша');
  assert.equal(a.length, 1);
  assert.ok(!a[0]!.startsWith('-'), `маркер остался: ${a[0]}`);
});

test('пустое резюме не ломает разбор', () => {
  assert.deepEqual(extractAchievements(''), []);
  assert.deepEqual(extractAchievements('   \n  \n'), []);
});

// ------------------------------------------------------------- различимость

/**
 * Два разных резюме — два разных набора вопросов.
 *
 * Прямая проверка недостатка: до исправления эти два вызова давали почти
 * одинаковый результат, и всё остальное в тестах на это не смотрело.
 */
test('разные резюме дают разные вопросы', () => {
  const a = prepareInterview(VACANCY, FRONT_RESUME, 'Frontend Developer');
  const b = prepareInterview(
    { ...VACANCY, requirements: ['Django', 'PostgreSQL', 'Celery', 'Redis'] },
    BACK_RESUME,
    'Backend Developer',
  );

  assert.notDeepEqual(
    a.questions.map((q) => q.question),
    b.questions.map((q) => q.question),
    'подготовка не зависит от резюме — это и была недостающая персонализация',
  );
});

test('вопросы ссылаются на конкретные достижения человека', () => {
  const a = prepareInterview(VACANCY, FRONT_RESUME, 'Frontend Developer');
  const achievement = a.questions.find((q) => q.category === 'achievement');
  assert.ok(achievement, 'нет вопроса о достижении из резюме');
  assert.match(
    achievement!.question,
    /40%|LCP/,
    `вопрос не ссылается на достижение из резюме: ${achievement!.question.slice(0, 120)}`,
  );
});

test('вопрос о себе называет козыри, а не позицию в общем', () => {
  /*
   * Было: «Расскажите о себе так, чтобы это было про позицию X». Теперь в
   * вопросе перечислены конкретные совпадения — человек видит, с чего начать.
   */
  const a = prepareInterview(VACANCY, FRONT_RESUME, 'Frontend Developer');
  const about = a.questions.find((q) => q.category === 'about-you')!;
  assert.match(about.question, /React|TypeScript/i, `в вопросе нет козырей: ${about.question}`);
});

test('без достижений вопрос о себе остаётся рабочим', () => {
  /*
   * Резюме без единого совпадения с вакансией — худший случай. Козырей нет,
   * значит вопрос должен откатиться к привязке к позиции, а не повиснуть с
   * пустым списком «через то, что пересекается».
   */
  const unrelated = 'Опыт работы в другой области. Занимался логистикой и складом несколько лет.';
  const a = prepareInterview(VACANCY, unrelated, 'Логист');
  const about = a.questions.find((q) => q.category === 'about-you')!;
  assert.ok(
    about.question.includes(VACANCY.title),
    `вопрос не привязан к позиции при пустых козырях: ${about.question}`,
  );
  assert.ok(
    !/пересекается/.test(about.question),
    `вопрос обещает пересечение, которого нет: ${about.question}`,
  );
  assert.ok(a.questions.length >= 3, 'вопросов слишком мало для пустого резюме');
});

test('достижения доступны в ответе API-подготовки', () => {
  const a = prepareInterview(VACANCY, FRONT_RESUME, 'Frontend Developer');
  assert.ok(Array.isArray(a.achievements), 'достижения не отдаются из prepareInterview');
  assert.ok(a.achievements.length > 0, 'достижения пусты при заполненном резюме');
});
