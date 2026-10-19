import test from 'node:test';
import assert from 'node:assert/strict';
import { mapHhVacancy } from '../src/lib/vacancies/hh';

test('mapHhVacancy мапит валидную сырую вакансию', () => {
  const raw = {
    id: '123456',
    name: 'Frontend-разработчик',
    alternate_url: 'https://hh.ru/vacancy/123456',
    employer: { name: 'ООО Тест' },
    area: { name: 'Москва' },
    salary: { from: 100000, to: 150000, currency: 'RUR' },
    published_at: '2026-01-01T00:00:00+03:00',
    schedule: { id: 'remote', name: 'Удалённая работа' },
    professional_roles: [{ name: 'Программирование' }],
    snippet: {
      requirement: 'React <highlighttext>и TypeScript</highlighttext>',
      responsibility: 'Писать код',
    },
  };
  const v = mapHhVacancy(raw)!;

  assert.equal(v.slug, 'hh-123456');
  assert.equal(v.title, 'Frontend-разработчик');
});

test('mapHhVacancy без зарплаты даёт null', () => {
  const raw = {
    id: '1',
    name: 'Без зп',
    alternate_url: 'https://hh.ru/vacancy/1',
    employer: { name: 'ООО' },
    area: { name: 'Москва' },
    salary: null,
  };
  const v = mapHhVacancy(raw);
  assert.equal(v!.salary_min, null);
  assert.equal(v!.salary_max, null);
});

test('mapHhVacancy санитизирует alternate_url', () => {
  const raw = {
    id: '1',
    name: 'X',
    alternate_url: 'javascript:alert(1)',
    employer: { name: 'ООО' },
    area: { name: 'Москва' },
    salary: null,
  };
  const v = mapHhVacancy(raw);
  assert.equal(v!.source_url, null);
});
