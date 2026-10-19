import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseParamId,
  isUniqueViolation,
  toPositiveNumber,
  validateSalaryRange,
} from '../src/lib/validate';

test('parseParamId принимает целые положительные id', () => {
  assert.equal(parseParamId('12'), 12);
  assert.equal(parseParamId('7'), 7);
});

test('parseParamId отклоняет мусор', () => {
  assert.equal(parseParamId(undefined), null);
  assert.equal(parseParamId(''), null);
  assert.equal(parseParamId('abc'), null);
  assert.equal(parseParamId('1.5'), null);
  assert.equal(parseParamId('-3'), null);
  assert.equal(parseParamId('0'), null);
});

test('isUniqueViolation опознаёт SQLITE_CONSTRAINT_UNIQUE', () => {
  assert.equal(isUniqueViolation(new Error('boo')), false);
  assert.equal(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_UNIQUE' }), true);
  assert.equal(isUniqueViolation(null), false);
});

test('toPositiveNumber парсит числа', () => {
  assert.equal(toPositiveNumber(5), 5);
  assert.equal(toPositiveNumber('5'), 5);
  assert.equal(toPositiveNumber(0), null);
  assert.equal(toPositiveNumber(-1), null);
  assert.equal(toPositiveNumber('abc'), null);
  assert.equal(toPositiveNumber(null), null);
  assert.equal(toPositiveNumber(undefined), null);
});

test('validateSalaryRange проверяет диапазон', () => {
  assert.equal(validateSalaryRange(null, null), null);
  assert.equal(validateSalaryRange(100, 200), null);
  assert.equal(
    validateSalaryRange(200, 100),
    'Минимальная зарплата не может быть больше максимальной',
  );
});
