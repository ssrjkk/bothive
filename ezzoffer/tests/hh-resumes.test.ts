import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { listHhResumes, fetchHhResumeContent } from '../src/lib/hh-resumes';

/**
 * Импорт резюме с hh.ru.
 *
 * Ответ hh на резюме — не плоский JSON, а набор именованных блоков. Разбор
 * именно его и есть суть модуля: если порядок блоков потеряется, текст
 * получится вперемешку, оценка по опыту не найдёт границ между
 * достижениями, а человек увидит бессвязный набор строк.
 *
 * Сеть подменяется, поэтому видно содержимое уходящего запроса.
 */

let savedFetch: typeof globalThis.fetch;
const urls: string[] = [];
const auths: (string | undefined)[] = [];

/**
 * Заглушка ответа. У настоящего Response есть json(), поэтому заглушка
 * обязана его иметь: иначе тест проверял бы работу заглушки, а не кода.
 */
function respond(body: unknown, ok = true, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

beforeEach(() => {
  urls.length = 0;
  auths.length = 0;
  savedFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
});

function mock(responder: (url: string) => Response) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    urls.push(u);
    auths.push(((init?.headers ?? {}) as Record<string, string>).Authorization);
    return responder(u);
  }) as typeof globalThis.fetch;
}

/** Типичный ответ hh: блоки приходят в произвольном порядке. */
const RESUME_RESPONSE = {
  id: '123',
  title: 'Frontend Developer',
  first_name: 'Иван',
  last_name: 'Петров',
  city: { name: 'Москва' },
  blocks: [
    {
      name: 'Навыки',
      bullets: [{ text: 'React, TypeScript' }, { text: 'Node.js' }],
    },
    {
      name: 'Опыт работы',
      paragraphs: [{ text: 'Разработчик, OOO, 3 года' }],
      bullets: [{ text: 'Сократил LCP с 4.2с до 1.6с' }],
    },
    {
      name: 'Образование',
      paragraphs: [{ text: 'МГУ, прикладная математика' }],
    },
  ],
};

test('список резюме отдаёт id и названия', async () => {
  mock(() =>
    respond({
      items: [
        { id: '1', title: 'Frontend Developer', updated_at: '2026-01-02T10:00:00+03:00' },
        { id: '2', title: 'Backend Developer' },
      ],
    }),
  );

  const list = await listHhResumes('token-1');

  assert.equal(list.length, 2);
  assert.equal(list[0]!.id, '1');
  assert.equal(list[1]!.title, 'Backend Developer');
  assert.equal(list[1]!.updatedAt, null, 'отсутствующая дата не должна превращаться в текущую');
});

test('список пустой при ошибке — не выдумывается', async () => {
  mock(() => respond({}, false, 401));
  const list = await listHhResumes('token-1');
  assert.deepEqual(list, [], 'при ошибке возвращены выдуманные резюме');
});

test('блоки собираются в порядке чтения', async () => {
  mock(() => respond(RESUME_RESPONSE));

  const content = await fetchHhResumeContent('token-1', '123');
  assert.ok(content, 'содержимое не получено');

  const text = content!.text;
  const iExp = text.indexOf('Опыт работы');
  const iEdu = text.indexOf('Образование');
  const iSkills = text.indexOf('Навыки');

  assert.ok(iExp >= 0 && iEdu >= 0 && iSkills >= 0, `блоки потеряны: ${text}`);
  assert.ok(iExp < iEdu, 'образование идёт раньше опыта — документ читается не по-человечески');
  assert.ok(iEdu < iSkills, 'навыки идут раньше образования');
});

test('пункты списка не слипаются в один абзац', async () => {
  /*
   * Без маркера две строки достижений становятся одной, и оценка по опыту
   * не может отделить одно достижение от другого — а именно достижения с
   * цифрами чаще всего и решают, берут или нет.
   */
  mock(() => respond(RESUME_RESPONSE));

  const content = await fetchHhResumeContent('token-1', '123');
  const text = content!.text;

  assert.match(text, /- React, TypeScript/, 'пункт без маркера');
  assert.match(text, /- Сократил LCP/, 'достижение не отделено маркером');
  assert.doesNotMatch(text, /React, TypeScript-/, 'строки слиплись');
});

test('имя, должность и город попадают в начало', async () => {
  mock(() => respond(RESUME_RESPONSE));

  const content = await fetchHhResumeContent('token-1', '123');
  const text = content!.text;

  assert.match(text, /Иван Петров/, 'ФИО не подставлено');
  assert.match(text, /Frontend Developer/, 'должность не подставлена');
  assert.ok(text.indexOf('Иван Петров') < text.indexOf('Опыт работы'), 'шапка не в начале');
});

test('запрос идёт с токеном пользователя', async () => {
  mock(() => respond(RESUME_RESPONSE));
  await fetchHhResumeContent('user-token', '123');

  assert.equal(auths[0], 'Bearer user-token', 'резюме запрошено не с токеном пользователя');
  assert.match(urls[0]!, /resumes\/123/, `неверный URL: ${urls[0]}`);
});

test('разметка hh вычищается', async () => {
  mock(() =>
    respond({
      id: '1',
      title: 'Dev',
      blocks: [
        {
          name: 'О себе',
          paragraphs: [{ text: '<p>Пишу на <b>React</b> и&nbsp;TypeScript</p>' }],
        },
      ],
    }),
  );

  const content = await fetchHhResumeContent('t', '1');
  assert.match(content!.text, /Пишу на React и TypeScript/);
  assert.doesNotMatch(content!.text, /<b>|&nbsp;/, 'разметка не вычищена');
});

test('пустое резюме не превращается в текст из заголовков', async () => {
  mock(() => respond({ id: '1', title: 'Пустое', blocks: [] }));

  const content = await fetchHhResumeContent('t', '1');
  assert.ok(content, 'вернулось null вместо пустого резюме');
  assert.ok(content!.text.length < 100, `в пустом резюме оказалось текста: ${content!.text}`);
});

test('ошибка чтения не превращается в пустое резюме', async () => {
  // Иначе импорт «успешно» создал бы пустое резюме, и человек увидел бы
  // в списке бессмысленную запись, решив, что так и есть.
  mock(() => respond({}, false, 404));
  const content = await fetchHhResumeContent('t', '123');
  assert.equal(content, null, 'при ошибке вернулось пустое резюме вместо null');
});
