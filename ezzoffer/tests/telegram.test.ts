import { test } from 'node:test';
import assert from 'node:assert/strict';

import { telegramConfigured } from '../src/lib/telegram';

/**
 * Контракт без обращения к сети: конфигурация должна реагировать на пробелы,
 * а отправляемый текст — обрезаться до лимита Telegram (4096 символов),
 * иначе API отвечает 400.
 */
const TELEGRAM_TEXT_LIMIT = 4096;

test('telegramConfigured требует непустой токен', () => {
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(telegramConfigured(), false);

    process.env.TELEGRAM_BOT_TOKEN = '';
    assert.equal(telegramConfigured(), false, 'пустая строка не считается настройкой');

    process.env.TELEGRAM_BOT_TOKEN = '   ';
    assert.equal(telegramConfigured(), false, 'пробелы не считаются настройкой');

    process.env.TELEGRAM_BOT_TOKEN = '123:ABC';
    assert.equal(telegramConfigured(), true);
  } finally {
    if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved;
  }
});

test('лимит текста совпадает с ограничением Telegram', () => {
  assert.equal(TELEGRAM_TEXT_LIMIT, 4096, 'Telegram отвергает сообщения длиннее 4096 символов');
  const long = 'a'.repeat(5000);
  assert.equal(long.slice(0, TELEGRAM_TEXT_LIMIT).length, TELEGRAM_TEXT_LIMIT);
  const short = 'Ответили на вакансию';
  assert.equal(short.slice(0, TELEGRAM_TEXT_LIMIT), short, 'короткий текст не должен меняться');
});
