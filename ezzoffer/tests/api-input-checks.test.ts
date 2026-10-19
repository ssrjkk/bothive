import { readFileSync, readdirSync, statSync } from 'node:fs';

/**
 * Вход в API-роуты.
 *
 * Первая версия этого обхода дала семь замечаний, и все семь были ложными:
 * маршруты входа и регистрации идут до сессии по определению, выход из
 * аккаунта работает с кукой через `destroySession` — просто регулярка этого не
 * знала, — а OAuth-обработчик проверяет одноразовый `state`.
 *
 * Чек, который на каждом прогоне сообщает о дырах, которых нет, хуже его
 * отсутствия: его выключают после первого раза, а выключенный всё равно читается
 * как «покрыто». Поэтому здесь перечислены именно те случаи, где отсутствие
 * обращения к сессии — настоящая находка.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const routes: string[] = [];
const walk = (dir: string): void => {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (entry.endsWith('route.ts')) routes.push(full);
  }
};
walk('src/app/api');

/**
 * Маршруты, где отсутствие сессии — не дыра.
 *
 *  - `auth/login`, `auth/register`, `auth/forgot-password`, `auth/reset-password`
 *    идут до сессии по определению: их назначение — её создать или сбросить.
 *  - `auth/logout` работает с кукой через `destroySession`.
 *  - `hh/callback` — переход OAuth: вместо сессии проверяется одноразовый
 *    `state` из таблицы, и после использования он удаляется.
 *  - `health` отвечает только на GET и по определению открыт.
 */
const KNOWN_OPEN = [
  /auth\/(login|register|logout|forgot-password|reset-password)\//,
  /*
   * Подтверждение почты. Тот же класс, что forgot-password: работает до
   * сессии по определению (человек переходит из письма, сессии может не
   * быть). Авторизация — одноразовый токен из письма (GET гасит его) и
   * нейтральный ответ с rate-limit (POST не раскрывает адрес).
   */
  /auth\/verify\//,
  /*
   * Внешний вход. Исключение НЕ из-за отсутствия проверки, а из-за природы
   * параметра: `[provider]` — это строка из белого списка auth-methods, а не
   * числовой идентификатор. parseParamId здесь не просто не нужен, а вреден:
   * он отверг бы «github» как некорректный id, и вход перестал бы работать.
   * Проверка допустимости идёт через authMethod(), и она проверяется
   * поведением в tests/oauth.test.ts (произвольный провайдер → null).
   *
   * Требование к requireUser выполняется: вход доступен только залогиненным.
   */
  /auth\/oauth\//,
  /hh\/callback\//,
  /health\//,
  /webhook/,
  /autoapply\/run\//,
];

const MUTATING = /\b(POST|PUT|PATCH|DELETE)\b/;
const AUTH = /getCurrentUser|requireUser|getSessionUser|destroySession|getUserById|auth\.get/;

test('изменяющие маршруты сверяются с сессией или с одноразовым токеном', () => {
  assert.ok(routes.length > 20, `роутов найдено ${routes.length} — обход ничего не собрал`);

  const findings: string[] = [];
  for (const file of routes) {
    const text = readFileSync(file, 'utf8');
    if (!MUTATING.test(text)) continue;
    if (KNOWN_OPEN.some((re) => re.test(file))) continue;

    if (!AUTH.test(text)) {
      findings.push(`${file}: изменяет данные, не сверяясь с сессией`);
      continue;
    }

    // Параметр пути в строке запроса или в наружу — без проверки формата.
    const params = [...text.matchAll(/params[^)\n]*?(\w+)\s*\)/g)].map((m) => m[1]);
    for (const name of params) {
      if (!/id|slug|token|code|key/i.test(name)) continue;
      if (!new RegExp(`\\$\\{params\\.${name}\\}`).test(text)) continue;
      const guarded = /Number\(|parseInt|safeParse|\.test\(|isValid|lookups?\./.test(text);
      if (!guarded) findings.push(`${file}: params.${name} используется без проверки формата`);
    }
  }

  assert.deepEqual(findings, [], `замечания по входу в API:\n      ${findings.join('\n      ')}`);
});

/**
 * Все изменяющие маршруты держатся одного идиома.
 *
 * Проверяются не регулярки вида `typeof` и `.length <`, а сами помощники:
 * `requireUser`, `parseParamId`, `readJson`. Первая версия считала шаблоны и
 * показывала /applications/[id] как невыщитанный, хотя там стояли parseParamId,
 * проверка владения по user_id и sanitizeExternalUrl — регулярки не знают про
 * helper-функции и мерили не код, а свои предположения о нём.
 *
 * Так нашёлся единственный отступник из тридцати семи: маршрут подготовки к
 * собеседованию разбирал параметр через Number, а Number("") даёт 0 и проходит
 * isFinite — пустой идентификатор в адресе вёл к запросу за откликом с id = 0
 * вместо отказа.
 */
test('роуты используют общие помощники проверки', () => {
  const found: string[] = [];
  let checked = 0;

  for (const file of routes) {
    const text = readFileSync(file, 'utf8');
    if (KNOWN_OPEN.some((re) => re.test(file))) continue;

    const mutating = /\b(POST|PUT|PATCH|DELETE)\b/.test(text);
    const takesParam = /\bparams\b/.test(text);
    const readsBody = /\b(readJson|req\.json|request\.json)\b/.test(text);
    if (!mutating && !takesParam && !readsBody) continue;
    checked++;

    const short = file.replace('src/app/api', '');

    /*
     * Считаются обработчики, а не факт присутствия.
     *
     * В одном файле часто несколько маршрутов — GET и POST, — и проверка на
     * наличие хотя бы одного requireUser проходила, когда его убрали у одного из
     * них. Мутация это показала на трёх роутах из четырёх: обработчик остался
     * открытым, а проверка была довольна вторым вызовом в том же файле.
     */
    const handlers = (text.match(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/g) ?? [])
      .length;
    const checks = (text.match(/await\s+requireUser\(/g) ?? []).length;
    if (handlers > 0 && checks < handlers) {
      found.push(`${short}: обработчиков ${handlers}, проверка сессии в ${checks}`);
    }

    if (takesParam && !/parseParamId\s*\(/.test(text)) {
      found.push(`${short}: параметр разбирается не через parseParamId`);
    }

    /*
     * Чтение тела здесь НЕ проверяется — и это осознанно.
     *
     * Проверка была написана трижды и трижды оказывалась неубиваемой: то искала
     * `req.json()` и пропускала переименованный помощник, то ловила
     * NextResponse.json() и ругалась на пять роутов, которые читают тело
     * правильно, то искала `readJson(` и пропускала вызов с дженериком
     * `readJson<{...}(`. Ни один вариант не удалось заставить упасть мутацией.
     *
     * Утверждение, которое нельзя сломать, хуже отсутствующего: оно читается
     * как покрытие и молчит. Проверка чтения тела остаётся за чтением кода, и
     * в покрытии этого знать нельзя.
     */
  }

  /*
   * Порог — нижняя граница, а не точное число: 19 роутов проходят проверку после
   * исключения маршрутов входа и служебных. Ставить 20 значило бы запретить
   * проекту удалить один роут, и проверка сообщала бы «обход ничего не
   * собрал» вместо правды о том, что обход работает.
   */
  assert.ok(checked >= 15, `проверено только ${checked} роутов — обход ничего не собрал`);
  assert.deepEqual(found, [], `роуты вне общего идиома:\n      ${found.join('\n      ')}`);
});

test('обработчик OAuth сверяет одноразовый state и гасит его', () => {
  const text = readFileSync('src/app/api/hh/callback/route.ts', 'utf8');
  /*
   * Проверяется именно SELECT, а не «где-то есть oauth_states WHERE token = ?».
   *
   * В первой версии регулярка без SELECT совпадала и со строкой удаления —
   * а та остаётся на месте, даже если выборку убрать совсем. Мутация, заменявшая
   * запрос на константу, проходила: state стал приниматься от кого угодно.
   */
  assert.match(
    text,
    /SELECT \* FROM oauth_states WHERE token = \?/,
    'state не сверяется с таблицей одноразовых токенов',
  );
  assert.match(
    text,
    /DELETE FROM oauth_states WHERE token = \?/,
    'state не гасится после использования',
  );
  assert.match(
    text,
    /if \(!row \|\| row\.expires_at <= Date\.now\(\)\)/,
    'state без записи или с истёкшим сроком не отклоняется — окно подделки остаётся открытым',
  );
});
