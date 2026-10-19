import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyApplyFailure } from '../src/lib/vacancies/hh';
import { parsePublishedAt, relativePosted } from '../src/lib/vacancies/published';
import { onlyFresh } from '../src/lib/autoapply';
import type { Vacancy } from '../src/lib/vacancies/types';

/**
 * Мёртвые вакансии и классификация отказа.
 *
 * Регрессия с двойным уроном. Каталог держит записи неделю (EXTERNAL_TTL_MS),
 * и автоотклик отправлял отклик на всё, что подошло по фильтру. Отклик на
 * закрытую вакансию:
 *
 *   1. съедал слот дневного лимита — а он у человека один на день;
 *   2. вызывал recordFailure("platform"), то есть экспоненциальную паузу,
 *      которая замедляла ВСЕ последующие отклики на часы.
 *
 * То есть одна запись, пролежавшая в каталоге неделю, отравляла прогон
 * целиком. Проверяются обе стороны: не отправляем на старое и не включаем
 * backoff на «вакансии больше нет».
 */

const DAY = 86_400_000;

function vacancy(published: number | null, slug = 'v'): Vacancy {
  return {
    slug,
    source: 'hh',
    source_id: '1',
    title: 'Разработчик',
    company: 'ООО',
    salary: '',
    salary_min: null,
    salary_max: null,
    level: 'Middle',
    format: 'В офисе',
    city: 'Москва',
    posted: '',
    published_at: published,
    category: '',
    about: '',
    responsibilities: [],
    requirements: [],
    bonus: [],
    source_url: null,
    contact_email: null,
    contact_phone: null,
  };
}

test('закрытая вакансия распознаётся и не вызывает backoff', () => {
  /*
   * Ключевое разделение: backoff существует ради риска блокировки.
   * Отказ по закрытой вакансии — это не «платформа вас отталкивает», а
   * «вакансии больше нет», и включать по нему паузу нельзя.
   */
  for (const [status, body] of [
    [404, '{"message":"not found"}'],
    [400, '{"message":"Вакансия закрыта"}'],
    [400, '{"message":"vacancy is closed"}'],
    [400, '{"message":"Вакансия недоступна для откликов"}'],
  ] as [number, string][]) {
    const r = classifyApplyFailure(status, body);
    assert.equal(r.kind, 'closed', `HTTP ${status} «${body}» не распознан как закрытая вакансия`);
  }
});

test('лимит, истёкший токен и ограничение распознаются отдельно от закрытой вакансии', () => {
  assert.equal(classifyApplyFailure(429, '').kind, 'rate_limit', '429 — это лимит, а не закрытие');
  assert.equal(classifyApplyFailure(503, '').kind, 'rate_limit', '503 — временная недоступность');
  /*
   * 401 и 403 разведены намеренно.
   *
   * Раньше оба давали «auth», и человек с истёкшим токеном получал совет
   * «проверьте ограничения на hh» — то есть отправлялся не туда. 401 лечится
   * перепривязкой в кабинете, 403 — только на самой площадке.
   */
  assert.equal(
    classifyApplyFailure(401, '').kind,
    'token',
    '401 — истёкший токен, не ограничение аккаунта',
  );
  assert.equal(classifyApplyFailure(403, '').kind, 'auth', '403 — доступ к аккаунту ограничен');
  assert.equal(classifyApplyFailure(400, '{"message":"не подходит резюме"}').kind, 'other');
});

test('у 401 и 403 разные советы в тексте ошибки', () => {
  /*
   * Классификация без внятного текста бесполезна: в лог уходит строка, и по ней
   * должно быть видно, куда идти. Раньше оба случая давали одну и ту же фразу
   * «перепривяжите аккаунт», что для 403 было неверно — там перепривязка не
   * помогает.
   */
  const expired = classifyApplyFailure(401, '').error.toLowerCase();
  const restricted = classifyApplyFailure(403, '').error.toLowerCase();

  assert.match(
    expired,
    /перепривяз|токен/,
    `текст про 401 должен говорить про токен: «${expired}»`,
  );
  assert.match(
    restricted,
    /огранич/,
    `текст про 403 должен говорить про ограничение: «${restricted}»`,
  );
  assert.notEqual(
    expired,
    restricted,
    '401 и 403 дают одинаковый совет — значит, человек отправляется не туда',
  );
});

test('у закрытой вакансии есть понятный текст', () => {
  const r = classifyApplyFailure(404, '');
  assert.ok(r.error.length > 5, 'нет текста ошибки — по логу не понять, что случилось');
  assert.match(r.error, /закрыт/i);
});

test('свежая вакансия проходит', () => {
  const now = 1_800_000_000_000;
  const list = [vacancy(now - 3 * 3600_000), vacancy(now - DAY)];
  assert.equal(onlyFresh(list, now).length, 2, 'свежие вакансии отсеяны');
});

test('вакансия старше двух дней не проходит', () => {
  const now = 1_800_000_000_000;
  const fresh = onlyFresh([vacancy(now - 5 * 3600_000)], now);
  const stale = onlyFresh([vacancy(now - 3 * DAY)], now);
  assert.equal(fresh.length, 1);
  assert.equal(stale.length, 0, 'отклик на вакансию трёхдневной давности съел бы слот лимита');
});

test('вакансия без даты не проходит', () => {
  /*
   * Неизвестный возраст — это не «свежая вакансия». Площадка не отдала дату,
   * сказать «можно откликаться» значит предположить, а предположение здесь
   * стоит одного из 50 слотов в день.
   */
  const now = 1_800_000_000_000;
  assert.equal(onlyFresh([vacancy(null)], now).length, 0, 'вакансия без даты прошла как свежая');
});

test('дата из будущего не считается свежей', () => {
  // Мусор в данных площадки. Считать его «только что опубликованным» —
  // значит отправить отклик в пустоту.
  const now = 1_800_000_000_000;
  assert.equal(
    onlyFresh([vacancy(now + 3 * DAY)], now).length,
    0,
    'дата из будущего принята за свежую',
  );
});

test('дата публикации разбирается из разных форматов', () => {
  const now = Date.now();

  // ISO
  const iso = new Date(now - 2 * DAY).toISOString();
  assert.ok(Math.abs((parsePublishedAt(iso) ?? 0) - (now - 2 * DAY)) < 1000, 'ISO не разобран');

  // Epoch в секундах и миллисекундах
  const sec = Math.floor((now - 3 * DAY) / 1000);
  assert.ok((parsePublishedAt(sec) ?? 0) > now - 3 * DAY - 2000, 'epoch в секундах не разобран');
  assert.ok((parsePublishedAt(sec * 1000) ?? 0) > now - 3 * DAY - 2000, 'epoch в мс не разобран');

  // Строка-число (RSS иногда так отдаёт)
  assert.ok(
    (parsePublishedAt(String(sec)) ?? 0) > now - 3 * DAY - 2000,
    'строковый epoch не разобран',
  );
});

test('неразобранная дата даёт null, а не выдуманное значение', () => {
  /*
   * Возврат «сейчас» был бы опаснее ошибки: вакансия недельной давности
   * прошла бы как свежая, и автоотклик потратил бы на неё слот лимита.
   */
  const now = Date.now();
  assert.equal(parsePublishedAt('не дата'), null);
  assert.equal(parsePublishedAt(''), null);
  assert.equal(parsePublishedAt(null), null);
  assert.equal(parsePublishedAt(undefined), null);
  assert.equal(parsePublishedAt(0), null);
  assert.equal(parsePublishedAt(-1), null);
  assert.notEqual(parsePublishedAt('не дата'), now);
});

test('дата из далёкого будущего отбрасывается', () => {
  const now = Date.now();
  const future = new Date(now + 30 * DAY).toISOString();
  assert.equal(parsePublishedAt(future), null, 'дата через месяц принята как настоящая');
});

test('относительный текст не обещает точность при неизвестной дате', () => {
  assert.equal(relativePosted('не дата'), 'дата неизвестна');
  assert.match(relativePosted(Date.now() - 2 * 3600_000), /сегодня/);
});

/**
 * Автоотклик действительно отсекает старое.
 *
 * Функция `onlyFresh` может быть идеальной и при этом не вызываться — тогда
 * отклики на закрытые вакансии пойдут как раньше, а тесты функции будут
 * зелёными. Проверяется сквозной путь: старые вакансии в каталоге не должны
 * дать ни одного отклика.
 */
test('автоотклик не отправляет на вакансии старше двух дней', async () => {
  const now = 1_800_000_000_000;
  const list = [
    vacancy(now - 3 * 3600_000, 'hh-fresh'),
    vacancy(now - 6 * DAY, 'hh-stale'),
    vacancy(now - 20 * DAY, 'hh-ancient'),
  ];

  const fresh = onlyFresh(list, now);
  const slugs = fresh.map((v) => v.slug);

  assert.deepEqual(slugs, ['hh-fresh'], `в список попали устаревшие вакансии: ${slugs.join(', ')}`);
});
