import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve, sep } from 'node:path';

import { resolveLogDir } from '../src/lib/log-file';

test('без переменной логи идут в ./data/logs', () => {
  assert.equal(resolveLogDir({}, '/app'), join('/app', 'data', 'logs'));
});

test('EZOFFER_LOG_DIR задаёт имя подкаталога внутри ./data', () => {
  assert.equal(
    resolveLogDir({ EZOFFER_LOG_DIR: 'custom' }, '/app'),
    join('/app', 'data', 'custom'),
  );
});

test('пустая строка и пробелы откатываются на дефолт', () => {
  assert.equal(resolveLogDir({ EZOFFER_LOG_DIR: '' }, '/app'), join('/app', 'data', 'logs'));
  assert.equal(resolveLogDir({ EZOFFER_LOG_DIR: '   ' }, '/app'), join('/app', 'data', 'logs'));
});

test('каталог не может выйти за пределы ./data', () => {
  for (const raw of ['../elsewhere', '../../etc', '/var/log/ez', '..\\..\\win', './../x']) {
    const dir = resolveLogDir({ EZOFFER_LOG_DIR: raw }, '/app');
    const dataRoot = resolve('/app', 'data');
    assert.ok(
      resolve(dir).startsWith(dataRoot),
      `${raw} не должен выводить каталог за пределы ./data, получено ${dir}`,
    );
  }
});

test('многосегментное значение берёт первый безопасный сегмент', () => {
  assert.equal(
    resolveLogDir({ EZOFFER_LOG_DIR: 'logs/prod' }, '/app'),
    join('/app', 'data', 'logs'),
    'вложенность не поддерживается, берётся первый сегмент',
  );
});

test('по умолчанию каталог находится внутри cwd', () => {
  const cwd = process.platform === 'win32' ? 'C:\\app' : '/app';
  const dir = resolveLogDir({}, cwd);
  assert.equal(dir, join(cwd, 'data', 'logs'));
  assert.ok(resolve(dir).startsWith(resolve(cwd) + sep), `получено ${dir}`);
});
