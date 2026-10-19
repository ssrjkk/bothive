import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRemoteOkVacancy, remoteOkSalaryValues } from '../src/lib/vacancies/remoteok';
import { mapGreenhouseVacancy, parseGreenhouseBoards } from '../src/lib/vacancies/greenhouse';
import { mapCompanyFeedItem, companyFeedsConfigured } from '../src/lib/vacancies/company';

import { mapGeekVacancy } from '../src/lib/vacancies/geekjob';
import { mapJobicyVacancy } from '../src/lib/vacancies/jobicy';
import { mapWwRItem } from '../src/lib/vacancies/weworkremotely';
import { parseSalaryText, unwrapExtended } from '../src/lib/vacancies/util';
import { mapRabotaVacancy } from '../src/lib/vacancies/rabota';

test('mapRemoteOkVacancy мапит валидную вакансию', () => {
  const v = mapRemoteOkVacancy({
    slug: 'senior-frontend-abc',
    id: '1137',
    epoch: 1790438426,
    company: 'Acme Inc',
    position: 'Senior Frontend Engineer',
    tags: ['react', 'remote'],
    location: 'Remote',
    salary_min: 120,
    salary_max: 160,
    apply_url: 'https://remoteok.com/apply/senior-frontend-abc',
    description: '<p>Senior role</p>',
  });
  assert.ok(v);
  assert.equal(v!.slug, 'remoteok-senior-frontend-abc');
  assert.equal(v!.source, 'remoteok');
  assert.equal(v!.level, 'Senior');
  assert.equal(v!.format, 'Удалённо');
  assert.equal(v!.company, 'Acme Inc');
  assert.equal(v!.salary_min, 120);
  assert.equal(v!.salary_max, 160);
  assert.equal(v!.source_url, 'https://remoteok.com/apply/senior-frontend-abc');
});

test('mapRemoteOkVacancy с пустым id/slug даёт null', () => {
  assert.equal(mapRemoteOkVacancy({}), null);
});

test('remoteOkSalaryValues парсит salary объект и примитивы', () => {
  assert.deepEqual(remoteOkSalaryValues({ salary: { min: 50, max: 80 } }), { min: 50, max: 80 });
  assert.deepEqual(remoteOkSalaryValues({ salary_min: 10, salary_max: 20 }), { min: 10, max: 20 });
  assert.deepEqual(
    remoteOkSalaryValues({ salary_min: 10, salary_max: 20, salary: { min: 30, max: 40 } }),
    {
      min: 30,
      max: 40,
    },
  );
  assert.deepEqual(remoteOkSalaryValues({}), { min: null, max: null });
});

test('mapGreenhouseVacancy мапит валидную вакансию', () => {
  const v = mapGreenhouseVacancy({
    id: 8223520,
    title: 'Senior Software Engineer',
    absolute_url: 'https://job-boards.greenhouse.io/mozilla/jobs/8223520',
    location: { name: 'Remote US' },
    first_published: '2026-09-24T14:46:30-04:00',
    company_name: 'Mozilla',
    content: "<p>What you'll do: build things</p><p>Requirements: 5+ years</p>",
  });
  assert.ok(v);
  assert.equal(v!.slug, 'greenhouse-8223520');
  assert.equal(v!.source, 'greenhouse');
  assert.equal(v!.company, 'Mozilla');
  assert.equal(v!.level, 'Senior');
  assert.equal(v!.format, 'Удалённо');
  assert.match(v!.requirements[0]!, /5\+ years/);
});

test('parseGreenhouseBoards отдаёт дефолтный список и парсит env', () => {
  assert.ok(parseGreenhouseBoards().includes('mozilla'));
  const old = process.env.GREENHOUSE_BOARDS;
  process.env.GREENHOUSE_BOARDS =
    'stripe, gitlab.com, https://boards-api.greenhouse.io/v1/boards/netflix';
  try {
    assert.deepEqual(parseGreenhouseBoards(), ['stripe', 'gitlab.com', 'netflix']);
  } finally {
    if (old === undefined) delete process.env.GREENHOUSE_BOARDS;
    else process.env.GREENHOUSE_BOARDS = old;
  }
});

test('mapCompanyFeedItem мапит RSS-элемент', () => {
  const v = mapCompanyFeedItem(
    {
      title: 'Backend Developer (Python)',
      link: 'https://example.com/careers/backend-python',
      description: 'Remote, salary 150 000–200 000 ₽',
      pubDate: 'today',
      company: 'Example',
    },
    'feed-0',
  )!;
  assert.ok(v);
  assert.equal(v.source, 'company');
  assert.equal(v.format, 'Удалённо');
  assert.equal(v.salary_min, 150000);
  assert.equal(v.salary_max, 200000);
  assert.equal(v.company, 'Example');
});

test('companyFeedsConfigured зависит от env', () => {
  const old = process.env.COMPANY_JOB_FEEDS;
  delete process.env.COMPANY_JOB_FEEDS;
  assert.equal(companyFeedsConfigured(), false);
  process.env.COMPANY_JOB_FEEDS = 'https://example.com/feed.xml';
  assert.equal(companyFeedsConfigured(), true);
  if (old === undefined) delete process.env.COMPANY_JOB_FEEDS;
  else process.env.COMPANY_JOB_FEEDS = old;
});

test('parseSalaryText парсит свободную строку зарплаты', () => {
  assert.deepEqual(parseSalaryText('200K — 230K ₽'), {
    display: '200 000–230 000 ₽',
    min: 200000,
    max: 230000,
  });
  assert.deepEqual(parseSalaryText('от 100 000 ₽'), {
    display: 'от 100 000 ₽',
    min: 100000,
    max: null,
  });
  assert.deepEqual(parseSalaryText(''), { display: 'по договорённости', min: null, max: null });
});

test('parseSalaryText определяет валюту из строки', () => {
  assert.deepEqual(parseSalaryText('1 800-2 500 $'), {
    display: '1 800–2 500 $',
    min: 1800,
    max: 2500,
  });
  assert.deepEqual(parseSalaryText('3 500–4 500 $'), {
    display: '3 500–4 500 $',
    min: 3500,
    max: 4500,
  });
  assert.deepEqual(parseSalaryText('от 200€'), { display: 'от 200 €', min: 200, max: null });
});

test('unwrapExtended распаковывает MongoDB extended JSON', () => {
  assert.equal(unwrapExtended({ $numberLong: '1790233146020' }), 1790233146020);
  assert.equal(unwrapExtended({ $date: { $numberLong: '1790233146020' } }), 1790233146020);
  assert.equal(unwrapExtended(42), 42);
  assert.equal(unwrapExtended('x'), 'x');
});

test('mapGeekVacancy мапит валидную вакансию GeekJob', () => {
  const v = mapGeekVacancy({
    id: '6aba2cb443c07940ec0b94b0',
    position: 'Senior Python Developer',
    salary: '200K — 230K ₽',
    company: { name: 'OperAI' },
    jobFormat: { remote: true, relocate: false, parttime: false, inhouse: false },
    log: { modify: '28 сентября' },
  });
  assert.ok(v);
  assert.equal(v!.slug, 'geekjob-6aba2cb443c07940ec0b94b0');
  assert.equal(v!.source, 'geekjob');
  assert.equal(v!.company, 'OperAI');
  assert.equal(v!.level, 'Senior');
  assert.equal(v!.format, 'Удалённо');
  assert.equal(v!.salary_min, 200000);
  assert.equal(v!.salary_max, 230000);
  assert.equal(v!.city, 'Remote');
});

test('mapGeekVacancy с extended-JSON полями не падает', () => {
  const v = mapGeekVacancy({
    id: 'abc123',
    position: 'Junior QA',
    log: { modify: { $date: { $numberLong: '1790233146020' } } },
  });
  assert.ok(v);
  assert.ok(v!.posted);
});

test('mapJobicyVacancy мапит валидную вакансию Jobicy', () => {
  const v = mapJobicyVacancy({
    id: 154138,
    jobTitle: 'Head of GTM',
    companyName: 'Maze',
    jobGeo: 'Europe, USA',
    jobLevel: 'Senior',
    jobType: ['Full-Time'],
    jobIndustry: ['Sales'],
    pubDate: '2026-09-28T08:54:18+00:00',
    salaryMin: 220000,
    salaryMax: 260000,
    salaryCurrency: 'USD',
    url: 'https://jobicy.com/jobs/154138',
  });
  assert.ok(v);
  assert.equal(v!.source, 'jobicy');
  assert.equal(v!.level, 'Senior');
  assert.equal(v!.salary_min, 220000);
  assert.equal(v!.company, 'Maze');
  assert.equal(v!.source_url, 'https://jobicy.com/jobs/154138');
});

test('mapWwRItem мапит RSS-элемент We Work Remotely', () => {
  const v = mapWwRItem({
    title: 'Acme Inc: Senior Designer',
    link: 'https://weworkremotely.com/remote-jobs/acme-senior-designer',
    description: '<p>Design things</p>',
    pubDate: 'Mon, 28 Sep 2026 11:01:08 +0000',
    category: 'Design',
    type: 'Full-Time',
    region: 'Anywhere in the World',
  });
  assert.ok(v);
  assert.equal(v!.source, 'weworkremotely');
  assert.equal(v!.company, 'Acme Inc');
  assert.equal(v!.title, 'Senior Designer');
  assert.equal(v!.format, 'Удалённо');
});

test('geekjob fetchVacancies парсит реальный ответ API', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        page: 1,
        nextpage: 2,
        pagecount: 5,
        documentsCount: 100,
        data: [
          {
            id: { $numberLong: '12345' },
            position: 'Senior Frontend Developer',
            company: { name: 'Tech Corp' },
            salary: '200K — 230K ₽',
            country: 'Россия',
            city: 'Москва',
            jobFormat: { remote: true },
            log: { modify: '28 сентября' },
            link: 'https://geekjob.ru/vacancy/12345',
            published: { $date: { $numberLong: '1790438426000' } },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
  try {
    const { geekjobProvider } = await import('../src/lib/vacancies/geekjob');
    const result = await geekjobProvider.fetchVacancies({ limit: 50 });
    assert.ok(result.ok);
    assert.equal(result.vacancies.length, 1);
    assert.equal(result.vacancies[0]!.title, 'Senior Frontend Developer');
    assert.equal(result.vacancies[0]!.company, 'Tech Corp');
    assert.equal(result.vacancies[0]!.salary, '200 000–230 000 ₽');
    assert.equal(result.vacancies[0]!.format, 'Удалённо');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('jobicy fetchVacancies парсит реальный ответ API', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        jobs: [
          {
            id: 67890,
            url: 'https://jobicy.com/job/67890',
            jobTitle: 'Backend Engineer',
            companyName: 'Startup Inc',
            jobGeo: 'Remote',
            jobLevel: 'Senior',
            jobType: ['Full-Time'],
            jobIndustry: ['Engineering'],
            pubDate: '2026-09-28T10:00:00Z',
            salaryMin: 3000,
            salaryMax: 5000,
            salaryCurrency: 'USD',
            jobExcerpt: 'Build APIs',
            jobDescription: '<p>Build APIs</p>',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
  try {
    const { jobicyProvider } = await import('../src/lib/vacancies/jobicy');
    const result = await jobicyProvider.fetchVacancies({ limit: 50 });
    assert.ok(result.ok);
    assert.equal(result.vacancies.length, 1);
    assert.equal(result.vacancies[0]!.title, 'Backend Engineer');
    assert.equal(result.vacancies[0]!.company, 'Startup Inc');
    assert.equal(result.vacancies[0]!.salary, '$3,000–$5,000');
    assert.equal(result.vacancies[0]!.format, 'Удалённо');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weworkremotely fetchVacancies парсит RSS', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>We Work Remotely</title>
    <item>
      <title>Acme Inc: Senior Designer</title>
      <link>https://weworkremotely.com/remote-jobs/123</link>
      <description>Design products</description>
      <pubDate>Mon, 28 Sep 2026 11:01:08 +0000</pubDate>
      <category>Design</category>
      <type>Full-Time</type>
      <region>Anywhere in the World</region>
    </item>
  </channel>
</rss>`,
      { status: 200, headers: { 'Content-Type': 'application/xml' } },
    )) as typeof fetch;
  try {
    const { weworkremotelyProvider } = await import('../src/lib/vacancies/weworkremotely');
    const result = await weworkremotelyProvider.fetchVacancies({ limit: 50 });
    assert.ok(result.ok);
    assert.equal(result.vacancies.length, 1);
    assert.equal(result.vacancies[0]!.title, 'Senior Designer');
    assert.equal(result.vacancies[0]!.company, 'Acme Inc');
    assert.equal(result.vacancies[0]!.format, 'Удалённо');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mapRabotaVacancy мапит валидную вакансию Работа.ру', () => {
  const v = mapRabotaVacancy(
    {
      '@type': 'JobPosting',
      title: 'Senior Frontend Developer',
      url: 'https://www.rabota.ru/vacancy/12345/',
      hiringOrganization: { name: 'Tech Corp' },
      jobLocation: { address: { addressLocality: 'Москва', addressRegion: 'Москва' } },
      baseSalary: { value: { minValue: 200000, maxValue: 250000 }, currency: 'RUB' },
      datePosted: '2026-09-28T10:00:00+03:00',
      description: '<p>Senior role, remote</p>',
    },
    0,
  );
  assert.ok(v);
  assert.equal(v!.source, 'rabota');
  assert.equal(v!.company, 'Tech Corp');
  assert.equal(v!.level, 'Senior');
  assert.equal(v!.format, 'Удалённо');
  assert.equal(v!.salary_min, 200000);
  assert.equal(v!.salary_max, 250000);
  assert.equal(v!.city, 'Москва');
  assert.ok(v!.source_url!.startsWith('https://www.rabota.ru/vacancy/'));
});

test('mapRabotaVacancy с пустым title/url даёт null', () => {
  assert.equal(mapRabotaVacancy({ '@type': 'Organization' } as never, 0), null);
});

test('rabota fetchVacancies парсит JSON-LD из HTML', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      `<html><head><script type="application/ld+json">[{"@context":"https://schema.org","@type":"JobPosting","title":"Backend Developer","url":"https://www.rabota.ru/vacancy/998/","hiringOrganization":{"name":"Startup Inc"},"jobLocation":{"address":{"addressLocality":"Санкт-Петербург"}},"baseSalary":{"@type":"MonetaryAmount","value":{"minValue":150000,"maxValue":180000,"unitText":"MONTH"},"currency":"RUB"},"datePosted":"2026-09-28T10:00:00+03:00","description":"<p>Python, remote</p>"}]</script></head><body></body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    )) as typeof fetch;
  try {
    const { rabotaProvider } = await import('../src/lib/vacancies/rabota');
    const result = await rabotaProvider.fetchVacancies({ limit: 50 });
    assert.ok(result.ok);
    assert.equal(result.vacancies.length, 1);
    assert.equal(result.vacancies[0]!.title, 'Backend Developer');
    assert.equal(result.vacancies[0]!.company, 'Startup Inc');
    assert.equal(result.vacancies[0]!.salary_min, 150000);
    assert.equal(result.vacancies[0]!.format, 'Удалённо');
    assert.equal(result.vacancies[0]!.city, 'Санкт-Петербург');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
