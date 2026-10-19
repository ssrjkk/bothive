import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLetterTemplate } from '../src/lib/cover-letter';
import type { Vacancy } from '../src/lib/vacancies/types';

const vacancy: Vacancy = {
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
};

test('renderLetterTemplate подставляет поля вакансии в шаблон', () => {
  const template =
    'Здравствуйте! Меня интересует {вакансия} в {компания}, город {город}, {зарплата}.';
  const out = renderLetterTemplate(template, vacancy);
  assert.match(out, /Frontend-разработчик/);
  assert.match(out, /ООО Тест/);
  assert.match(out, /Москва/);
  assert.match(out, /150000–200000/);
});

test('renderLetterTemplate оставляет неизвестные переменные как есть', () => {
  const out = renderLetterTemplate('Роль: {вакансия}; прочее: {неизвестно}', vacancy);
  assert.match(out, /Frontend-разработчик/);
  assert.match(out, /\{неизвестно\}/);
});

test('renderLetterTemplate не ломается на пустом шаблоне', () => {
  assert.equal(renderLetterTemplate('', vacancy), '');
  assert.equal(renderLetterTemplate('   ', vacancy), '   ');
});
