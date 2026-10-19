import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTrudVacancy } from '../src/lib/vacancies/trudvsem';

test('mapTrudVacancy мапит валидную сырую вакансию', () => {
  const raw = {
    id: '9300e0e0-1234-5678-9abc-def012345678',
    'job-name': 'Java-разработчик',
    company: { name: 'ООО Ромашка' },
    region: { name: 'г Москва' },
    salary_min: '150 000',
    salary_max: '200 000',
    vac_url: 'https://trudvsem.ru/vacancy/9300e0e0',
    employment: 'full time',
    duty: 'Разработка <b>Java</b>',
  };
  const v = mapTrudVacancy(raw)!;

  assert.equal(v.slug, 'trudvsem-9300e0e0-1234-5678-9abc-def012345678');
  assert.equal(v.title, 'Java-разработчик');
  assert.equal(v.salary_min, 150000);
  assert.equal(v.salary_max, 200000);
  assert.equal(v.source_url, 'https://trudvsem.ru/vacancy/9300e0e0');
  assert.match(v.about, /Java/);
});

test('mapTrudVacancy без зарплаты даёт null', () => {
  const raw = {
    id: '9300e0e0-1234-5678-9abc-def012345678',
    'job-name': 'Java-разработчик',
    company: { name: 'ООО Ромашка' },
    region: { name: 'г Москва' },
    vac_url: 'https://trudvsem.ru/vacancy/9300e0e0',
  };
  const v = mapTrudVacancy(raw);
  assert.equal(v!.salary_min, null);
  assert.equal(v!.salary_max, null);
});

test('mapTrudVacancy санитизирует source_url', () => {
  const raw = {
    id: '9300e0e0',
    'job-name': 'X',
    company: { name: 'Y' },
    region: { name: 'г Москва' },
    vac_url: 'javascript:alert(1)',
  };
  const v = mapTrudVacancy(raw);
  assert.equal(v!.source_url, null);
});
