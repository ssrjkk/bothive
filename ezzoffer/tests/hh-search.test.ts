import test from 'node:test';
import assert from 'node:assert/strict';
import { hhProvider } from '../src/lib/vacancies/hh';
import type { Vacancy } from '../src/lib/vacancies/types';
import { resetHhAppToken } from '../src/lib/hh-app-token';

/**
 * Провайдер hh: поиск и отправка используют РАЗНЫЕ токены.
 *
 * Это не архитектурное препочтение, а требование hh.ru, проверенное вживую:
 *  - `GET /vacancies` (поиск) без токена → 403
 *  - `POST /negotiations` (отклик) требует токен того, кто откликается
 *
 * Смешивать их нельзя: пользовательский токен не даёт нужного доступа к
 * поиску, а токен приложения нельзя использовать для отправки — отклик ушёл
 * бы не от того человека.
 *
 * Проверяется подменой глобального fetch, поэтому видно целиком: какой
 * заголовок Authorization ушёл в каждый запрос.
 */

const ENV_KEYS = ['HH_ACCESS_TOKEN', 'HH_CLIENT_ID', 'HH_CLIENT_SECRET'] as const;
let savedEnv: Record<string, string | undefined> = {};
let savedFetch: typeof globalThis.fetch;

/** Ответ hh для страницы выдачи. */
function vacancyPage(ids: number[]): Response {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        items: ids.map((id) => ({
          id: String(id),
          name: `Вакансия ${id}`,
          employer: { name: 'ООО Тест' },
          area: { name: 'Москва' },
        })),
      }),
  } as unknown as Response;
}

function tokenResponse(token = 'APP-TOKEN'): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ access_token: token, expires_in: 3600 }),
  } as unknown as Response;
}

/** Заглушка вакансии для проверки apply(). */
const V: Vacancy = {
  slug: 'hh-42',
  source: 'hh',
  source_id: '42',
  title: 'Разработчик',
  company: 'ООО',
  salary: '100 000 ₽',
  salary_min: 100000,
  salary_max: null,
  level: 'Middle',
  format: 'В офисе',
  city: 'Москва',
  posted: 'сегодня',
  category: 'Программирование',
  about: '',
  responsibilities: [],
  requirements: [],
  bonus: [],
  source_url: null,
  contact_email: null,
  contact_phone: null,
  published_at: null,
};

test.beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  savedFetch = globalThis.fetch;
  resetHhAppToken();
});

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  globalThis.fetch = savedFetch;
  resetHhAppToken();
});

test('поиск использует токен приложения, а не пользовательский', async () => {
  process.env.HH_CLIENT_ID = 'app-id';
  process.env.HH_CLIENT_SECRET = 'app-secret';

  const auths: (string | undefined)[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (String(url).includes('/token')) return tokenResponse();
    auths.push(headers.Authorization);
    return vacancyPage([1, 2, 3]);
  }) as typeof globalThis.fetch;

  const res = await hhProvider.fetchVacancies({ limit: 3 });

  assert.equal(res.ok, true, `поиск не удался: ${res.error}`);
  assert.equal(res.vacancies.length, 3);
  assert.ok(auths.length > 0, 'запроса к /vacancies не было');
  for (const auth of auths) {
    assert.equal(auth, 'Bearer APP-TOKEN', `в поиск ушёл не тот токен: ${auth}`);
  }
});

test('отправка отклика использует пользовательский токен', async () => {
  process.env.HH_ACCESS_TOKEN = 'APP-SHOULD-NOT-BE-USED';

  let sentAuth: string | undefined;
  let sentBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    sentAuth = ((init?.headers ?? {}) as Record<string, string>).Authorization;
    sentBody = JSON.parse(String(init?.body ?? '{}'));
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
  }) as typeof globalThis.fetch;

  const res = await hhProvider.apply!(V, {
    resumeId: 'resume-1',
    accessToken: 'USER-TOKEN',
    message: 'Здравствуйте',
  });

  assert.equal(res.ok, true, `отклик не отправлен: ${res.error}`);
  assert.equal(sentAuth, 'Bearer USER-TOKEN', 'отклик ушёл не с токеном пользователя');
  assert.equal(sentBody?.message, 'Здравствуйте', 'письмо не попало в отклик');
});

test('без пользовательского токена отклик не отправляется вовсе', async () => {
  // Раньше был фолбэк на HH_ACCESS_TOKEN, то есть отклик мог уйти не от того
  // пользователя, которому он принадлежит.
  process.env.HH_ACCESS_TOKEN = 'APP-TOKEN';

  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
  }) as typeof globalThis.fetch;

  const res = await hhProvider.apply!(V, { resumeId: 'resume-1', accessToken: undefined });

  assert.equal(res.ok, false, 'отклик отправлен без токена пользователя');
  assert.equal(called, false, 'сеть дёрнулась, хотя отправлять нечем');
});

test('поиск обходит страницы, а не берёт только первую', async () => {
  process.env.HH_CLIENT_ID = 'app-id';
  process.env.HH_CLIENT_SECRET = 'app-secret';

  const pages: string[] = [];
  let step = 0;

  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/token')) return tokenResponse();
    pages.push(new URL(u).searchParams.get('page') ?? '0');
    step++;
    // Каждая страница полная: 100 записей с уникальными id.
    return vacancyPage(Array.from({ length: 100 }, (_, i) => step * 100 + i));
  }) as typeof globalThis.fetch;

  // 500 вакансий: одной страницы в 100 не хватит, пагинация обязана сработать.
  const res = await hhProvider.fetchVacancies({ limit: 500 });

  assert.equal(res.ok, true, `поиск не удался: ${res.error}`);
  assert.ok(pages.length >= 5, `запрошено ${pages.length} страниц — пагинация не работает`);
  assert.equal(res.vacancies.length, 500, `собрано ${res.vacancies.length} вместо 500`);
});

test('запрос поиска сортируется по дате публикации', async () => {
  process.env.HH_CLIENT_ID = 'app-id';
  process.env.HH_CLIENT_SECRET = 'app-secret';

  const urls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/token')) return tokenResponse();
    urls.push(u);
    return vacancyPage([1, 2, 3]);
  }) as typeof globalThis.fetch;

  await hhProvider.fetchVacancies({ limit: 10 });

  assert.ok(urls.length > 0, 'поиск не выполнялся');
  assert.match(
    urls[0]!,
    /order_by=publication_time/,
    'нет сортировки по дате — в каталог попадут витринные вакансии',
  );
});

test('первая страница не теряется из-за сбоя на второй', async () => {
  process.env.HH_CLIENT_ID = 'app-id';
  process.env.HH_CLIENT_SECRET = 'app-secret';

  let searchCall = 0;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/token')) return tokenResponse();
    searchCall++;
    if (searchCall === 1) return vacancyPage([1, 2, 3]);
    throw new Error('сеть отвалилась');
  }) as typeof globalThis.fetch;

  const res = await hhProvider.fetchVacancies({ limit: 20 });

  assert.equal(res.ok, true, 'сбой на второй странице отменил первую');
  assert.equal(res.vacancies.length, 3);
});

test('первая страница с ошибкой даёт внятную причину', async () => {
  process.env.HH_CLIENT_ID = 'app-id';
  process.env.HH_CLIENT_SECRET = 'app-secret';

  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/token')) return tokenResponse();
    return { ok: false, status: 403, text: async () => 'forbidden' } as unknown as Response;
  }) as typeof globalThis.fetch;

  const res = await hhProvider.fetchVacancies({ limit: 10 });
  assert.equal(res.ok, false);
  assert.ok(res.error, 'нет текста ошибки — нечем понять, что случилось');
});

test('пустой результат без ошибки не считается поломкой', async () => {
  process.env.HH_CLIENT_ID = 'app-id';
  process.env.HH_CLIENT_SECRET = 'app-secret';

  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/token')) return tokenResponse();
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ items: [] }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;

  const res = await hhProvider.fetchVacancies({ limit: 20 });
  assert.equal(res.ok, true);
  assert.equal(res.vacancies.length, 0);
});

test('без настроенного приложения поиск падает с внятной причиной', async () => {
  // Ни HH_CLIENT_ID/SECRET, ни HH_ACCESS_TOKEN.
  const res = await hhProvider.fetchVacancies({ limit: 10 });

  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /HH_CLIENT_ID|HH_ACCESS_TOKEN/);
});

test('токен приложения запрашивается один раз на страницу пагинации', async () => {
  process.env.HH_CLIENT_ID = 'app-id';
  process.env.HH_CLIENT_SECRET = 'app-secret';

  let tokenCalls = 0;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/token')) {
      tokenCalls++;
      return tokenResponse();
    }
    return vacancyPage([1, 2, 3]);
  }) as typeof globalThis.fetch;

  await hhProvider.fetchVacancies({ limit: 20 });

  assert.equal(tokenCalls, 1, `токен запрашивался ${tokenCalls} раз — обмен должен кэшироваться`);
});
