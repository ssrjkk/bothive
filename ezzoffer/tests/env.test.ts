import test from 'node:test';
import assert from 'node:assert/strict';

import { envStr, envOpt, envNum, envBaseUrl } from '../src/lib/env';

/**
 * Одинокий `process.env.X ?? default` не срабатывает на пустой строке, а в
 * .env.example почти все переменные объявлены пустыми. Каждая поломка ниже
 * была реальной: Number("") === 0 отключал планировщик и обновление каталога,
 * а пустой SITE_URL ронял сборку на new URL("").
 */
test('envStr: пустое значение равносильно отсутствию', () => {
  assert.equal(envStr({}, 'SITE_URL', 'def'), 'def');
  assert.equal(envStr({ SITE_URL: '' }, 'SITE_URL', 'def'), 'def');
  assert.equal(envStr({ SITE_URL: '   ' }, 'SITE_URL', 'def'), 'def');
  assert.equal(envStr({ SITE_URL: 'https://x.ru' }, 'SITE_URL', 'def'), 'https://x.ru');
});

test('envStr: обрезает пробелы по краям', () => {
  assert.equal(envStr({ SITE_URL: '  https://x.ru  ' }, 'SITE_URL', 'def'), 'https://x.ru');
});

test('envOpt: различает «задано» и «не задано»', () => {
  assert.equal(envOpt({}, 'HH_CLIENT_ID'), null);
  assert.equal(envOpt({ HH_CLIENT_ID: '' }, 'HH_CLIENT_ID'), null);
  assert.equal(envOpt({ HH_CLIENT_ID: '  ' }, 'HH_CLIENT_ID'), null);
  assert.equal(envOpt({ HH_CLIENT_ID: 'abc' }, 'HH_CLIENT_ID'), 'abc');
});

test("envNum: Number('') === 0 больше не ломает планировщик (regression)", () => {
  // Без envNum: Number(process.env.SCHEDULER_INTERVAL_MS ?? 300000)
  // при SCHEDULER_INTERVAL_MS="" даёт 0, и условие `>= 60_000` не проходит —
  // планировщик не запускался вообще.
  assert.equal(Number(''), 0, 'это и была причина поломки');
  assert.equal(envNum({ SCHEDULER_INTERVAL_MS: '' }, 'SCHEDULER_INTERVAL_MS', 300_000), 300_000);
  assert.equal(envNum({}, 'SCHEDULER_INTERVAL_MS', 300_000), 300_000);
});

test('envNum: применяет границы', () => {
  const env = { N: '500' };
  assert.equal(envNum(env, 'N', 1000, { min: 60_000 }), 1000, 'ниже минимума — fallback');
  assert.equal(envNum(env, 'N', 1000), 500, 'без границ значение принимается');
  assert.equal(envNum({ N: '999999' }, 'N', 1, { max: 60_000 }), 1, 'выше максимума — fallback');
});

test('envNum: отбрасывает мусор, ноль и отрицательные', () => {
  assert.equal(envNum({ N: 'abc' }, 'N', 7), 7);
  assert.equal(envNum({ N: '0' }, 'N', 7), 7);
  assert.equal(envNum({ N: '-5' }, 'N', 7), 7);
  assert.equal(envNum({ N: 'Infinity' }, 'N', 7), 7);
  assert.equal(envNum({ N: '1e3' }, 'N', 7), 1000, 'научная нотация валидна');
});

test('envNum: дробные значения допустимы', () => {
  assert.equal(envNum({ N: '12.5' }, 'N', 1), 12.5);
});

test('envBaseUrl: убирает хвостовой слэш и не падает на пустом', () => {
  assert.equal(envBaseUrl({}, 'SITE_URL', 'https://d.ru'), 'https://d.ru');
  assert.equal(envBaseUrl({ SITE_URL: '' }, 'SITE_URL', 'https://d.ru'), 'https://d.ru');
  assert.equal(
    envBaseUrl({ SITE_URL: 'https://d.ru/' }, 'SITE_URL', 'https://d.ru'),
    'https://d.ru',
  );
  assert.equal(
    envBaseUrl({ SITE_URL: 'http://localhost:3000' }, 'SITE_URL', 'd'),
    'http://localhost:3000',
  );
});

test('envBaseUrl всегда даёт валидный URL для new URL()', () => {
  // layout.tsx делает new URL(siteUrl) на верхнем уровне модуля: любое
  // невалидное значение роняет сборку целиком.
  for (const env of [{}, { SITE_URL: '' }, { SITE_URL: '  ' }, { SITE_URL: 'https://d.ru/' }]) {
    const base = envBaseUrl(env, 'SITE_URL', 'https://ezoffer.ru');
    assert.doesNotThrow(() => new URL(base), `${JSON.stringify(env)} дал невалидный ${base}`);
  }
});

test('пустой .env.example не ломает ни одну переменную', () => {
  // Именно этот файл копируют в .env: SITE_URL=, CATALOG_TTL_MS=, EZOFFER_DB_PATH=
  const copiedEnv = {
    SITE_URL: '',
    CATALOG_TTL_MS: '',
    SCHEDULER_INTERVAL_MS: '',
    EZOFFER_DB_PATH: '',
    HH_ACCESS_TOKEN: '',
    HH_CLIENT_ID: '',
  };
  assert.equal(envBaseUrl(copiedEnv, 'SITE_URL', 'https://d.ru'), 'https://d.ru');
  assert.equal(envNum(copiedEnv, 'CATALOG_TTL_MS', 6 * 3600_000, { min: 60_000 }), 6 * 3600_000);
  assert.equal(envNum(copiedEnv, 'SCHEDULER_INTERVAL_MS', 300_000, { min: 60_000 }), 300_000);
  assert.equal(envOpt(copiedEnv, 'HH_ACCESS_TOKEN'), null);
});
