import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeExternalUrl } from '../src/lib/vacancies/util';

/**
 * external_url приходит от пользователя и рендерится как href в
 * applications-view.tsx. Без проверки протокола в БД попадает javascript:,
 * и клик по «ссылка на отклик» выполняет произвольный скрипт.
 */
test('принимает обычные http(s)-адреса', () => {
  assert.equal(sanitizeExternalUrl('https://hh.ru/vacancy/1'), 'https://hh.ru/vacancy/1');
  assert.equal(sanitizeExternalUrl('http://example.com/a?b=1'), 'http://example.com/a?b=1');
});

test('обрезает пробелы', () => {
  assert.equal(sanitizeExternalUrl('  https://example.com  '), 'https://example.com');
});

test('отбрасывает схемы, выполняющие код', () => {
  for (const hostile of [
    'javascript:alert(1)',
    'JavaScript:alert(document.cookie)',
    '  javascript:alert(1)  ',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(
      sanitizeExternalUrl(hostile),
      null,
      `${hostile} не должен попадать в БД как ссылка`,
    );
  }
});

test('отбрасывает мусор и пустые значения', () => {
  assert.equal(sanitizeExternalUrl('не ссылка'), null);
  assert.equal(sanitizeExternalUrl(''), null);
  assert.equal(sanitizeExternalUrl(null), null);
  assert.equal(sanitizeExternalUrl(undefined), null);
  assert.equal(sanitizeExternalUrl('   '), null);
});

test('не пропускает протокол через обфускацию', () => {
  // Схема может быть спрятана в управляющих символах или через пробелы,
  // которые new URL() нормализует — проверяем итоговую схему, а не исходную строку.
  assert.equal(sanitizeExternalUrl('java\tscript:alert(1)'), null);
  assert.equal(sanitizeExternalUrl('java\nscript:alert(1)'), null);
});

test('https-ссылка с кавычками не ломает атрибут', () => {
  // Кавычки допустимы в URL, но мы возвращаем строку как есть — React экранирует
  // атрибут. Здесь фиксируем, что валидная ссылка не отбрасывается.
  assert.ok(sanitizeExternalUrl('https://example.com/?q="x"'));
});
