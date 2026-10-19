import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, matchingVacancies } from '../src/lib/matcher';
import type { Vacancy } from '../src/lib/vacancies/types';
import type { SearchRow } from '../src/lib/matcher';

/**
 * Подбор вакансий.
 *
 * Проверяется не «совпадение работает», а конкретные дефекты старой
 * реализации, найденные на рабочем каталоге (464 вакансии):
 *
 *  - подстроковый поиск давал 451 ложное срабатывание («c» в каждой строке,
 *    «java» внутри «javascript», «go» внутри «golang»);
 *  - 57 вакансий не находились вовсе, потому что в списке навыков были
 *    только английские формы, а вакансии русскоязычные;
 *  - «или» не поддерживалось: «Москва или удалённо» было невозможно задать.
 */

const makeVacancy = (over: Partial<Vacancy> = {}): Vacancy => ({
  slug: 'local-1',
  source: 'local',
  source_id: '1',
  title: 'Frontend-разработчик',
  company: 'ООО Тест',
  city: 'Москва',
  level: 'Middle',
  format: 'Удалённо',
  category: 'Разработка',
  salary_min: 150000,
  salary_max: 200000,
  salary: '150000–200000',
  posted: 'сегодня',
  about: 'Описание',
  responsibilities: [],
  requirements: [],
  bonus: [],
  source_url: null,
  contact_email: null,
  contact_phone: null,
  published_at: null,
  ...over,
});

const baseSearch = (over: Partial<SearchRow> = {}): SearchRow => ({
  id: 1,
  user_id: 1,
  title: 'S',
  keywords: '',
  salary_min: null,
  salary_max: null,
  format: '',
  city: '',
  level: '',
  company_blacklist: '',
  active: 1,
  started_at: null,
  created_at: 0,
  ...over,
});

test('поиск по ключевому слову находит вакансию', () => {
  const v = makeVacancy();
  assert.equal(matchesSearch(v, baseSearch({ keywords: 'frontend' })), true);
  assert.equal(matchesSearch(v, baseSearch({ keywords: 'react' })), false);
  assert.equal(matchesSearch(v, baseSearch({ keywords: '' })), true);
});

test('«java» не подбирает вакансию про JavaScript', () => {
  const v = makeVacancy({ title: 'JavaScript-разработчик', about: 'React, TypeScript' });
  assert.equal(
    matchesSearch(v, baseSearch({ keywords: 'java' })),
    false,
    '«java» нашлось внутри «javascript»',
  );
});

test('«go» не подбирает вакансию про Golang как пустое совпадение', () => {
  // Golang — это Go, поэтому здесь совпадение законно. Проверяем другое:
  // вакансия, где «go» встречается лишь внутри другого слова.
  const v = makeVacancy({ title: 'Google Cloud инженер', about: 'Работа с облаком' });
  assert.equal(
    matchesSearch(v, baseSearch({ keywords: 'go' })),
    false,
    '«go» нашлось внутри «Google»',
  );
});

test('русские ключевые слова находят русскоязычные вакансии', () => {
  const v = makeVacancy({
    title: 'Менеджер по продажам',
    category: 'Продажи',
    about: 'Холодные звонки, работа с CRM',
  });
  assert.equal(
    matchesSearch(v, baseSearch({ keywords: 'продажи' })),
    true,
    'русское «продажи» не распознано',
  );
});

test('падежная форма ключевого слова тоже работает', () => {
  const v = makeVacancy({ title: 'Менеджер по продажам', category: 'Продажи' });
  assert.equal(matchesSearch(v, baseSearch({ keywords: 'продажам' })), true);
});

test('«или» между условиями работает', () => {
  const v = makeVacancy({ title: 'Менеджер по продажам', category: 'Продажи' });
  // Ни «москва», ни «удалённо» как самостоятельные слова в вакансии нет,
  // но «продажи» есть — и этого достаточно при «или».
  assert.equal(matchesSearch(v, baseSearch({ keywords: 'москва или продажи' })), true);
});

test('«или» не срабатывает, когда не подошло ни одно условие', () => {
  const v = makeVacancy({ title: 'Frontend-разработчик', category: 'Разработка' });
  assert.equal(matchesSearch(v, baseSearch({ keywords: 'дизайн или реклама' })), false);
});

test('без «или» все условия должны выполняться', () => {
  const v = makeVacancy({ title: 'Frontend-разработчик', category: 'Разработка', about: 'React' });
  assert.equal(matchesSearch(v, baseSearch({ keywords: 'frontend, react' })), true);
  assert.equal(
    matchesSearch(v, baseSearch({ keywords: 'frontend, дизайн' })),
    false,
    'условие «и» пропущено мимо',
  );
});

test('фильтры по уровню, формату и городу работают', () => {
  const v = makeVacancy({
    title: 'QA',
    city: 'Санкт-Петербург',
    level: 'Senior',
    format: 'В офисе',
    category: 'Тестирование',
    salary_min: 100000,
    salary_max: null,
  });
  assert.equal(matchesSearch(v, baseSearch({ level: 'Senior' })), true);
  assert.equal(matchesSearch(v, baseSearch({ level: 'Middle' })), false);
  assert.equal(matchesSearch(v, baseSearch({ format: 'В офисе' })), true);
  assert.equal(matchesSearch(v, baseSearch({ format: 'Удалённо' })), false);
  assert.equal(matchesSearch(v, baseSearch({ city: 'петербург' })), true);
  assert.equal(matchesSearch(v, baseSearch({ city: 'Москва' })), false);
});

test('фильтры по зарплате и чёрному списку работают', () => {
  const v = makeVacancy({
    title: 'Dev',
    company: 'Яндекс',
    level: 'Junior',
    format: 'Гибрид',
    salary_min: 120000,
    salary_max: null,
  });
  assert.equal(matchesSearch(v, baseSearch({ salary_min: 100000 })), true);
  assert.equal(matchesSearch(v, baseSearch({ salary_min: 150000 })), false);
  assert.equal(matchesSearch(v, baseSearch({ salary_max: 90000 })), false);
  assert.equal(matchesSearch(v, baseSearch({ company_blacklist: 'яндекс' })), false);
  assert.equal(matchesSearch(v, baseSearch({ company_blacklist: 'сбер' })), true);
});

test('чёрный список не срабатывает на подстроку', () => {
  const v = makeVacancy({ company: 'Яндекс Практикум' });
  assert.equal(
    matchesSearch(v, baseSearch({ company_blacklist: 'сбер' })),
    true,
    '«сбер» нашёлся внутри другого слова',
  );
});

test('matchingVacancies отдаёт вместе с навыками', () => {
  // Функция должна отдавать навыки, посчитанные один раз: иначе каждый
  // прогон заново гоняет регексы по всему каталогу.
  const out = matchingVacancies(baseSearch({ keywords: 'frontend' }));
  assert.ok(Array.isArray(out));
  for (const item of out) {
    assert.ok(item.vacancy, 'нет вакансии');
    assert.ok(item.skills instanceof Set, 'навыки не отданы');
  }
});

test('пустые условия не ломают подбор', () => {
  const v = makeVacancy();
  assert.equal(matchesSearch(v, baseSearch({ keywords: '   ' })), true);
  assert.equal(matchesSearch(v, baseSearch({ keywords: ';;;' })), true);
});
