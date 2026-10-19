import test from 'node:test';
import assert from 'node:assert/strict';

import { createPacing, zeroPacing } from '../src/lib/anti-ban';

/**
 * Классификация отказов площадки.
 *
 * Раньше видов отказа было два — «platform» и «network» — и на практике это
 * не работало. Тело ответа hh различает четыре ситуации, а сюда попадали все,
 * кроме закрытой вакансии. В итоге 403 (аккаунт ограничен) считался тем же,
 * что и таймаут сети, и получал паузу в минуты вместо остановки на часы.
 *
 * Это худший вид отказа для пользователя: аккаунт под ограничением, отклики
 * не уходят, и человек не понимает почему. Проверяется поведение, а не
 * структура: длительность пауки и то, что аккаунт останавливается надолго.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Часы, привязанные к локальному времени и не заходящие за границу рабочего дня.
 *
 * Две ловушки, обе уже стоили прогона.
 *
 * Первая: стартовое время задавалось через `Date.UTC`, а `decide()` смотрит
 * на `getHours()` — то есть на локальное. В московском поясе старт приходился
 * на 15:00, и шаг «на четыре часа вперёд» уводил за 20:00 в ночное окно.
 *
 * Вторая: попытка починить это через `setHours(18)` дала три часа вместо
 * семи — стрелка ставилась на локальные 18:00, то есть на 15:00 UTC.
 *
 * Теперь старт — локальные 09:00, а `hours()` двигает время вперёд по часам.
 * Рабочее окно по умолчанию 9:00–20:00, поэтому любой шаг должен укладываться
 * в 09:00–19:00 — это видно глазами в каждом тесте.
 */
function makeClock(localStartHour = 9) {
  const d = new Date();
  d.setHours(localStartHour, 0, 0, 0);
  let t = d.getTime();
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    hours: (n: number) => {
      t += n * HOUR;
    },
    /** Только для проверок: утверждает, что время внутри рабочего окна. */
    assertWorkHour() {
      const h = new Date(t).getHours();
      if (h < 9 || h >= 20) {
        throw new Error(`тест ушёл в ${h}:00 — decide() вернёт «ночь» и измерит не то`);
      }
    },
  };
}

/** Паузер без пауз между откликами: проверяем только отказы и лимиты. */
function pacingFor(clock: ReturnType<typeof makeClock>) {
  return createPacing(
    { minDelayMs: 0, maxDelayMs: 0, jitterMinutes: 0, dailyLimit: 1000, hourlyLimit: 1000 },
    clock.now,
  );
}

// ------------------------------------------------------- аккаунт ограничен

test('403 останавливает аккаунт надолго, а не на минуты', () => {
  const clock = makeClock();
  const p = pacingFor(clock);

  p.recordFailure('blocked');
  const d = p.decide();

  assert.equal(d.allowed, false, 'после 403 отправлять нельзя');
  assert.equal(d.reason, 'backoff');
  /*
   * Главная проверка. Пятиминутная пауза при ограниченном аккаунке означала бы,
   * что сервис через пять минут снова стучится в hh — и делает это снова и
   * снова, ухудшая положение аккаунта.
   */
  assert.ok(
    d.retryAfterMs >= 6 * HOUR,
    `пауза ${Math.round(d.retryAfterMs / MINUTE)} мин — ограничение аккаунта требует часов, а не минут`,
  );
});

test('ограничение аккаунта переживает паузу в несколько минут', () => {
  const clock = makeClock();
  const p = pacingFor(clock);
  p.recordFailure('blocked');

  // Раньше пауза была 5 минут: спустя 10 минут сервис уже пробовал снова.
  clock.advance(10 * MINUTE);
  assert.equal(
    p.decide().allowed,
    false,
    'через 10 минут после 403 отправлять нельзя — ограничение ещё висит',
  );
});

test('после снятия ограничения отправка возобновляется', () => {
  const clock = makeClock();
  const p = pacingFor(clock);
  p.recordFailure('blocked');

  clock.hours(7); // 09:00 -> 16:00, внутри рабочего окна
  clock.assertWorkHour();
  const d = p.decide();
  assert.equal(d.allowed, true, 'спустя семь часов ограничение должно сняться само');
  assert.equal(p.blockedUntil(clock.now()), 0, 'блокировка должна обнулиться');
});

test('успешная отправка обнуляет серию отказов', () => {
  /*
   * Без обнуления счётчик копился весь срок жизни процесса: у кого-то был один
   * плохой вечер, и с тех пор каждая сетевая мелочь ждала бы дольше предыдущей —
   * вплоть до потолка в два часа на обычный таймаут.
   *
   * Первая версия теста проваливалась на границе: четыре отказа с шагом в два
   * часа давали серию ровно в 120 минут — потолок, — и к моменту проверки с
   * момента последнего отказа проходило ровно столько же. Пауза заканчивалась
   * «как раз», и обнуление ничего не меняло: тест проходил и со сломанным
   * обнулением. Теперь последний отказ и успешная отправка идут подряд, без
   * хода часов между ними, так что расхождение не может сойтись случайно.
   */
  const clock = makeClock();
  const p = pacingFor(clock);

  for (let i = 0; i < 3; i++) {
    p.recordFailure('rate_limit');
    clock.hours(2); // 09 -> 11 -> 13 -> 15, внутри окна
    clock.assertWorkHour();
  }

  /*
   * Последний отказ — без хода часов после него.
   *
   * Иначе расхождение снова сходится случайно: два часа — ровно 120 минут, то
   * есть ровно потолок серии из четырёх отказов, и пауза заканчивалась «как
   * раз». Из-за этого две первые версии теста проходили и со сломанным
   * обнулением счётчика.
   */
  p.recordFailure('rate_limit');
  p.recordSent();

  assert.equal(
    p.decide().allowed,
    true,
    'успешная отправка означает, что площадка больше не отказывает — паузы быть не должно',
  );

  // Теперь единственный сетевой сбой ждёт короткое время, а не час.
  p.recordFailure('network');
  const after = p.decide();
  assert.equal(after.allowed, false);
  assert.ok(
    after.retryAfterMs <= 10 * MINUTE,
    `сетевой сбой ждёт ${Math.round(after.retryAfterMs / MINUTE)} мин — слишком долго для таймаута`,
  );
});

test('сетевой сбой не растёт как отказ площадки', () => {
  const clock = makeClock();
  const p = pacingFor(clock);

  const waits: number[] = [];
  for (let i = 0; i < 4; i++) {
    p.recordFailure('network');
    const d = p.decide();
    assert.equal(d.allowed, false);
    waits.push(d.retryAfterMs);
    clock.hours(2); // 09 -> 11 -> 13 -> 15, внутри окна
    clock.assertWorkHour();
  }

  // Таймаут ничего не говорит о риске для аккаунта, поэтому пауза короткая
  // и почти не растёт. Порог — 15 минут: старый алгоритм доходил до двух часов.
  assert.ok(
    waits.every((w) => w <= 15 * MINUTE),
    `сетевые паузы выросли: ${waits.map((w) => Math.round(w / MINUTE)).join(', ')} мин`,
  );
});

test('разные виды отказа не складываются в одну серию', () => {
  /*
   * Два сетевых таймаута, а затем отказ площадки — это не «три отказа», и пауза
   * не должна расти от факта количества. Значение имеет вид, а не счёт.
   */
  const clock = makeClock();
  const p = pacingFor(clock);

  p.recordFailure('network');
  clock.advance(20 * MINUTE);
  p.recordFailure('network');
  clock.advance(20 * MINUTE);
  p.recordFailure('rate_limit');

  const d = p.decide();
  assert.equal(d.allowed, false);
  assert.ok(
    d.retryAfterMs <= 20 * MINUTE,
    `после одного отказа площадки пауза ${Math.round(d.retryAfterMs / MINUTE)} мин — серия не должна копиться`,
  );
});

// ------------------------------------------------------------- Retry-After

test('Retry-After площадки выполняется дословно', () => {
  const clock = makeClock();
  const p = pacingFor(clock);

  p.respectRetryAfter(90 * 1000);
  const d = p.decide();

  assert.equal(d.allowed, false, 'площадка сказала «не раньше» — отправка запрещена');
  assert.ok(
    Math.abs(d.retryAfterMs - 90 * 1000) < 1000,
    `пауза ${Math.round(d.retryAfterMs / 1000)} с вместо 90 — Retry-After не выполнен`,
  );
  assert.match(d.detail ?? '', /Retry-After/, 'причина паузы не объяснена человеку');
});

test('Retry-After имеет потолок, иначе один 429 встал бы колом', () => {
  const clock = makeClock();
  const p = pacingFor(clock);

  // Площадка (или посредник) может попросить прийти через сутки.
  p.respectRetryAfter(24 * HOUR);

  const d = p.decide();
  assert.equal(d.allowed, false, 'площадка попросила прийти через сутки — ждать придётся');
  if (d.allowed) return;
  assert.ok(
    d.retryAfterMs <= 2 * HOUR,
    `пауза ${Math.round(d.retryAfterMs / HOUR)} ч — потолок должен ограничивать`,
  );
});

test('бессмысленный Retry-After игнорируется', () => {
  const clock = makeClock();
  const p = pacingFor(clock);

  // Ноль, отрицательное и NaN не должны ничего останавливать.
  for (const bad of [0, -5000, Number.NaN]) {
    p.respectRetryAfter(bad);
    assert.equal(p.decide().allowed, true, `Retry-After = ${bad} не должен блокировать отправку`);
  }
});

test('успешная отправка снимает инструкцию Retry-After', () => {
  const clock = makeClock();
  const p = pacingFor(clock);

  p.respectRetryAfter(30 * 60_000);
  assert.equal(p.decide().allowed, false);

  p.recordSent();
  assert.equal(
    p.decide().allowed,
    true,
    'отклик прошёл — значит площадка больше не просит ждать, иначе лимит тратится впустую',
  );
});

// --------------------------------------------------------------- приоритеты

test('ограничение аккаунта сильнее лимитов', () => {
  /*
   * Порядок проверок: если аккаунт ограничен, причина должна называться этой,
   * а не «ночь» или «суточный лимит» — иначе человек чинит несуществующую
   * проблему, вместо того чтобы разобраться с ограничением.
   */
  const clock = makeClock(23); // 23:00 — ночь по умолчанию
  const p = pacingFor(clock);

  p.recordFailure('blocked');
  const d = p.decide();

  assert.equal(d.allowed, false);
  assert.match(d.detail ?? '', /ограничил/, 'причина ограничения не названа — её видно как «ночь»');
});

test('zeroPacing не блокируется ничем — им пользуются тесты', () => {
  const z = zeroPacing();
  z.recordFailure('blocked');
  z.respectRetryAfter(10 * HOUR);
  assert.deepEqual(z.decide(), { allowed: true, delayMs: 0 });
  assert.equal(z.blockedUntil(), 0);
});
