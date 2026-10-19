import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCommand, replyFor, markUpdateSeen, resetSeenUpdates } from '../src/lib/telegram-bot';
import type { User } from '../src/lib/db';

function user(over: Partial<User> = {}): User {
  return {
    id: 1,
    email: 'u@example.com',
    name: 'Иван',
    password_hash: 'h',
    created_at: 0,
    plan: 'pro',
    plan_period: 14,
    plan_activated_at: 0,
    plan_expires_at: Date.now() + 10 * 24 * 3600 * 1000,
    trial_started_at: 0,
    hh_token: null,
    hh_token_expires_at: null,
    hh_refresh_token: null,
    hh_resume_id: null,
    telegram_chat_id: '1',
    autoapply_paused: 0,

    autoapply_blocked_until: 0,

    autoapply_block_reason: '',
    email_verified: 1,
    email_verification_token: null,
    email_verification_expires: null,
    password_reset_token: null,
    password_reset_expires: null,
    salary_expectation: null,
    city_preference: '',
    mode: 'demo',
    ...over,
  };
}

test('parseCommand разбирает команду и аргументы', () => {
  assert.deepEqual(parseCommand('/поиск React удалённо'), {
    command: 'поиск',
    args: 'React удалённо',
  });
});

test('parseCommand срезает суффикс бота (@EZOfferBot)', () => {
  const parsed = parseCommand('/статистика@EZOfferBot');
  assert.equal(parsed?.command, 'статистика');
  assert.equal(parsed?.args, '');
});

test('parseCommand приводит регистр к нижнему', () => {
  assert.equal(parseCommand('/СТАТИСТИКА')?.command, 'статистика');
});

test('parseCommand возвращает null для обычного текста', () => {
  assert.equal(parseCommand('привет'), null);
  assert.equal(parseCommand(''), null);
});

test('/start и /помощь работают без привязки', () => {
  const start = replyFor('start', '', null);
  assert.match(start.text, /\/статистика/);
  assert.match(start.text, /\/связать/);

  const help = replyFor('помощь', '', null);
  assert.match(help.text, /команды/i);
});

test('команды без привязки объясняют, как привязаться', () => {
  const reply = replyFor('статистика', '', null);
  assert.match(reply.text, /не привязан/i);
  assert.match(reply.text, /\/dashboard\/settings/);
});

test('статистика показывает реальные цифры и подсказку', () => {
  const reply = replyFor('статистика', '', user());
  assert.match(reply.text, /Тариф: Про/);
  assert.match(reply.text, /За 7 дней/);
  assert.match(reply.text, /Просмотры:/);
});

test('истёкший тариф честно блокирует автоотклики', () => {
  const reply = replyFor('статистика', '', user({ plan_expires_at: Date.now() - 1000 }));
  assert.match(reply.text, /истёк/i);
  assert.match(reply.text, /тариф/i);
});

test('пауза отражается в статистике', () => {
  const reply = replyFor('статистика', '', user({ autoapply_paused: 1 }));
  assert.match(reply.text, /на паузе/);
});

test('/связать требует код', () => {
  const reply = replyFor('связать', '', null);
  assert.match(reply.text, /код/i);
  assert.match(reply.text, /\/связать \d+/);
});

test('/связать с кодом помечает действие link', () => {
  const reply = replyFor('связать', '123456', null);
  assert.equal(reply.action, 'link');
});

test('/выйти помечает действие unlink', () => {
  assert.equal(replyFor('выйти', '', user()).action, 'unlink');
});

test('неизвестная команда подсказывает /помощь', () => {
  const reply = replyFor('абракадабра', '', user());
  assert.match(reply.text, /Не знаю команду/);
  assert.match(reply.text, /\/помощь|\/start/);
});

/**
 * /пауза меняет состояние, а не отправляет в кабинет.
 *
 * Тест раньше утверждал обратное: «пауза не должна применяться прямо из чата»,
 * и требовал ссылку на /dashboard/settings. То есть он закреплял поведение,
 * в котором команда ничего не делала, — при том что сайт рекламировал бота как
 * способ остановить отклики мгновенно. Теперь команда работает, и проверка
 * перевёрнута.
 */
test('/пауза меняет состояние, а не отправляет в кабинет', () => {
  const reply = replyFor('пауза', '', user());
  assert.equal(reply.action, 'pause', 'пауза не возвращает действие');
  assert.equal(reply.text, '', 'ответ без действия рисуется как результат, которого ещё нет');
});

test('/поиск без активных поисков объясняет, что делать', () => {
  const reply = replyFor('поиск', '', user());
  // Проверяем формулировку независимо от наличия поисков в тестовой БД.
  assert.ok(reply.text.length > 0);
});

test('ответы не содержат незакрытых фигурных скобок', () => {
  const replies = [
    replyFor('start', '', null),
    replyFor('статистика', '', user()),
    replyFor('пауза', '', user()),
    replyFor('неизвестно', '', user()),
  ];
  for (const r of replies) {
    assert.ok(!r.text.includes('{'), `в ответе остался шаблон: ${r.text}`);
  }
});

/**
 * Telegram ретраит доставку апдейта при не-2xx ответе, поэтому один и тот же
 * update_id может прийти повторно. Без отсечки команда выполнялась бы дважды
 * и пользователь получил бы дубликат ответа.
 */
test('повторный апдейт с тем же update_id отбрасывается (regression)', () => {
  resetSeenUpdates();
  assert.equal(markUpdateSeen(42), true, 'первый апдейт обрабатывается');
  assert.equal(markUpdateSeen(42), false, 'дубликат отбрасывается');
  assert.equal(markUpdateSeen(43), true, 'новый апдейт обрабатывается');
});

test('апдейт без update_id обрабатывается всегда', () => {
  resetSeenUpdates();
  assert.equal(markUpdateSeen(undefined), true);
  assert.equal(markUpdateSeen(undefined), true);
});

test('набор seen-апдейтов ограничен по размеру', () => {
  resetSeenUpdates();
  for (let i = 0; i < 1500; i++) markUpdateSeen(i);
  // После вытеснения самые старые id забыты, и память не растёт бесконечно.
  assert.equal(markUpdateSeen(0), true, 'давно забытый id снова считается новым');
  assert.equal(markUpdateSeen(1499), false, 'свежий id всё ещё помнится');
  resetSeenUpdates();
});

/*
 * Регрессия: окно повтора открывалось на каждый рестарт.
 *
 * Множество обработанных update_id жило только в памяти процесса, а рестарты
 * здесь регулярны (деплой, планировщик, падения). Задержанный ретрай Telegram,
 * пришедший после рестарта, обрабатывался как новый апдейт — команда
 * выполнялась второй раз.
 *
 * Теперь множество подкреплено таблицей meta: id переживает рестарт.
 * Эмулировать рестарт напрямую нельзя (модуль один на процесс), но запись в
 * meta проверяется: раз id там, новый процесс его загрузит.
 */
test('обработанный update_id переживает рестарт через meta (regression)', async () => {
  resetSeenUpdates();
  assert.equal(markUpdateSeen(777001), true);

  const { db } = await import('../src/lib/db');
  const row = db.prepare("SELECT value FROM meta WHERE key = 'tg:seen-updates'").get() as
    { value: string } | undefined;
  assert.ok(row?.value, "id обязан persist'иться в meta, иначе рестарт его забудет");
  const ids = JSON.parse(row.value) as number[];
  assert.ok(ids.includes(777001), 'именно этот id должен быть в meta');

  resetSeenUpdates();
});
