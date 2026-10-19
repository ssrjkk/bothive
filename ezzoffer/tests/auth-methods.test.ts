import test from 'node:test';
import assert from 'node:assert/strict';

import {
  authMethod,
  authMethods,
  authMethodReady,
  normalizeIdentity,
} from '../src/lib/auth-methods';

/**
 * Способы входа описаны данными, а вход из внешнего сервиса нормализуется.
 *
 * Главное здесь — недоверенный ввод. Имя, почта и аватар приходят от чужого
 * сервиса, а `email` у нас UNIQUE: без проверки формы один человек с пустым
 * адресом занял бы чужой логин, а имя с управляющими символами уехало бы в
 * письма и в разметку.
 */

test('способы входа перечислены и у каждого есть название', () => {
  const ids = authMethods().map((m) => m.id);
  for (const expected of ['password', 'link', 'github', 'google', 'yandex', 'telegram']) {
    assert.ok(ids.includes(expected as never), `способ ${expected} не зарегистрирован`);
    assert.ok(authMethod(expected)?.title, `у способа ${expected} нет названия`);
  }
});

test('внутренние способы готовы без ключей, внешние — нет', () => {
  const saved = { ...process.env };
  try {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    assert.equal(authMethodReady('password'), true, 'пароль должен работать без ключей');
    /*
     * «Вход по ссылке» в списке значится, но не завершается (completes: false):
     * маршрута входа по письму нет, и раньше кнопка «Войти через По ссылке из
     * письма» вела в 502 «Не удалось построить ссылку входа». Готовым такой
     * способ считаться не должен.
     */
    assert.equal(authMethodReady('link'), false, 'вход по ссылке не завершается — кнопка врала бы');
    assert.equal(authMethodReady('github'), false, 'GitHub без ключей заявил готовность');
  } finally {
    process.env = saved;
  }
});

test('внешний способ готов, когда оба ключа на месте', () => {
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  try {
    // Проверяем на завершаемом способе: github/google/yandex ключами не
    // включаются — они не умеют завершать вход (см. completes).
    process.env.TELEGRAM_BOT_TOKEN = 'tok';
    assert.equal(authMethodReady('telegram'), true);
  } finally {
    if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved;
  }
});

/*
 * Регрессия: ключи включали кнопку, за которой не было входа.
 *
 * authMethodReady смотрел только на наличие ключей. GitHub с заданными
 * GITHUB_CLIENT_ID/SECRET показывал кнопку «Войти через GitHub», человек
 * авторизовывался у провайдера, возвращался — и получал 401, потому что
 * завершить вход (обмен кода) код не умеет. Кнопка обещала то, чего нет.
 */
test('ключи не включают способ, который не умеет завершать вход (regression)', () => {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'YANDEX_CLIENT_ID',
    'YANDEX_CLIENT_SECRET',
  ];
  try {
    for (const k of keys) {
      saved[k] = process.env[k];
      process.env[k] = 'x';
    }
    for (const p of ['github', 'google', 'yandex']) {
      assert.equal(authMethodReady(p), false, `${p} с ключами снова показал бы кнопку без входа`);
    }
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('почта без формы не заводит аккаунт', () => {
  for (const bad of [
    '',
    '  ',
    'нет@',
    '@нет.ру',
    'два@знака@ру',
    'нет ру',
    'a'.repeat(250) + '@ru',
  ]) {
    const out = normalizeIdentity({
      provider: 'github',
      providerId: '1',
      email: bad,
      name: 'Иван',
    });
    assert.equal(out, null, `мусорная почта «${bad}» прошла: ${JSON.stringify(out)}`);
  }
});

test('почта приводится к нижнему регистру и обрезается', () => {
  const out = normalizeIdentity({
    provider: 'google',
    providerId: '42',
    email: '  User@Example.COM  ',
    name: 'Иван',
  });
  assert.ok(out);
  assert.equal(out.email, 'user@example.com');
});

test('имя без управляющих символов и лишних пробелов', () => {
  const out = normalizeIdentity({
    provider: 'yandex',
    providerId: '7',
    email: 'a@b.ru',
    name: '  Иван\u0000\u0007   Петров  ',
  });
  assert.ok(out);
  assert.equal(out.name, 'Иван Петров', `имя не очищено: ${JSON.stringify(out.name)}`);
});

test('имя из чужого сервиса ограничено по длине', () => {
  const out = normalizeIdentity({
    provider: 'github',
    providerId: '1',
    email: 'a@b.ru',
    name: 'я'.repeat(400),
  });
  assert.ok(out);
  assert.equal(out.name.length, 100);
});

test('аватар принимается только с https и известного хоста', () => {
  const good = normalizeIdentity({
    provider: 'github',
    providerId: '1',
    email: 'a@b.ru',
    name: 'Иван',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  });
  assert.ok(good?.avatarUrl?.startsWith('https://avatars.githubusercontent.com/'));

  for (const bad of [
    'http://avatars.githubusercontent.com/u/1', // не https
    'https://evil.example.com/x.png', // чужой хост
    'javascript:alert(1)',
    'не url',
  ]) {
    const out = normalizeIdentity({
      provider: 'github',
      providerId: '1',
      email: 'a@b.ru',
      name: 'Иван',
      avatarUrl: bad,
    });
    assert.equal(out?.avatarUrl, undefined, `аватар «${bad}» принят`);
  }
});

test('неизвестный провайдер и пустой providerId не проходят', () => {
  assert.equal(normalizeIdentity({ provider: 'кварс', providerId: '1', email: 'a@b.ru' }), null);
  assert.equal(normalizeIdentity({ provider: 'github', providerId: '', email: 'a@b.ru' }), null);
});
