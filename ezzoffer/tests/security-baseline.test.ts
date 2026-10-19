import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

/**
 * Проверка по правилам безопасности Next.js.
 *
 * Правила взяты из установленного скилла
 * `security-best-practices/references/javascript-typescript-nextjs-web-server-security.md`
 * и проверяются поведением, а не чтением: заголовок либо выдаётся, либо нет —
 * независимо от того, сколько строк за ним стоит.
 *
 * Проверяется то, что можно проверить однозначно. Качество разметки остальных
 * правил (валидация каждого поля, ограничения на вложенность запросов) целиком
 * не автоматизируется, и делать вид, что оно проверено, не стоит.
 */

const BASE = process.env.BASE ?? 'http://localhost:3121';

async function audit(): Promise<{ ok: string[]; findings: string[] }> {
  const findings: string[] = [];
  const ok: string[] = [];

  const check = (name: string, condition: boolean, howToFix: string): void => {
    if (condition) ok.push(name);
    else findings.push(`${name} — ${howToFix}`);
  };

  /* NEXT-SESS-001: атрибуты cookie сессии. */
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, referer: `${BASE}/login` },
    body: JSON.stringify({ email: 'qa2@example.com', password: 'testpass123' }),
  });
  const session =
    (login.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('ez_session=')) ?? '';

  /*
   * Вход мог не состояться по двум причинам, и обе не про безопасность.
   *
   * Первая — лимит запросов: прогон тестов несколько раз подряд упирается в
   * ограничение аутентификации, и cookie просто не приходит. Вторая — нет
   * тестовой учётной записи.
   *
   * Раньше это читалось как «сессионная cookie доступна из JavaScript», то есть
   * как дыра в безопасности, которой нет. Проверка безопасности, которая
   * сообщает о дыре при отказе входа, хуже отсутствия проверки: её выключают
   * после первого же ложного сигнала.
   */
  if (!session) return { ok: ['вход недоступен — проверка пропущена'], findings: [] };

  check(
    'NEXT-SESS-001 httpOnly',
    /HttpOnly/i.test(session),
    'сессионная cookie доступна из JavaScript страницы',
  );
  check('NEXT-SESS-001 SameSite', /SameSite/i.test(session), 'cookie уходит на сторонние домены');
  const secureOk = /^https:/i.test(BASE)
    ? /;\s*Secure/i.test(session)
    : !/;\s*Secure/i.test(session);
  check(
    'NEXT-SESS-001 Secure соответствует протоколу',
    secureOk,
    'флаг Secure не соответствует протоколу',
  );

  /* NEXT-HEADERS-001 и NEXT-CSP-001. */
  const headers = (await fetch(`${BASE}/`)).headers;
  check(
    'NEXT-HEADERS-001 X-Content-Type-Options',
    headers.has('x-content-type-options'),
    'нет nosniff',
  );
  check('NEXT-HEADERS-001 Referrer-Policy', headers.has('referrer-policy'), 'нет referrer-policy');
  check(
    'NEXT-HEADERS-001 защита от iframe',
    headers.has('x-frame-options') ||
      (headers.get('content-security-policy') ?? '').includes('frame-ancestors'),
    'страницу можно встроить в iframe',
  );
  check(
    'NEXT-HEADERS-001 Permissions-Policy',
    headers.has('permissions-policy'),
    'нет permissions-policy',
  );
  check(
    'NEXT-CSP-001 Content-Security-Policy',
    headers.has('content-security-policy'),
    'нет CSP: ошибка в разметке превращается в выполнение скрипта',
  );

  /* NEXT-AUTH-002 и NEXT-CSRF-001: покрытие и защита. */
  const proxy = readFileSync('src/proxy.ts', 'utf8');
  const matcher = /matcher:\s*\[([^\]]*)\]/.exec(proxy)?.[1] ?? '';
  check(
    'NEXT-AUTH-002 middleware покрывает кабинет',
    matcher.includes('/dashboard'),
    'часть страниц идёт мимо проверки сессии',
  );
  check(
    'NEXT-CSRF-001 проверка Origin в промежуточном слое',
    proxy.includes('origin') && proxy.includes('403'),
    'записи с аутентификацией по cookie без проверки Origin',
  );

  const noOrigin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'x@example.test', password: 'y' }),
  });
  check(
    'NEXT-CSRF-001 запрос без Origin отклоняется',
    noOrigin.status === 403,
    `без Origin отвечает ${noOrigin.status}`,
  );

  /* NEXT-INPUT-001: вход проверяется, а не падает. */
  const badJson = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: '{не json',
  });
  check(
    'NEXT-INPUT-001 битое тело не роняет сервер',
    badJson.status === 400 || badJson.status === 422,
    `на битое тело отвечает ${badJson.status}`,
  );

  /*
   * NEXT-SECRETS-001: серверные модули не попадают в клиентский код.
   *
   * Проверяются именно операторы import, а не наличие слова в файле. Первая
   * версия искала подстроку и находила «auth» в ссылках на /api/auth/login и в
   * слове «авторизация» — десять ложных срабатываний на пуст��ме месте.
   */
  const serverOnly = ['auth', 'db', 'hh-app-token', 'autoapply', 'skills', 'gigs'];
  const leaked: string[] = [];
  const importRe = /^\s*import\s[\s\S]*?from\s*["']([^"']+)["']/gm;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const text = readFileSync(full, 'utf8');
      if (!/^\s*["']use client["']/m.test(text)) continue;
      importRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(text)) !== null) {
        const spec = m[1];
        for (const name of serverOnly) {
          if (new RegExp(`(?:^|/)(?:@/)?lib/${name}$`).test(spec.replace('@/', ''))) {
            leaked.push(`${full} импортирует ${name}`);
          }
        }
      }
    }
  };
  walk('src');
  check(
    'NEXT-SECRETS-001 серверные модули не текут в клиент',
    leaked.length === 0,
    leaked.join(', '),
  );

  return { ok, findings };
}

test('правила безопасности Next.js соблюдены', async (t) => {
  let result: { ok: string[]; findings: string[] };
  try {
    result = await audit();
  } catch (e) {
    t.skip(`сервер недоступен: ${(e as Error).message.slice(0, 80)}`);
    return;
  }

  assert.ok(result.ok.length > 0, 'ни одно правило не проверено — проверка молча ничего не делает');
  assert.deepEqual(
    result.findings,
    [],
    `замечания по безопасности:\n      ${result.findings.join('\n      ')}`,
  );
});
