import test from 'node:test';
import assert from 'node:assert/strict';

import {
  workStartHour,
  workEndHour,
  minApplyIntervalSec,
  maxApplyIntervalSec,
  globalDailyCap,
  globalHourlyCap,
} from '../src/lib/config';

/**
 * Чтение настроек из окружения.
 *
 * В `num()` стояла проверка `n > 0`, поэтому ноль молча заменялся значением по
 * умолчанию. Это не косметика: `AUTOAPPLY_WORK_START=0` давало 9, а
 * `AUTOAPPLY_MIN_INTERVAL_SEC=0` — 45 секунд. Администратор задавал переменную,
 * сервис её читал и вёл себя иначе, не сообщив ни об ошибке, ни о подмене.
 *
 * Нашлось это через тест, который неожиданно падал вечером: подбор в блоке
 * бота не мог отправить отклик, потому что рабочее окно нельзя было раскрыть
 * на круглосуточное.
 */

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(values)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('ноль в настройках уважается, а не заменяется умолчанием', () => {
  withEnv({ AUTOAPPLY_WORK_START: '0', AUTOAPPLY_MIN_INTERVAL_SEC: '0' }, () => {
    assert.equal(workStartHour(), 0, 'полночь как начало рабочего дня не задаётся');
    assert.equal(minApplyIntervalSec(), 0, 'нулевая пауза между откликами не задаётся');
  });
});

test('пустая переменная означает «не задано»', () => {
  withEnv({ AUTOAPPLY_WORK_START: '', AUTOAPPLY_MIN_INTERVAL_SEC: '  ' }, () => {
    assert.equal(workStartHour(), 9, 'пустая строка должна давать умолчание');
    assert.equal(minApplyIntervalSec(), 45, 'пробелы должны давать умолчание');
  });
});

test('отсутствующая переменная означает «не задано»', () => {
  withEnv({ AUTOAPPLY_WORK_START: undefined, AUTOAPPLY_WORK_END: undefined }, () => {
    assert.equal(workStartHour(), 9);
    assert.equal(workEndHour(), 20);
  });
});

test('обычные значения читаются как заданы', () => {
  withEnv(
    {
      AUTOAPPLY_WORK_START: '8',
      AUTOAPPLY_WORK_END: '23',
      AUTOAPPLY_MIN_INTERVAL_SEC: '60',
      AUTOAPPLY_MAX_INTERVAL_SEC: '300',
      AUTOAPPLY_HOURLY_CAP: '7',
    },
    () => {
      assert.equal(workStartHour(), 8);
      assert.equal(workEndHour(), 23);
      assert.equal(minApplyIntervalSec(), 60);
      assert.equal(maxApplyIntervalSec(), 300);
      assert.equal(globalHourlyCap(), 7);
    },
  );
});

test('мусор в переменной не ломает конфигурацию', () => {
  withEnv({ AUTOAPPLY_WORK_START: 'abc', AUTOAPPLY_HOURLY_CAP: '-5' }, () => {
    assert.equal(workStartHour(), 9, 'нечисло должно давать умолчание');
    assert.equal(globalHourlyCap(), 12, 'отрицательное должно давать умолчание');
  });
});

test('глобальный потолок по умолчанию выключен', () => {
  withEnv({ AUTOAPPLY_DAILY_CAP: undefined }, () => {
    assert.equal(
      globalDailyCap(),
      0,
      '0 = без потолка; значение больше нуля значит, что потолок включён',
    );
  });
  withEnv({ AUTOAPPLY_DAILY_CAP: '40' }, () => {
    assert.equal(globalDailyCap(), 40);
  });
});

test('часы работы остаются в допустимых границах', () => {
  withEnv({ AUTOAPPLY_WORK_START: '99', AUTOAPPLY_WORK_END: '99' }, () => {
    assert.ok(workStartHour() <= 23, 'начало должно укладываться в сутки');
    assert.ok(workEndHour() <= 24, 'конец должен быть не больше суток');
  });
  withEnv({ AUTOAPPLY_WORK_START: '-5', AUTOAPPLY_WORK_END: '0' }, () => {
    assert.ok(workStartHour() >= 0, 'отрицательный час должен срезаться в ноль');
  });
});
