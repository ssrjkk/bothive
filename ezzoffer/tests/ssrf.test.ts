import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isOutboundUrlAllowed,
  assertOutboundUrlAllowed,
  filterOutboundUrls,
} from '../src/lib/ssrf';

/**
 * SSRF-фильтр для исходящих запросов.
 *
 * Без него адрес из env (COMPANY_JOB_FEEDS) уходил в fetch как есть:
 * file:// читал локальные файлы, а 169.254.169.254 — метаданные облака,
 * где лежат временные креды.
 */

test('разрешены обычные публичные https-адреса', () => {
  assert.equal(isOutboundUrlAllowed('https://careers.example.com/jobs.rss'), true);
  assert.equal(isOutboundUrlAllowed('http://example.com/feed'), true);
  assert.equal(isOutboundUrlAllowed('https://feeds.greenhouse.io/x'), true);
});

test('не-URL отклоняются', () => {
  assert.equal(isOutboundUrlAllowed('не ссылка'), false);
  assert.equal(isOutboundUrlAllowed(''), false);
  assert.equal(isOutboundUrlAllowed('example.com'), false, 'без схемы не парсится как URL');
});

test('локальные схемы запрещены', () => {
  for (const url of [
    'file:///etc/passwd',
    'ftp://example.com/x',
    'gopher://example.com',
    'data:text/plain,hello',
    'javascript:alert(1)',
  ]) {
    assert.equal(isOutboundUrlAllowed(url), false, `${url} должен быть отклонён`);
  }
});

test('loopback и служебные имена запрещены', () => {
  for (const url of [
    'http://localhost/feed',
    'http://127.0.0.1:8080/feed',
    'http://127.0.0.1/feed',
    'http://[::1]/feed',
    'http://metadata.google.internal/',
    'http://redis/feed',
  ]) {
    assert.equal(isOutboundUrlAllowed(url), false, `${url} должен быть отклонён`);
  }
});

test('приватные диапазоны IPv4 запрещены', () => {
  for (const url of [
    'http://10.0.0.5/feed',
    'http://172.16.0.1/feed',
    'http://172.31.255.254/feed',
    'http://192.168.1.1/feed',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/feed',
    'http://0.0.0.0/feed',
  ]) {
    assert.equal(isOutboundUrlAllowed(url), false, `${url} должен быть отклонён`);
  }
});

test('публичные IPv4 остаются разрешены', () => {
  // Границы проверяем осознанно: 172.32.x уже вне /12, а 100.128.x вне /10.
  assert.equal(isOutboundUrlAllowed('http://172.32.0.1/feed'), true);
  assert.equal(isOutboundUrlAllowed('http://100.128.0.1/feed'), true);
  assert.equal(isOutboundUrlAllowed('http://8.8.8.8/feed'), true);
  assert.equal(isOutboundUrlAllowed('http://93.184.216.34/feed'), true);
});

test('внутренние суффиксы доменов запрещены', () => {
  for (const url of [
    'http://db.local/feed',
    'http://api.internal/feed',
    'http://app.localhost/feed',
  ]) {
    assert.equal(isOutboundUrlAllowed(url), false, `${url} должен быть отклонён`);
  }
});

test('IPv6 внутренние диапазоны запрещены', () => {
  assert.equal(isOutboundUrlAllowed('http://[fe80::1]/feed'), false);
  assert.equal(isOutboundUrlAllowed('http://[fc00::1]/feed'), false);
  assert.equal(isOutboundUrlAllowed('http://[fd12:3456::1]/feed'), false);
  assert.equal(isOutboundUrlAllowed('http://[::ffff:127.0.0.1]/feed'), false);
});

test('публичный IPv6 разрешён', () => {
  assert.equal(isOutboundUrlAllowed('http://[2606:4700:4700::1111]/feed'), true);
});

test('assertOutboundUrlAllowed объясняет причину отказа', () => {
  const reason = assertOutboundUrlAllowed('http://169.254.169.254/');
  assert.ok(reason !== null);
  assert.match(reason, /внутренней сети/);

  const scheme = assertOutboundUrlAllowed('file:///etc/passwd');
  assert.ok(scheme !== null);
  assert.match(scheme, /схема/);

  assert.equal(assertOutboundUrlAllowed('https://example.com/x'), null);
});

test('filterOutboundUrls разделяет разрешённые и отклонённые', () => {
  const { allowed, rejected } = filterOutboundUrls([
    'https://careers.example.com/feed',
    'http://127.0.0.1/feed',
    'file:///etc/passwd',
  ]);
  assert.deepEqual(allowed, ['https://careers.example.com/feed']);
  assert.equal(rejected.length, 2);
  assert.match(rejected[0]!, /127\.0\.0\.1/);
});

test('пустой список обрабатывается без ошибок', () => {
  assert.deepEqual(filterOutboundUrls([]), { allowed: [], rejected: [] });
});
