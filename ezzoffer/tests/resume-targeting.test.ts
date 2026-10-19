import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rankVacancies,
  scoreResumes,
  overlapRatio,
  resumeSkills,
  type ResumeTarget,
} from '../src/lib/resume-targeting';
import type { Vacancy } from '../src/lib/vacancies/types';

/**
 * Подбор резюме под вакансию.
 *
 * Закрывает разрыв в основном цикле. Раньше подбор шёл по последнему
 * обновлённому резюме, а отправлялось `users.hh_resume_id` — другое. При двух
 * резюме («Python» и «React») система выбирала вакансии под Python, писала
 * письмо про Python и отправляла резюме React. Человек об этом не знал.
 *
 * Проверяется само назначение и порядок: оба должны считаться по одним и тем
 * же правилам, иначе выбор резюме и очередь вакансий могут противоречить друг
 * другу — вакансия отправится не тем резюме, которое для неё выбрано.
 */

function vacancy(slug: string, title: string, skills: string[], published = Date.now()): Vacancy {
  return {
    slug,
    source: 'hh',
    source_id: slug,
    title,
    company: 'Тест',
    salary: '',
    salary_min: null,
    salary_max: null,
    level: 'Middle',
    format: 'Удалённо',
    city: 'Москва',
    posted: 'сегодня',
    published_at: published,
    category: 'Разработка',
    about: `Требуются: ${skills.join(', ')}`,
    responsibilities: [],
    requirements: skills,
    bonus: [],
    source_url: null,
    contact_email: null,
    contact_phone: null,
  };
}

function resume(
  id: number,
  title: string,
  content: string,
  hh: string | null = `hh${id}`,
): ResumeTarget {
  return { id, title, content, hh_id: hh };
}

const python = resume(
  1,
  'Python-разработчик',
  'Опыт 6 лет. Python, Django, PostgreSQL, Celery, Redis.',
);
const react = resume(
  2,
  'React-разработчик',
  'Опыт 5 лет. React, TypeScript, Next.js, Redux, Vite.',
);

test('на вакансию фронтенда выбирается фронтендовое резюме', () => {
  const v = vacancy('hh-1', 'React-разработчик', ['React', 'TypeScript', 'Next.js']);
  const best = scoreResumes(v, [python, react])[0]!;
  assert.equal(best.resume.id, react.id, 'выбрано резюме не по профилю вакансии');
  assert.ok(best.ratio > 0, 'совпадение не посчитано');
});

test('на вакансию бэкенда выбирается бэкендовое резюме', () => {
  const v = vacancy('hh-2', 'Python-разработчик', ['Python', 'Django', 'PostgreSQL']);
  const best = scoreResumes(v, [python, react])[0]!;
  assert.equal(best.resume.id, python.id, 'выбрано резюме не по профилю вакансии');
});

test('одинаковые резюме не сдвигают выбор на пустом совпадении', () => {
  /*
   * Если совпадений нет вовсе, порядок должен остаться прежним — по времени
   * обновления. Иначе выбор резюме при нулевом пересечении становится
   * случайным, и человек получает отклик не по тому резюме.
   */
  const v = vacancy('hh-3', 'Дизайнер интерфейсов', ['Figma', 'Дизайн-системы']);
  const all = scoreResumes(v, [python, react]);
  assert.ok(
    all.every((r) => r.ratio === 0),
    'совпадение найдено там, где его нет',
  );
  assert.equal(all[0]!.resume.id, python.id, 'при нулевом совпадении порядок резюме нарушен');
});

test('вакансия под второе резюме не уходит в конец очереди', () => {
  /*
   * Регрессия старого поведения. Сортировка шла по пересечению с ОДНИМ
   * резюме, поэтому вакансия «React», идеально подходящая под второе резюме,
   * оказывалась в самом конце — просто потому, что с первым не пересекалась.
   * Человек с двумя резюме платил за это лимитом откликов: суточная квота
   * уходила на вакансии для одного профиля, а подходящие для второго
   * оставались неотправленными.
   */
  const front = vacancy('hh-front', 'React-разработчик', ['React', 'TypeScript', 'Next.js']);
  const back = vacancy('hh-back', 'Python-разработчик', ['Python', 'Django', 'PostgreSQL']);
  // Первым в каталоге идёт бэкенд — чтобы «победила» именно вторая позиция.
  const ranked = rankVacancies([back, front], [react, python]);

  assert.equal(
    ranked[0]!.vacancy.slug,
    'hh-front',
    'вакансия под второе резюме не получила приоритет',
  );
  assert.equal(ranked[0]!.resume?.id, react.id, 'на неё назначено не то резюме');
  assert.equal(ranked[1]!.resume?.id, python.id, 'на бэкенд назначено не то резюме');
});

test('порядок устойчив при полном равенстве', () => {
  /*
   * Если порядок меняется от прогона к прогону, человек не может понять, что
   * происходит: одни и те же вакансии то отправляются, то нет. При равенстве
   * сохраняется порядок каталога.
   */
  const a = vacancy('hh-a', 'Разработчик', ['React']);
  const b = vacancy('hh-b', 'Разработчик', ['React']);
  const first = rankVacancies([a, b], [python, react]).map((r) => r.vacancy.slug);
  const second = rankVacancies([a, b], [react, python]).map((r) => r.vacancy.slug);
  assert.deepEqual(first, second, `порядок зависит от порядка резюме: ${first} / ${second}`);
});

test('резюме без привязки к hh не отправляется, но участвует в оценке', () => {
  /*
   * hh принимает только свой id. Резюме, заведённое вручную, годится для
   * оценки и письма, но подставлять его как resume_id — значит отправить на hh
   * мусор. Поэтому выбор и отправка разделены: выбор есть, отправка идёт от
   * привязанного либо от общего hh_resume_id.
   */
  const manual = resume(3, 'Тестовое резюме', 'React, TypeScript, Next.js, Redux, Vite', null);
  const v = vacancy('hh-4', 'React-разработчик', ['React', 'TypeScript', 'Next.js']);

  const ranked = rankVacancies([v], [manual, react]);
  assert.equal(ranked[0]!.resume?.hh_id, null, 'на вакансию назначено не привязанное резюме');

  // Оценка всё равно должна быть высокой — навыки те же.
  assert.ok(
    ranked[0]!.ratio > 0.9,
    `ручное резюме с теми же навыками не оценено: ${ranked[0]!.ratio}`,
  );
});

test('без резюме вакансии остаются в исходном порядке', () => {
  const list = [vacancy('hh-5', 'A', ['React']), vacancy('hh-6', 'B', ['Python'])];
  const ranked = rankVacancies(list, []);
  assert.deepEqual(
    ranked.map((r) => r.vacancy.slug),
    ['hh-5', 'hh-6'],
    'порядок нарушен без резюме',
  );
  assert.equal(ranked[0]!.resume, null, 'без резюме назначено что-то');
});

test('доля считается от требований вакансии, а не от числа совпадений', () => {
  /*
   * Простой счётчик совпадений всегда выигрывал у вакансии с длинным списком
   * требований: десять требований и два совпадения давали больше, чем три
   * требования и два совпадения, хотя вторая вакансия закрыта лучше.
   *
   * Навыки взяты настоящие: словарь отбрасывает выдуманные, и на буквах
   * «a, b, x, y» проверка считала бы ноль совпадений на пустом месте.
   */
  const resumeSet = new Set(['React', 'TypeScript', 'Python', 'Django']);
  // Все десять — настоящие навыки словаря: односимвольные и выдуманные он
  // отбрасывает, и проверка на них считала бы пересечение на пустом месте.
  const wide = new Set([
    'React',
    'TypeScript',
    'Java',
    'Kotlin',
    'Swift',
    'Go',
    'Rust',
    'Docker',
    'Scala',
    'PHP',
  ]);
  const narrow = new Set(['Python', 'Django', 'Flask']);
  assert.equal(overlapRatio(resumeSet, wide), 0.2);
  assert.equal(overlapRatio(resumeSet, narrow), 2 / 3);

  const scored = scoreResumes(vacancy('hh-wide', 'Разработчик', [...wide]), [
    resume(1, 'Резюме', 'Опыт: React, TypeScript, Python, Django'),
  ]);
  assert.ok(
    Math.abs(scored[0]!.ratio - 0.2) < 0.001,
    `доля посчитана неверно: ${scored[0]!.ratio}`,
  );
});

test('пустое резюме не ломает оценку', () => {
  const empty = resume(1, '', '');
  assert.equal(resumeSkills(empty).size, 0);
  const v = vacancy('hh-7', 'React-разработчик', ['React']);
  const scored = scoreResumes(v, [empty, react]);
  assert.equal(scored[0]!.resume.id, react.id, 'пустое резюме победило непустое');
});

test('навыки резюме считаются из названия и текста', () => {
  const s = resumeSkills(resume(1, 'Python-разработчик', 'Опыт: Django и PostgreSQL'));
  assert.ok(s.has('Python'), 'навык из названия не извлечён');
  assert.ok(s.has('Django'), 'навык из текста не извлечён');
});

/**
 * Регистр не влияет на совпадение.
 *
 * Словарь возвращает канонические названия, поэтому «react» и «React» должны
 * находить один и тот же навык. Если бы регистр расходился, пересечение
 * между резюме и вакансией молно обнулялось бы на половине реальных вакансий,
 * и выбор резюме выродился бы в случайность.
 */
test('регистр написания не влияет на совпадение', () => {
  const lower = scoreResumes(vacancy('hh-l', 'Разработчик', ['react', 'typescript']), [react])[0]!;
  const upper = scoreResumes(vacancy('hh-u', 'Разработчик', ['REACT', 'TYPESCRIPT']), [react])[0]!;
  assert.equal(lower.ratio, 1, `в нижнем регистре совпадение ${lower.ratio}`);
  assert.equal(upper.ratio, 1, `в верхнем регистре совпадение ${upper.ratio}`);
});

test('синонимы вакансии находят навык резюме', () => {
  // В hh «Postgres» — это тот же навык, что «PostgreSQL».
  const scored = scoreResumes(vacancy('hh-syn', 'Разработчик', ['Postgres', 'Docker']), [
    resume(1, 'Резюме', 'Опыт: PostgreSQL и Docker'),
  ]);
  assert.ok(scored[0]!.ratio > 0.5, `синоним не сопоставлен: ${scored[0]!.ratio}`);
});
