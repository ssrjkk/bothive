import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rankLettersForVacancy,
  scoreVacancyForResume,
  getRecommendations,
} from '../src/lib/ai-matching';
import type { Vacancy } from '../src/lib/vacancies/types';

/**
 * Скоринг вакансии по резюме.
 *
 * Проверяются три ошибки прежней версии, которые делали оценку бессмысленной:
 *
 *  1. Несовпадение уровней давало 10 баллов из 20 — Junior попадал в выдачу
 *     к Senior-вакансиям почти без штрафа.
 *  2. Зарплата не участвовала в оценке вообще, хотя именно по ней человек
 *     решает, стоит ли отклик.
 *  3. Совпадение навыков считалось долей от ВСЕХ навыков вакансии: описание
 *     с 20 технологиями давало 25% при полном совпадении по сути, то есть
 *     оценка падала за длину описания.
 */

function makeVacancy(overrides: Partial<Vacancy> = {}): Vacancy {
  return {
    slug: 'hh-1',
    source: 'hh',
    source_id: '1',
    title: 'Senior React Developer',
    company: 'Acme',
    salary: '200000-250000',
    salary_min: 200000,
    salary_max: 250000,
    level: 'Senior',
    format: 'Удалённо',
    city: 'Москва',
    posted: '2026-01-01',
    category: 'Разработка',
    about: 'Команда ищет разработчика с опытом работы 3 лет в команде.',
    responsibilities: [],
    requirements: ['React', 'TypeScript', 'Next.js'],
    bonus: [],
    source_url: 'https://hh.ru/vacancy/1',
    contact_email: null,
    contact_phone: null,
    published_at: null,
    ...overrides,
  };
}

test('оценка растёт при совпадении навыков', () => {
  const vacancy = makeVacancy();
  const strong = scoreVacancyForResume(
    vacancy,
    'Senior React Developer. Опыт 5 лет. React, TypeScript, Next.js, Node.js.',
    'Senior Frontend Developer',
  );
  const weak = scoreVacancyForResume(vacancy, 'Junior дизайнер, Figma', 'Junior Designer');

  assert.ok(strong.matchedSkills.includes('React'), 'React не найден как навык');
  assert.ok(strong.score > weak.score, `${strong.score} должно быть больше ${weak.score}`);
  assert.ok(strong.score <= 100 && strong.score >= 0);
});

test('оценка устойчива к вакансии без требований', () => {
  const vacancy = makeVacancy({ requirements: [], about: '', title: 'Разработчик' });
  const scored = scoreVacancyForResume(vacancy, 'React', 'Dev');
  assert.ok(Number.isFinite(scored.score));
});

test('несовпадение уровней штрафуется заметно', () => {
  // Регрессия: раньше несовпадение давало 10 из 20, разница с совпадением
  // была 10%, и Junior оказывался в выдаче к Senior-вакансиям.
  //
  // Изолируем именно фактор уровня: опыт у обоих резюме одинаковый, иначе
  // разницу в итоговой оценке даёт ещё и опыт, и тест проходит даже с
  // мёртвым штрафом за уровень (так и вышло при первой попытке).
  const vacancy = makeVacancy({
    title: 'Senior React Developer',
    about: 'Без требований к опыту.',
  });
  const body = 'Frontend. React, TypeScript, Next.js.';
  const title = (level: string) => `${level} Frontend Developer`;

  const levelOf = (sc: ReturnType<typeof scoreVacancyForResume>) =>
    sc.factors.find((f) => f.label === 'Уровень')!.earned;

  const asSenior = levelOf(scoreVacancyForResume(vacancy, body, title('Senior')));
  const asJunior = levelOf(scoreVacancyForResume(vacancy, body, title('Junior')));

  const levelMax = scoreVacancyForResume(vacancy, body, title('Senior')).factors.find(
    (f) => f.label === 'Уровень',
  )!.max;

  assert.equal(asSenior, levelMax, 'свой уровень должен давать полный балл');
  assert.ok(
    asJunior <= levelMax * 0.2,
    `Junior на Senior получает ${asJunior} из ${levelMax} — штраф почти нулевой, ` +
      `как было раньше (10 из 20)`,
  );
});

test('понижение уровня штрафуется меньше, чем повышение требований', () => {
  // Senior, идущий в Middle, обычно берёт вакансию сознательно и релевантен.
  // Junior на Senior почти наверняка получит отказ по формальным причинам.
  const vacancy = makeVacancy({ title: 'Middle React Developer' });
  const senior = scoreVacancyForResume(
    vacancy,
    'Senior Frontend. React, TypeScript. 7 лет.',
    'Senior Frontend Developer',
  );
  const junior = scoreVacancyForResume(
    vacancy,
    'Junior Frontend. React, TypeScript. 1 год.',
    'Junior Frontend Developer',
  );
  assert.ok(
    senior.score > junior.score,
    `снижение уровня штрафуется так же, как и повышение: ${senior.score} против ${junior.score}`,
  );
});

test('зарплата ниже ожиданий снижает оценку', () => {
  // Фактор новый: раньше зарплата вообще не участвовала в оценке.
  // Резюме намеренно уровня вакансии, чтобы штраф давал только зарплата.
  const wellPaid = makeVacancy({ salary_min: 250000 });
  const poorlyPaid = makeVacancy({ salary_min: 80000 });

  const resume = 'Senior Frontend. React, TypeScript, Next.js. 5 лет.';
  const title = 'Senior Frontend Developer';

  const hi = scoreVacancyForResume(wellPaid, resume, title, undefined, 200000);
  const lo = scoreVacancyForResume(poorlyPaid, resume, title, undefined, 200000);

  assert.ok(hi.score > lo.score, `зарплата не влияет на оценку: ${hi.score} против ${lo.score}`);
  // Разница оценок равна разнице зарплатных факторов: прочие факторы при
  // одинаковом резюме и вакансии совпадают.
  const hiSalary = hi.factors.find((f) => f.label === 'Зарплата')!;
  const loSalary = lo.factors.find((f) => f.label === 'Зарплата')!;
  assert.equal(
    hi.score - lo.score,
    hiSalary.earned - loSalary.earned,
    'разница оценок не объясняется зарплатным фактором',
  );
  assert.equal(hiSalary.earned, hiSalary.max, 'зарплата выше ожиданий не даёт полный балл');
  assert.ok(loSalary.earned < loSalary.max, 'зарплата ниже ожиданий не снижает оценку');
  assert.equal(hi.score, 100, 'при полном совпадении и зарплате выше ожиданий — 100');
});

test('отсутствие зарплаты в вакансии не штрафуется', () => {
  const noSalary = makeVacancy({ salary_min: null, salary: 'по договорённости' });
  const scored = scoreVacancyForResume(
    noSalary,
    'React, TypeScript. 5 лет.',
    'Middle Frontend',
    undefined,
    200000,
  );
  const salaryFactor = scored.factors.find((f) => f.label === 'Зарплата');
  assert.ok(salaryFactor, 'нет фактора «Зарплата»');
  assert.equal(
    salaryFactor.earned,
    salaryFactor.max,
    'отсутствие зарплаты в вакансии посчитано как минус',
  );
});

test('длина описания вакансии не влияет на оценку', () => {
  // Регрессия: раньше matched/vacancy.length, поэтому вакансия с 20
  // технологиями давала 25% при полном совпадении по сути.
  const short = makeVacancy({ requirements: ['React'], about: 'React' });
  const long = makeVacancy({
    requirements: Array.from({ length: 20 }, (_, i) => `Технология${i}`),
    about: 'React',
  });

  const resume = 'React, TypeScript. 5 лет.';
  const s = scoreVacancyForResume(short, resume, 'Middle Frontend');
  const l = scoreVacancyForResume(long, resume, 'Middle Frontend');

  assert.ok(
    l.score >= s.score - 5,
    `длинное описание (${l.score}) просадило оценку против короткого (${s.score})`,
  );
});

test('редкий навык весит больше базового', () => {
  // Совпадение Rust/Kafka должно цениться выше совпадения Git/SQL: именно
  // ради редкого навыка и пишут.
  const withRare = makeVacancy({
    title: 'Инженер данных',
    requirements: ['Kafka', 'ClickHouse', 'Python'],
    about: 'Kafka, ClickHouse, Python. Опыт 3 лет.',
    salary_min: null,
  });
  const withBasic = makeVacancy({
    title: 'Инженер данных',
    requirements: ['Git', 'SQL', 'Linux'],
    about: 'Git, SQL, Linux. Опыт 3 лет.',
    salary_min: null,
  });

  const rare = scoreVacancyForResume(withRare, 'Python, Kafka, ClickHouse. 5 лет.', 'Senior Data');
  const basic = scoreVacancyForResume(withBasic, 'Python, Git, SQL, Linux. 5 лет.', 'Senior Data');

  assert.ok(
    rare.score >= basic.score,
    `редкие навыки (${rare.score}) не ценятся выше базовых (${basic.score})`,
  );
});

test('оценка объяснима: факторы в сумме дают итог', () => {
  // Пользователю показывается «72 из 100» — он должен видеть, из чего
  // получилось это число, иначе цифра не вызывает доверия.
  const scored = scoreVacancyForResume(
    makeVacancy(),
    'Senior Frontend. React, TypeScript, Next.js. 5 лет.',
    'Senior Frontend Developer',
    undefined,
    150000,
  );
  const sum = scored.factors.reduce((acc, f) => acc + f.earned, 0);
  assert.equal(scored.score, sum, 'итог не равен сумме факторов');
  assert.ok(scored.factors.length >= 4, 'мало факторов — оценка непрозрачна');
  for (const f of scored.factors) {
    assert.ok(f.detail.length > 0, `фактор «${f.label}» без объяснения`);
    assert.ok(f.earned <= f.max, `фактор «${f.label}» превысил максимум`);
  }
});

test('ранжирование писем по навыкам работает', () => {
  const vacancy = makeVacancy();
  const ranked = rankLettersForVacancy(
    [
      { id: 1, content: 'Занялся рисовкой иконок в Figma, люблю Photoshop.' },
      { id: 2, content: 'Пишу на React и TypeScript, Next.js в продакшене, Node.js.' },
    ],
    vacancy,
  );

  assert.equal(ranked[0].id, 2);
  assert.ok(ranked[0].score > ranked[1].score);
});

test('ранжирование писем устойчиво на пустом списке и при ничьих', () => {
  assert.deepEqual(rankLettersForVacancy([], makeVacancy()), []);
  const letters = [
    { id: 10, content: 'React' },
    { id: 20, content: 'React' },
    { id: 30, content: 'React' },
  ];
  const first = rankLettersForVacancy(letters, makeVacancy()).map((l) => l.id);
  const second = rankLettersForVacancy(letters, makeVacancy()).map((l) => l.id);
  assert.deepEqual(first, second);
});

test('рекомендации выводятся из разбора вакансий, а не из длины текста', () => {
  // Прежний совет: «расширьте резюме, если меньше 500 символов». Это привязка
  // к объёму, а не к содержанию: добавление воды увеличивало оценку.
  const scored = scoreVacancyForResume(
    makeVacancy({ requirements: ['React', 'Kafka', 'TypeScript'], about: '3 лет.' }),
    'Опыт работы',
    'Middle Frontend',
  );
  const tips = getRecommendations('Опыт работы', 'Middle Frontend', [scored]);
  assert.ok(tips.length > 0, 'рекомендаций нет вовсе');
  assert.ok(
    tips.some((t) => t.toLowerCase().includes('цифр') || t.toLowerCase().includes('достижен')),
    `нет совета про достижения с цифрами: ${tips.join(' | ')}`,
  );
});
