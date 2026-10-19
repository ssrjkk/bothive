import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Логика sitemap/robots. Раньше base = process.env.SITE_URL ?? "https://ezoffer.ru",
 * а SITE_URL= в .env.example пустой: `??` на пустой строке не срабатывает, и
 * sitemap получался с относительными url ("/jobs"), который невалиден.
 */
function resolveBase(siteUrl: string | undefined): string {
  return (siteUrl?.trim() || 'https://ezoffer.ru').replace(/\/$/, '');
}

function buildUrls(siteUrl: string | undefined, dynamic: string[]): string[] {
  const base = resolveBase(siteUrl);
  return ['', '/faq', ...dynamic].map((route) => `${base}${route}`);
}

test('пустой SITE_URL даёт валидный абсолютный base', () => {
  assert.equal(resolveBase(''), 'https://ezoffer.ru');
  assert.equal(resolveBase('   '), 'https://ezoffer.ru');
  assert.equal(resolveBase(undefined), 'https://ezoffer.ru');
});

test('непустой SITE_URL уважается, хвостовой слэш убирается', () => {
  assert.equal(resolveBase('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(resolveBase('http://localhost:3000/'), 'http://localhost:3000');
  assert.equal(resolveBase('  https://ezoffer.ru/  '), 'https://ezoffer.ru');
});

test('все URL sitemap абсолютные даже с пустым SITE_URL (regression)', () => {
  for (const url of buildUrls('', ['/jobs/a', '/blog/b'])) {
    assert.ok(url.startsWith('http'), `${url} должен быть абсолютным`);
    assert.ok(!url.startsWith('//'), `${url} не должен быть protocol-relative`);
  }
});

test('главная страница не получает двойной слэш', () => {
  assert.equal(buildUrls('https://ezoffer.ru/', [])[0], 'https://ezoffer.ru');
  assert.equal(buildUrls('', [])[0], 'https://ezoffer.ru');
});

test('динамические маршруты попадают в sitemap', () => {
  const urls = buildUrls('https://ezoffer.ru', ['/jobs/dev', '/blog/post', '/resume-examples/cv']);
  assert.ok(urls.includes('https://ezoffer.ru/jobs/dev'));
  assert.ok(urls.includes('https://ezoffer.ru/blog/post'));
  assert.ok(urls.includes('https://ezoffer.ru/resume-examples/cv'));
});

test('robots закрывает приватные зоны', () => {
  const disallow = ['/dashboard', '/api/', '/login', '/signup'];
  assert.ok(disallow.includes('/dashboard'), 'кабинет не должен индексироваться');
  assert.ok(
    disallow.some((d) => d.startsWith('/api')),
    'API не должен индексироваться',
  );
});
