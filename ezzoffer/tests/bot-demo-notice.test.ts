import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Пометка демо-режима в боте (Фаза 1, задача 3, часть «та же пометка в боте»).
 *
 * Баннер появился в кабинете, а бот остался молчаливым. Это ровно тот разрыв,
 * который принцип P1 не прощает: человек читает в мессенджере «3 отклика,
 * 1 приглашение» и не знает, что это демо-симуляция, а не площадка.
 *
 * Проверяется поведение, а не наличие константы: функция обязана менять текст
 * в demo и обязана НЕ менять его в live. Пометка, которая появляется всегда,
 * хуже отсутствующей — она обесценивает настоящие данные.
 */

let withModeNotice: typeof import('../src/lib/telegram-bot').withModeNotice;

before(async () => {
  ({ withModeNotice } = await import('../src/lib/telegram-bot'));
});

const TEXT = '3 отклика, 1 приглашение';

test('в demo к ответу добавляется пометка, что данные демонстрационные', () => {
  const out = withModeNotice(TEXT, 'demo');
  assert.notEqual(out, TEXT, 'в demo текст остался без пометки');
  assert.match(out, /демо/i, `нет слова «демо»: ${out}`);
  assert.match(out, /не отражают|демонстрационн/i, `не сказано, что данные не настоящие: ${out}`);
  assert.ok(out.includes(TEXT), 'исходный текст потерян');
});

test('в live текст не меняется', () => {
  const out = withModeNotice(TEXT, 'live');
  assert.equal(
    out,
    TEXT,
    'в live добавлена демо-пометка — настоящие данные выглядят сомнительными',
  );
});

test('пометка ставится в начало, а не прячется в конце', () => {
  const out = withModeNotice(TEXT, 'demo');
  const noticeAt = out.search(/демо/i);
  const textAt = out.indexOf('отклика');
  assert.ok(noticeAt >= 0, 'пометки нет');
  assert.ok(
    noticeAt < textAt,
    `пометка в конце: человек читает цифры раньше, чем узнаёт, что они демо (${out})`,
  );
});

test('HTML-режим бота не ломается на метке', () => {
  // Бот шлёт reply.text с html: true. Незакрытый <b> в префиксе уехал бы
  // вместе со всем сообщением.
  const out = withModeNotice(TEXT, 'demo');
  const open = (out.match(/<b>/g) ?? []).length;
  const close = (out.match(/<\/b>/g) ?? []).length;
  assert.equal(open, close, `несбалансированный HTML в префиксе: ${out}`);
});

test('пустой текст не превращается в пустую строку с пометкой', () => {
  const out = withModeNotice('', 'demo');
  assert.equal(out.trim(), '', `на пустой ответ добавлена пометка: ${out}`);
});

test('старая база без колонки mode не ломает бота', () => {
  // users.mode появился миграцией; значение может прийти undefined из старой
  // строки. undefined — это не live, но и не повод молчать: человек должен
  // увидеть пометку, потому что мы не знаем, что он в live.
  const out = withModeNotice(TEXT, undefined as unknown as 'demo' | 'live');
  assert.match(out, /демо/i, `при неизвестном режиме пометки нет: ${out}`);
});
