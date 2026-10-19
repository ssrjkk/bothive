import test from 'node:test';
import assert from 'node:assert/strict';

import { explain, plural } from '../src/lib/autoapply-report';
import type { AutoApplyRun } from '../src/lib/autoapply';

/**
 * Разбор прогона автоотклика.
 *
 * Панель автооткликов умела только включать и выключать его — итог жил в логе
 * планировщика. Человек после дня работы с сервисом не мог ответить на вопрос
 * «почему откликов было столько, сколько было». Тут проверяется, что ответ
 * получается осмысленным, а не просто что возвращается массив.
 */

function run(over: Partial<AutoApplyRun> = {}): AutoApplyRun {
  return {
    ran: true,
    searches: 1,
    applied: 0,
    failed: 0,
    skipped: 0,
    stale: 0,
    pausedFor: null,

    pausedDetail: null,
    pausedUsers: 0,

    blockedUsers: 0,
    withLetter: 0,
    withoutLetter: 0,
    demoUsers: 0,
    erroredUsers: 0,
    ...over,
  };
}

test('успешный прогон объясняет, что отклики ушли', () => {
  const reasons = explain(run({ applied: 3, withLetter: 3 }));
  assert.equal(
    reasons.length,
    1,
    `ожидалась одна причина, получено: ${reasons.map((r) => r.title).join('; ')}`,
  );
  assert.match(reasons[0]!.title, /3/, `в заголовке нет числа откликов: ${reasons[0]!.title}`);
  assert.equal(reasons[0]!.tone, 'good');
  assert.match(reasons[0]!.detail, /письмо/i, 'не сказано, что письма приложены');
});

test('пустой результат объясняет, что делать, а не констатирует ноль', () => {
  /*
   * «Отправлено 0» — не ответ. Человек не знает, что делать: искать другие
   * ключевые слова, ждать каталог или чинить привязку аккаунта. Разбор должен
   * называть хотя бы одно действие.
   */
  const reasons = explain(run());
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0]!.tone, 'warn', 'пустой результат не помечен как требующий внимания');
  assert.match(
    reasons[0]!.detail,
    /поиск|ключев/i,
    `не сказано, что делать: ${reasons[0]!.detail}`,
  );
});

test('пауза после отказа платформы названа своим именем и объяснена', () => {
  const reasons = explain(run({ applied: 0, failed: 2, pausedFor: 'backoff' }));
  const backoff = reasons.find((r) => r.tone === 'warn');
  assert.ok(backoff, `backoff не показан среди причин: ${reasons.map((r) => r.title).join('; ')}`);
  assert.match(backoff!.detail, /блокиров/i, 'не объяснено, зачем нужна пауза');
  assert.match(
    backoff!.detail,
    /сама/i,
    'не сказано, что пауза снимется сама — человек решит, что сервис встал',
  );
});

test('устаревшие вакансии отделены от «уже отправлено»', () => {
  /*
   * Причины пропуска разные и требуют противоположных действий: на «уже
   * отправлено» делать нечего, на «вакансия старая» надо расширить поиск. В
   * одной цифре это не различить, и человек чинит несуществующую проблему.
   */
  const reasons = explain(run({ skipped: 12, stale: 12 }));
  const stale = reasons.find((r) => /старше/.test(r.title));
  assert.ok(stale, `устаревшие вакансии не выделены: ${reasons.map((r) => r.title).join('; ')}`);
  assert.match(stale!.detail, /расширьте/i, 'не сказано, что делать с устаревшими вакансиями');
  assert.match(stale!.detail, /дневн/i, 'не сказано, зачем это важно — про слот дневного лимита');
});

test('неудачные отклики не выдаются за пустой результат', () => {
  const reasons = explain(run({ failed: 4 }));
  assert.ok(
    reasons.some((r) => /не отправлено/.test(r.title)),
    `неудачи не показаны: ${reasons.map((r) => r.title).join('; ')}`,
  );
  assert.ok(
    !reasons.some((r) => /Подходящих вакансий не было/.test(r.title)),
    'при отказах платформы сказано, что вакансий не было — это ложь',
  );
});

test('число откликов в заголовке склоняется по-русски', () => {
  assert.equal(
    plural(1, 'отклик отправлен', 'отклика отправлено', 'откликов отправлено'),
    'отклик отправлен',
  );
  assert.equal(
    plural(2, 'отклик отправлен', 'отклика отправлено', 'откликов отправлено'),
    'отклика отправлено',
  );
  assert.equal(
    plural(5, 'отклик отправлен', 'отклика отправлено', 'откликов отправлено'),
    'откликов отправлено',
  );
  assert.equal(
    plural(11, 'отклик отправлен', 'отклика отправлено', 'откликов отправлено'),
    'откликов отправлено',
  );
  assert.equal(
    plural(21, 'отклик отправлен', 'отклика отправлено', 'откликов отправлено'),
    'отклик отправлен',
  );

  for (const n of [1, 2, 5, 11, 21, 22, 25, 101]) {
    const title = explain(run({ applied: n, withLetter: n }))[0]!.title;
    assert.ok(
      title.includes(String(n)),
      `в заголовке потерялось число: «${title}» при applied=${n}`,
    );
  }
});

/**
 * Формы слов склоняются вместе с числом.
 *
 * Найдено вживую на панели: при одном неудачном отклике выводилось
 * «1 откликов не отправлено». Тесты на `plural` этого не ловили — они проверяли
 * только строку об успехе, а форма «не отправлено» собиралась литералом рядом с
 * числом и не участвовала в склонении вовсе.
 */
test('форма слова совпадает с числом во всех заголовках', () => {
  const cases: { run: Partial<AutoApplyRun>; bad: RegExp }[] = [
    { run: { failed: 1 }, bad: /^1 откликов/ },
    { run: { failed: 2 }, bad: /^2 отклик\b/ },
    { run: { failed: 5 }, bad: /^5 отклик[а]?\s+не/ },
    { run: { stale: 1 }, bad: /^1 подходящих/ },
    { run: { stale: 3 }, bad: /^3 подходящих/ },
    { run: { stale: 2 }, bad: /^2 подходящ(их|ая)/ },
  ];

  for (const c of cases) {
    for (const reason of explain(run(c.run))) {
      assert.doesNotMatch(
        reason.title,
        c.bad,
        `заголовок «${reason.title}» не согласован с числом (проверялось для ${JSON.stringify(c.run)})`,
      );
    }
  }

  // И явно то, что должно получиться.
  const one = explain(run({ failed: 1 })).find((r) => /не отправлен/.test(r.title));
  assert.equal(one?.title, '1 отклик не отправлен');
  const two = explain(run({ failed: 2 })).find((r) => /не отправлено/.test(r.title));
  assert.equal(two?.title, '2 отклика не отправлено');
  const oneStale = explain(run({ stale: 1 })).find((r) => /старше/.test(r.title));
  assert.equal(oneStale?.title, '1 подходящая вакансия старше двух дней');
});

/**
 * Устаревшие вакансии — проблема, а не достижение.
 *
 * Проверялось тоном отдельно, потому что само наличие сообщения тут
 * недостаточно: строка может быть на месте, с правильным текстом и при этом
 * выглядеть как хорошая новость. Тон — часть сообщения, и «зелёная» полоса на
 * предупреждении читается как «всё в порядке».
 */
test('устаревшие вакансии не поданы как успех', () => {
  const reasons = explain(run({ skipped: 8, stale: 8 }));
  const stale = reasons.find((r) => /старше/.test(r.title));
  assert.ok(stale, 'устаревшие вакансии не выделены');
  assert.notEqual(
    stale!.tone,
    'good',
    `устаревшие вакансии помечены как успех (тон ${stale!.tone})`,
  );
});

test('часть откликов без письма названа честно', () => {
  const reasons = explain(run({ applied: 4, withLetter: 1 }));
  assert.match(
    reasons[0]!.detail,
    /1 из 4/,
    `не сказано, сколько ушло с письмом: ${reasons[0]!.detail}`,
  );
});

test('без прогона сказано именно то, чего не хватает', () => {
  const reasons = explain(run({ ran: false, reason: 'нет активных поисков' }));
  assert.equal(reasons.length, 1);
  assert.match(
    reasons[0]!.detail,
    /активных поисков/i,
    `причина потерялась: ${reasons[0]!.detail}`,
  );
});

/**
 * Причины не должны выглядеть одинаково при разных проблемах.
 *
 * Проверяется тоном: если «успешно» и «ничего не отправилось» выглядят
 * одинаково, весь разбор не читается, и панель становится украшением.
 */
test('успех и проблема не выглядят одинаково', () => {
  const good = explain(run({ applied: 2, withLetter: 2 }))[0]!.tone;
  const bad = explain(run({ failed: 2 })).find((r) => /не отправлено/.test(r.title))!.tone;
  const warn = explain(run())[0]!.tone;
  assert.notEqual(good, bad, 'успех и отказ показаны одинаковым тоном');
  assert.notEqual(good, warn, 'успех и пустой результат показаны одинаковым тоном');
});
