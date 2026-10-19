import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rotateLogFile } from '../src/lib/log-file';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ezoffer-log-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('rotateLogFile не трогает файл, пока он меньше порога', () => {
  withTmpDir((dir) => {
    const file = join(dir, 'app.log');
    writeFileSync(file, 'small\n');
    rotateLogFile(file, 1024, 5);
    assert.deepEqual(readdirSync(dir), ['app.log']);
  });
});

function payloadIn(dir: string, needle: string): boolean {
  return readdirSync(dir).some((f) => readFileSync(join(dir, f), 'utf8').includes(needle));
}

test('rotateLogFile по размеру сохраняет содержимое в ротации', () => {
  withTmpDir((dir) => {
    const file = join(dir, 'app.log');
    writeFileSync(file, 'MARKER-' + 'x'.repeat(2048));
    rotateLogFile(file, 1024, 5);

    const rotations = readdirSync(dir).filter((f) => f.startsWith('app.log.'));
    assert.equal(rotations.length, 1, 'должен появиться ровно один ротированный файл');
    assert.ok(payloadIn(dir, 'MARKER-'), 'содержимое лога не должно теряться при ротации');
  });
});

test('rotateLogFile никогда не удаляет активный app.log (regression)', () => {
  withTmpDir((dir) => {
    const file = join(dir, 'app.log');
    // Много ротаций + активный файл. Старая реализация фильтровала файлы по
    // startsWith("app.log"), куда попадал и сам app.log, а после sort() он шёл
    // первым и попадал под unlink — активный лог с последними записями исчезал.
    for (let i = 0; i < 8; i++) {
      writeFileSync(join(dir, `app.log.${1000 + i}`), `old-${i}\n`);
    }
    writeFileSync(file, 'LIVE-' + 'x'.repeat(4096));

    rotateLogFile(file, 1024, 3);

    assert.ok(payloadIn(dir, 'LIVE-'), 'текущий лог не должен удаляться при ротации');
    const rotations = readdirSync(dir).filter((f) => f.startsWith('app.log.'));
    assert.ok(rotations.length <= 4, `ротаций должно остаться <= 4, получено ${rotations.length}`);
  });
});

test('rotateLogFile уважает keep и удаляет самые старые ротации', () => {
  withTmpDir((dir) => {
    const file = join(dir, 'app.log');
    writeFileSync(join(dir, 'app.log.100'), 'OLDEST\n');
    writeFileSync(join(dir, 'app.log.200'), 'b\n');
    writeFileSync(join(dir, 'app.log.300'), 'c\n');
    writeFileSync(file, 'NEW-' + 'x'.repeat(4096));

    rotateLogFile(file, 1024, 1);

    const rotations = readdirSync(dir).filter((f) => f.startsWith('app.log.'));
    assert.ok(rotations.length <= 2, `получено ${rotations.length}: ${rotations.join(', ')}`);
    assert.ok(!rotations.includes('app.log.100'), 'самая старая ротация должна быть удалена');
    assert.ok(payloadIn(dir, 'NEW-'), 'новый лог должен быть сохранён');
  });
});

test('rotateLogFile не падает на отсутствующем файле', () => {
  withTmpDir((dir) => {
    assert.doesNotThrow(() => rotateLogFile(join(dir, 'missing.log'), 1, 5));
  });
});

test('rotateLogFile игнорирует посторонние файлы в каталоге', () => {
  withTmpDir((dir) => {
    const file = join(dir, 'app.log');
    writeFileSync(join(dir, 'other.txt'), 'keep me\n');
    writeFileSync(file, 'x'.repeat(4096));

    rotateLogFile(file, 1024, 5);

    assert.ok(readdirSync(dir).includes('other.txt'), 'чужой файл не должен удаляться');
    assert.ok(statSync(join(dir, 'other.txt')).size > 0);
  });
});
