import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Лимит тела JSON-запроса.
 *
 * Раньше readJson делал `await request.text()` и проверял длину ПОСЛЕ чтения:
 * лимит существовал, но память под тело выделялась до него. Гигабайтный POST
 * упирался в лимит уже после того, как лёг в память.
 *
 * Теперь два рубежа: заявленная длина из Content-Length (до чтения) и счётчик
 * по ходу потокового чтения (заголовок можно занизить или не прислать при
 * chunked). Проверяется поведение, а не исходник.
 *
 * Импорт модуля — только после useInMemoryDb: src/lib/api тянет auth → db, а
 * db открывает файл при импорте. Статический import вверху файла открыл бы
 * РАБОЧУЮ базу (проверено: в логе было «Открыта БД: data/ezoffer.db»).
 */

let readJson: typeof import('../src/lib/api').readJson;

before(async () => {
  const { useInMemoryDb } = await import('./helpers/route-session');
  useInMemoryDb();
  ({ readJson } = await import('../src/lib/api'));
});

function req(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', { method: 'POST', headers, body });
}

test('обычный JSON читается', async () => {
  const { data, error } = await readJson<{ a: number }>(req(JSON.stringify({ a: 1 })));
  assert.equal(error, undefined);
  assert.deepEqual(data, { a: 1 });
});

test('битый JSON даёт 400, а не исключение', async () => {
  const { data, error } = await readJson(req('{не json'));
  assert.equal(data, undefined);
  assert.equal(error?.status, 400);
});

test('заявленный Content-Length сверх страховки отклоняется до чтения', async () => {
  // Тело маленькое, но заголовок врёт вверх: читать не должны вообще.
  const { error } = await readJson(req(JSON.stringify({ a: 1 }), { 'content-length': '10000000' }));
  assert.equal(error?.status, 400);
});

test('поток сверх страховки отклоняется по ходу чтения', async () => {
  // ReadableStream без длины: единственный рубеж до декодирования — счётчик.
  const big = 'x'.repeat(2_500_000);
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(`{"s":"${big}"}`));
      c.close();
    },
  });
  const { error } = await readJson(
    new Request('http://localhost/api/test', {
      method: 'POST',
      body: stream,
      // Без duplex Node не отдаёт тело потоком.
      duplex: 'half',
    } as RequestInit),
  );
  assert.equal(error?.status, 400);
});

test('символьный лимит не зависит от языка текста', async () => {
  // 170 000 символов кириллицы — это ~340 000 байт: грубую страховку (2 МБ)
  // проходит, символьный лимит (200 000) — тоже. Резать нельзя.
  const ok = await readJson<{ s: string }>(req(JSON.stringify({ s: 'ж'.repeat(170_000) })));
  assert.equal(ok.error, undefined, 'кириллический текст в пределах лимита обязан читаться');
  // А 300 000 символов — нельзя, хоть это и латиница в один байт.
  const over = await readJson<{ s: string }>(req(JSON.stringify({ s: 'x'.repeat(300_000) })));
  assert.equal(over.error?.status, 400, 'тело сверх символьного лимита обязано отклоняться');
});
