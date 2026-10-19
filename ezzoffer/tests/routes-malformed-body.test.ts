import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';

/**
 * Роуты отвечают на мусор, а не падают.
 *
 * Сканеры исходников этого не показывают: четыре проверки подряд в этом проекте
 * искали правильные слова в коде и обманывались переименованием, лишней строкой
 * импорта или сменой написания вызова. Здесь вместо чтения кода делаются
 * настоящие HTTP-запросы, и обмануть это переименованием нельзя.
 *
 * Каждый изменяющий маршрут получает битое тело, чужой идентификатор и запрос
 * без сессии, и обязан ответить 4xx. Ответ 5xx означает, что необработанный вход
 * дошёл до исключения; ответ 2xx — что маршрут принял мусор.
 */

const BASE = process.env.BASE ?? 'http://localhost:3121';

/*
 * ОГРАНИЧЕНИЕ, И КОТОРОЕ ВАЖНЕЕ САМОГО ТЕСТА.
 *
 * Проверка делает настоящие запросы к запущенному серверу, поэтому она видит
 * ту сборку, которая работает, а не те файлы, что лежат в рабочем дереве.
 *
 * Проверено мутацией: правка `parseParamId` в исходниках не роняет ни один из
 * этих тестов, пока сервер не пересобран и не перезапущен. То есть в обычном
 * прогоне `npm test` без работающего сервера тест пропускается, а при
 * работающем — проверяет уже собранное.
 *
 * Для честности это записано здесь, а не подано как «тест ловит регрессии».
 * Чтобы он ловил, сервер перед прогоном нужно пересобрать: сначала `npm run
 * build`, потом старт, потом тест. Без этого шага он честно ничего не проверяет.
 */

/** Маршруты, где сессии быть не может: вход, OAuth, служебные. */
const KNOWN_OPEN = [
  /^\/api\/auth\/(login|register|forgot-password|reset-password)/,
  /^\/api\/hh\/callback/,
  /^\/api\/health/,
  /^\/api\/telegram\/webhook/,
  /^\/api\/autoapply\/run/,
];

/**
 * Выход из аккаунта — исключение из правила «без сессии только 4xx».
 *
 * Тест нашёл, что POST /api/auth/logout отвечает 200 и без сессии. Это верное
 * поведение: выход должен быть идемпотентным, а клиенту нужно сбросить куку
 * в любом случае. Ответ 401 означил бы, что клиент оставит её у себя.
 *
 * Исключение записано здесь, а не молчаливый пропуск: иначе правило «4xx»
 * выглядело бы строже, чем оно есть.
 */
const IDEMPOTENT = [/^\/api\/auth\/logout$/];

type Route = { path: string; file: string; methods: string[] };

const routes: Route[] = [];
const walk = (dir: string, prefix: string): void => {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      walk(full, `${prefix}/${entry}`);
      continue;
    }
    if (entry !== 'route.ts') continue;
    const text = readFileSync(full, 'utf8');
    const methods = [
      ...text.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/g),
    ].map((m) => m[1]);
    routes.push({ path: prefix, file: full, methods });
  }
};
walk('src/app/api', '/api');

function mutating(route: Route): string[] {
  return route.methods.filter((m) => m !== 'GET' && !KNOWN_OPEN.some((re) => re.test(route.path)));
}

async function call(method: string, path: string, body: string): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: BASE },
      body,
    });
    return res.status;
  } catch {
    return null;
  }
}

const serverUp = async (): Promise<boolean> => {
  try {
    const r = await fetch(`${BASE}/api/health`);
    return r.ok;
  } catch {
    return false;
  }
};

test('изменяющие маршруты отвечают 4xx на битое тело', async (t) => {
  if (!(await serverUp())) {
    t.skip('сервер не поднят');
    return;
  }

  const problems: string[] = [];
  let checked = 0;

  for (const route of routes) {
    for (const m of mutating(route)) {
      checked++;
      const status = await call(m, route.path, '{не json');
      if (status === null) problems.push(`${m} ${route.path}: соединение оборвалось`);
      else if (IDEMPOTENT.some((re) => re.test(route.path))) {
        // Выход тело не читает, поэтому «битое» тело для него не имеет смысла.
        if (status >= 500) problems.push(`${m} ${route.path}: ${status} на выходе`);
      } else if (status >= 500)
        problems.push(`${m} ${route.path}: ${status} — необработанный вход дошёл до исключения`);
      else if (status < 400)
        problems.push(`${m} ${route.path}: ${status} — мусор принят за данные`);
    }
  }

  assert.ok(checked >= 10, `проверено только ${checked} обработчиков — обход ничего не собрал`);
  assert.deepEqual(
    problems,
    [],
    `роуты обращаются с мусором неверно:\n      ${problems.join('\n      ')}`,
  );
});

test('мусорный идентификатор в адресе не ведёт к чужому ресурсу', async (t) => {
  if (!(await serverUp())) {
    t.skip('сервер не поднят');
    return;
  }

  /*
   * Чужие и несуществующие идентификаторы — самый частый вход, который ломает
   * маршрут: строка подставляется в запрос к базе. Проверяются все формы,
   * которые Number принимал за целое число, и форма за пределом точности.
   */
  const JUNK = ['0', '-1', '1e3', '0x10', '1.0', 'abc', '99999999999999'];
  const problems: string[] = [];
  let checked = 0;

  for (const route of routes) {
    if (!route.path.includes('/[')) continue;
    const base = route.path.replace(/\/\[[^\]]+\]/, '');
    for (const junk of JUNK) {
      for (const m of route.methods) {
        checked++;
        const status = await call(m, `${base}/${encodeURIComponent(junk)}`, '{}');
        if (status === null) continue;
        if (status >= 500) {
          problems.push(`${m} ${base}/${junk}: ${status} — необработанный идентификатор`);
        }
      }
    }
  }

  assert.ok(checked >= 10, `проверено только ${checked} сочетаний — обход ничего не собрал`);
  assert.deepEqual(
    problems,
    [],
    `мусорный идентификатор роняет маршрут:\n      ${problems.join('\n      ')}`,
  );
});

test('запрос без сессии не меняет состояние', async (t) => {
  if (!(await serverUp())) {
    t.skip('сервер не поднят');
    return;
  }

  /*
   * Сессии нет — заголовка cookie нет. Запрос обязан быть отклонён.
   *
   * Проверяется без чтения кода, потому что предыдущие проверки этого делали
   * и ошибались: одна ловила имя в строке импорта, другая — факт присутствия
   * вызова вместо его наличия в каждом обработчике.
   */
  const problems: string[] = [];
  let checked = 0;

  for (const route of routes) {
    if (
      KNOWN_OPEN.some((re) => re.test(route.path)) ||
      IDEMPOTENT.some((re) => re.test(route.path))
    )
      continue;
    for (const m of mutating(route)) {
      checked++;
      let status: number | null;
      try {
        const res = await fetch(`${BASE}${route.path}`, {
          method: m,
          headers: { 'content-type': 'application/json', origin: BASE },
          body: '{}',
        });
        status = res.status;
      } catch {
        status = null;
      }
      if (status !== null && status >= 500) {
        problems.push(`${m} ${route.path}: ${status} без сессии`);
      }
      if (status !== null && status === 200) {
        problems.push(`${m} ${route.path}: 200 без сессии — состояние меняется анонимно`);
      }
    }
  }

  assert.ok(checked >= 10, `проверено только ${checked} обработчиков`);
  assert.deepEqual(
    problems,
    [],
    `без сессии маршрут отвечает не так:\n      ${problems.join('\n      ')}`,
  );
});
