import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesSearch, skillsByVacancy, type SearchRow } from '../src/lib/matcher';
import { parseKeywords } from '../src/lib/skills';
import { resolveAreaId, resetAreasCache, normalizeCity } from '../src/lib/hh-areas';
import type { Vacancy } from '../src/lib/vacancies/types';

/**
 * Три поломки подбора, найденные разбором живого кода.
 *
 * Все три молча давали НЕВЕРНЫЙ результат — не ошибку, а пустую или, наоборот,
 * слишком широкую выдачу. Поэтому и проверяются не на «не упало», а на
 * конкретный результат.
 */

function vac(over: Partial<Vacancy> = {}): Vacancy {
  return {
    slug: 'hh-1',
    source: 'hh',
    source_id: '1',
    title: 'Разработчик',
    company: 'Компания',
    salary: '',
    salary_min: null,
    salary_max: null,
    level: 'Middle',
    format: 'Удалённо',
    city: 'Москва',
    posted: '',
    category: 'Работа',
    about: 'Команда, продукт',
    responsibilities: [],
    requirements: [],
    bonus: [],
    source_url: null,
    contact_email: null,
    contact_phone: null,
    published_at: null,
    ...over,
  };
}

function search(over: Partial<SearchRow> = {}): SearchRow {
  return {
    id: 1,
    user_id: 1,
    title: 't',
    keywords: '',
    salary_min: null,
    salary_max: null,
    format: '',
    city: '',
    level: '',
    company_blacklist: '',
    active: 1,
    started_at: null,
    created_at: 0,
    ...over,
  };
}

// --------------------------------------------------------------- навыки/слова

/**
 * Регрессия: многословный ключ требовался дважды.
 *
 * `parseKeywords("customer support")` возвращал `skills: ["Поддержка"]` И
 * `words: ["customer support"]`, а `matchesClause` требует ОБА условия.
 * То есть вакансия «Поддержка клиентов» с навыком «Поддержка» НЕ проходила
 * подбор по запросу «customer support». Распознавание отменяло само себя.
 *
 * Затронуты все пары «английский навык ↔ русская вакансия», потому что
 * словарь переводит синонимы, а буквальной фразы в вакансии нет.
 */
test('многословный ключ не требует буквальной фразы в вакансии (regression)', () => {
  const parsed = parseKeywords('customer support');
  assert.ok(parsed.skills.includes('Поддержка'), 'навык не распознан');
  assert.equal(
    parsed.words.length,
    0,
    `навык продублирован как обычное слово: ${JSON.stringify(parsed.words)} — условие станет И`,
  );

  const v = vac({ title: 'Поддержка клиентов', about: 'Помогать клиентам' });
  const skills = skillsByVacancy([v]);
  assert.equal(
    matchesSearch(v, search({ keywords: 'customer support' }), skills.get(v.slug)),
    true,
    'подбор не нашёл вакансию по навыку «Поддержка»',
  );
});

test('и наоборот: русский ключ находит английскую вакансию', () => {
  const v = vac({ title: 'Customer Support Specialist' });
  const skills = skillsByVacancy([v]);
  assert.equal(matchesSearch(v, search({ keywords: 'поддержка' }), skills.get(v.slug)), true);
});

test('«или» по-прежнему работает', () => {
  /*
   * Проверяем именно семантику ИЛИ, а не «оба слова сразу»: вакансия
   * подходит, если совпало ЛЮБОЕ из условий.
   */
  const analytics = vac({ title: 'Аналитик данных', requirements: ['SQL'] });
  const marketing = vac({ title: 'Маркетолог', about: 'продвижение' });
  const neither = vac({ title: 'Бухгалтер', about: 'отчётность' });

  const sa = skillsByVacancy([analytics]).get(analytics.slug)!;
  const sm = skillsByVacancy([marketing]).get(marketing.slug)!;
  const sn = skillsByVacancy([neither]).get(neither.slug)!;

  assert.equal(matchesSearch(analytics, search({ keywords: 'аналитика или дизайн' }), sa), true);
  assert.equal(matchesSearch(marketing, search({ keywords: 'аналитика или маркетинг' }), sm), true);
  assert.equal(matchesSearch(neither, search({ keywords: 'аналитика или маркетинг' }), sn), false);
});

test('обычное слово по-прежнему ищется как текст', () => {
  const parsed = parseKeywords('москва');
  assert.equal(parsed.skills.length, 0);
  assert.deepEqual(parsed.words, ['москва']);
});

// ------------------------------------------------------------------ requirements

/**
 * Регрессия: фильтр подбора не смотрел в `requirements`.
 *
 * Это самое узкое из четырёх определений текста вакансии в проекте:
 * matcher не включал requirements, а ai-matching, resume-targeting и
 * skill-gaps включали. Провайдеры кладут навыки именно туда
 * (`requirementsSection` у greenhouse, `sectionOf(content,"Requirements")`
 * у ashby, теги у remoteok), в `about` у них описание.
 *
 * Итог был такой: одна и та же вакансия попадала в подбор или не попадала в
 * зависимости от того, какая функция её смотрела, а автоотклик отбирался
 * именно по фильтру.
 */
test('навык только в requirements считается найденным (regression)', () => {
  const v = vac({
    title: 'Developer',
    about: 'Team',
    requirements: ['Kafka, ClickHouse', 'Docker'],
  });
  const skills = skillsByVacancy([v]);

  for (const kw of ['kafka', 'clickhouse', 'docker']) {
    assert.equal(
      matchesSearch(v, search({ keywords: kw }), skills.get(v.slug)),
      true,
      `«${kw}» есть в требованиях, но подбор его не увидел`,
    );
  }
});

test('навык в responsibilities тоже учитывается', () => {
  const v = vac({ title: 'Support', about: 'x', responsibilities: ['Kafka'] });
  const skills = skillsByVacancy([v]);
  assert.equal(matchesSearch(v, search({ keywords: 'kafka' }), skills.get(v.slug)), true);
});

test('фильтр и ранжирование теперь согласны насчёт текста вакансии', () => {
  /*
   * Раньше один и тот же отклик мог попасть в выдачу по ранжированию и не
   * попасть по фильтру. Проверяем, что оба смотрят на один текст.
   */
  const v = vac({ title: 'Backend', about: '', requirements: ['Go'] });
  const skills = skillsByVacancy([v]);
  assert.equal(skills.get(v.slug)!.has('Go'), true, 'навык не извлечён из требований');
  assert.equal(matchesSearch(v, search({ keywords: 'go' }), skills.get(v.slug)), true);
});

// ------------------------------------------------------------------------ area

/**
 * Регрессия: `area` получал текст вместо кода.
 *
 * `params.set("area", query.city)` отправлял `area=Москва`. hh отвечает на
 * это 400, `fetchVacancies` возвращал `ok: false`, и `refreshProviders` по
 * этому флагу не писал ни одной вакансии. Автоотклик работает только по
 * `source === "hh"`, то есть у любого, кто задал город, воронка была пуста
 * полностью и без единой ошибки в логах.
 */
test('крупный город превращается в код области hh (regression)', async () => {
  resetAreasCache();
  // Коды сверены с живым GET /areas/113.
  assert.equal(await resolveAreaId('Москва'), 1);
  assert.equal(await resolveAreaId('Санкт-Петербург'), 2);
  assert.equal(await resolveAreaId('спб'), 2, 'аббревиатура должна пониматься');
  assert.equal(await resolveAreaId('МОСКВА'), 1, 'регистр не должен мешать');
  assert.equal(await resolveAreaId('  Казань  '), 88);
  resetAreasCache();
});

test('неизвестный город даёт null, а не мусор', async () => {
  resetAreasCache();
  assert.equal(await resolveAreaId('Вася-город-не-существует'), null);
  assert.equal(await resolveAreaId(''), null);
  assert.equal(await resolveAreaId(null), null);
  assert.equal(await resolveAreaId(undefined), null);
  resetAreasCache();
});

test('несколько городов через запятую берут первый', () => {
  assert.equal(normalizeCity('  Казань ,  Москва '), 'казань , москва');
});

test('ё приравнивается к е — иначе «Омск» нашёлся бы, а «Орел» нет', () => {
  assert.equal(normalizeCity('Орёл'), 'орел');
});
