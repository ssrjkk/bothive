import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeExternalUrl, toSalaryNumber } from '../src/lib/vacancies/util';

test('sanitizeExternalUrl пропускает только http/https', () => {
  assert.equal(
    sanitizeExternalUrl('https://example.com/vacancy/1'),
    'https://example.com/vacancy/1',
  );
  assert.equal(sanitizeExternalUrl('http://example.com/1'), 'http://example.com/1');
  assert.equal(sanitizeExternalUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeExternalUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeExternalUrl('ftp://example.com'), null);
  assert.equal(sanitizeExternalUrl('not a url'), null);
  assert.equal(sanitizeExternalUrl(null), null);
  assert.equal(sanitizeExternalUrl(undefined), null);
  assert.equal(sanitizeExternalUrl(''), null);
});

test('toSalaryNumber парсит числа и строки с пробелами', () => {
  assert.equal(toSalaryNumber(120000), 120000);
  assert.equal(toSalaryNumber('120000'), 120000);
  assert.equal(toSalaryNumber('120 000'), 120000);
  assert.equal(toSalaryNumber('45 000'), 45000);
  assert.equal(toSalaryNumber(0), null);
  assert.equal(toSalaryNumber(-5), null);
  assert.equal(toSalaryNumber('abc'), null);
  assert.equal(toSalaryNumber(null), null);
  assert.equal(toSalaryNumber(undefined), null);
});
