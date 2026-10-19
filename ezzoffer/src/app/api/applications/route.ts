import { NextResponse } from 'next/server';
import { requireUser, unauthorized, readJson } from '@/lib/api';
import { db, type User } from '@/lib/db';
import { isPlanActive, planDailyLimit } from '@/lib/plans';
import { listApplications, serializeApplication, type ApplicationRow } from '@/lib/applications';
import { getVacancyBySlug } from '@/lib/vacancies';
import { sanitizeExternalUrl } from '@/lib/vacancies/util';
import { hhProvider } from '@/lib/vacancies/hh';
import { getValidHhToken } from '@/lib/hh-oauth';
import { personalizeLetter } from '@/lib/cover-letter';
import { DEMO_MODE_MESSAGE, isLiveMode } from '@/lib/user-mode';
import { NO_STORE_HEADERS } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';
import { rankLettersForVacancy } from '@/lib/ai-matching';

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get('limit') ?? 200);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.floor(rawLimit)), 200) : 200;
  return Response.json(
    { applications: listApplications(user.id, limit) },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  // Отклик на hh.ru уходит во внешний API и расходует квоту платформы.
  // Дневной лимит тарифа проверяется ниже по счётчику в БД, но при параллельных
  // запросах несколько проверок успевают пройти до записи. Этот лимит закрывает
  // окно гонки и не даёт перебирать вакансии пачками.
  const limiter = rateLimit(`apply:${user.id}`, { windowMs: 60 * 1000, max: 10 });
  if (!limiter.allowed) {
    return NextResponse.json(
      { error: 'Слишком много откликов подряд. Подождите минуту.' },
      { status: 429, headers: { 'Retry-After': String(limiter.retryAfterSeconds) } },
    );
  }

  const { data, error } = await readJson<{
    jobSlug?: string;
    searchId?: number | null;
    resumeId?: number | null;
    letterId?: number | null;
    externalUrl?: string | null;
  }>(request);
  if (error) return error;

  const vacancy = getVacancyBySlug(data?.jobSlug ?? '');
  if (!vacancy) return NextResponse.json({ error: 'Вакансия не найдена' }, { status: 404 });

  // Ссылка на отклик приходит от пользователя и рендерится как href. Без проверки
  // схемы в БД попадал бы любой протокол (javascript:, data:), то есть клик по
  // «ссылка на отклик» выполнил бы произвольный скрипт.
  const externalUrl = sanitizeExternalUrl(data?.externalUrl);
  if (data?.externalUrl && !externalUrl) {
    return NextResponse.json({ error: 'Ссылка должна быть http(s)-адресом' }, { status: 400 });
  }

  if (data?.searchId != null) {
    const owned = db
      .prepare('SELECT id FROM searches WHERE id = ? AND user_id = ?')
      .get(data.searchId, user.id);
    if (!owned) return NextResponse.json({ error: 'Поиск не найден' }, { status: 404 });
  }
  if (data?.resumeId != null) {
    const owned = db
      .prepare('SELECT id FROM resumes WHERE id = ? AND user_id = ?')
      .get(data.resumeId, user.id);
    if (!owned) return NextResponse.json({ error: 'Резюме не найдено' }, { status: 404 });
  }
  if (data?.letterId != null) {
    const owned = db
      .prepare('SELECT id FROM letters WHERE id = ? AND user_id = ?')
      .get(data.letterId, user.id);
    if (!owned) return NextResponse.json({ error: 'Письмо не найдено' }, { status: 404 });
  }

  if (!isPlanActive(user)) {
    return NextResponse.json(
      { error: 'Сначала активируйте пробный период или тариф' },
      { status: 403 },
    );
  }

  const limit = planDailyLimit(user.plan);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND sent_at >= ? AND withdrawn = 0',
      )
      .get(user.id, todayStart.getTime()) as { c: number }
  ).c;
  if (limit > 0 && todayCount >= limit) {
    return NextResponse.json(
      { error: `Достигнут дневной лимит откликов (${limit}). Обновите тариф.` },
      { status: 429 },
    );
  }

  const existing = db
    .prepare('SELECT id FROM applications WHERE user_id = ? AND job_slug = ? AND withdrawn = 0')
    .get(user.id, vacancy.slug);
  if (existing) {
    return NextResponse.json({ error: 'Вы уже откликались на эту вакансию' }, { status: 409 });
  }

  /*
    Резюме выбирается ОДИН раз, и из него берутся и текст письма, и
    идентификатор, который уйдёт в hh.

    Здесь были две поломки, обе про то, что уходит на площадку, не то, что
    человек выбрал:

    1. В `applications.resume_id` записывался ЛОКАЛЬНЫЙ `resumes.id`, а
       автоотклик писал туда же ИДЕНТИФИКАТОР hh (autoapply.ts). Колонка
       объявлена TEXT и объявлена как «идентификатор резюме на hh»
       (applications.ts), но держала два разных вида значений. Читатель
       `api/applications/[id]/interview` искал по `resumes.hh_id = ?`, то
       есть для ручных откликов сравнивал hh-id с локальным числом. Не
       находил — и откатывался на «последнее обновлённое» резюме. Если у
       человека было резюме с числовым hh-id, совпавшим с чужим локальным
       id, подготовка к собеседованию строилась по ЧУЖОМУ резюме.

    2. Отправлялся всё равно `users.hh_resume_id` (строка ниже), то есть
       выбранное резюме игнорировалось: человек отметил в кабинете резюме
       под фронтенд, а отклик ушёл с тем, что привязано на уровне аккаунта.

    Теперь выбор один, и его результат — и для письма, и для отправки, и для
    записи в историю. Резюме без привязки к hh отправить нельзя: площадка
    принимает только свой идентификатор. В этом случае берётся общее
    `hh_resume_id`, как это уже делает автоотклик.
  */
  const resumeRow =
    data?.resumeId != null
      ? (db
          .prepare('SELECT id, hh_id, content, title FROM resumes WHERE id = ? AND user_id = ?')
          .get(data.resumeId, user.id) as
          { id: number; hh_id: string | null; content: string; title: string } | undefined)
      : (db
          .prepare(
            'SELECT id, hh_id, content, title FROM resumes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
          )
          .get(user.id) as
          { id: number; hh_id: string | null; content: string; title: string } | undefined);
  const resumeContent = resumeRow?.content ?? '';

  const letters = db
    .prepare('SELECT id, content FROM letters WHERE user_id = ? ORDER BY updated_at DESC')
    .all(user.id) as { id: number; content: string }[];

  // Письмо выбирается один раз: явный выбор пользователя, иначе лучшее по
  // совпадению навыков с вакансией. Персонализация — один вызов, а не по одному
  // на каждое письмо (каждый вызов может ходить в LLM).
  let selectedLetterId: number | null = data?.letterId ?? null;
  if (selectedLetterId != null && !letters.some((l) => l.id === selectedLetterId)) {
    selectedLetterId = null;
  }
  if (selectedLetterId == null && letters.length > 0) {
    selectedLetterId = rankLettersForVacancy(letters, vacancy)[0].id;
  }

  let message = '';
  const template = letters.find((l) => l.id === selectedLetterId)?.content ?? '';
  if (selectedLetterId != null || resumeContent) {
    message = (await personalizeLetter(template, vacancy, resumeContent)).content;
  }

  const now = Date.now();

  // Реальная отправка на hh.ru: если вакансия с hh.ru и аккаунт подключён —
  // отклик уходит через API, и только при успехе записывается в кабинет.
  // origin различает их: 'real' — площадка приняла отклик, 'user' — человек
  // зафиксировал отклик, сделанный на сайте источника вручную.
  const origin = vacancy.source === 'hh' ? 'real' : 'user';
  /*
   * Идентификатор резюме на hh для этого отклика.
   *
   * Объявлен здесь, а не внутри ветки hh, потому что он пишется в
   * applications.resume_id в обоих случаях: для вакансий не-hh человек
   * зафиксировал отклик вручную, но какое резюме он при этом использовал,
   * мы знаем, и history обязана это показать.
   */
  let hhResumeId: string | null = (resumeRow?.hh_id ?? '').trim() || null;
  if (vacancy.source === 'hh') {
    // Актуальное состояние подключения читаем из БД, а не из объекта сессии.
    // Отсутствие строки означает недействительную сессию — отвечаем 401,
    // а не роняем запрос TypeError'ом на fresh.hh_resume_id.
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as User | undefined;
    if (!fresh) return unauthorized();

    /*
     * Демо-режим останавливает отклик по вакансии hh.ru.
     *
     * Проверка стоит здесь, а не в планировщике: этот путь вызывается человеком
     * по кнопке, и раньше именно здесь он проходил мимо режима. Человек видел
     * в кабинете баннер «Демо-режим», нажимал «Откликнуться» — и отклик уходил
     * от его имени на hh.
     *
     * Порядок не важен для безопасности (режим проверяется до сетевого вызова),
     * но важен для внятности: человек должен получить объяснение, а не 404
     * «вакансия недоступна» или ошибку подключения hh.
     */
    if (!isLiveMode(fresh)) {
      return NextResponse.json({ error: DEMO_MODE_MESSAGE }, { status: 403 });
    }

    /*
      Идентификатор резюме для hh.

      Приоритет у выбранного резюме: человек отметил в кабинете конкретное
      под конкретную вакансию, и отправлять другое — значит врать ему в
      истории откликов. Если выбранное резюме не привязано к hh, отправить
      его нельзя (площадка принимает только свой идентификатор) — тогда
      берётся общее `users.hh_resume_id`, как это уже делает автоотклик
      (`autoapply.ts`, `fallbackResumeId`).

      Раньше здесь стояло безусловно `fresh.hh_resume_id`, то есть выбор
      человека просто не участвовал. Именно это AUDIT.md называл в пункте 8
      («подбор идёт по одному резюме, а уходит другое») — для автоотклика
      исправили, а для кнопки в кабинете нет.
    */
    if (!hhResumeId) {
      // Выбранное резюме не привязано к hh — берём общее из аккаунта.
      hhResumeId = fresh.hh_resume_id?.trim() || null;
    }
    if (!hhResumeId) {
      return NextResponse.json(
        {
          error:
            'Для отклика на вакансию hh.ru подключите аккаунт hh.ru в разделе «Настройки» (нужно резюме на hh.ru).',
        },
        { status: 400 },
      );
    }
    const valid = await getValidHhToken(fresh);
    if (!valid) {
      return NextResponse.json(
        { error: 'Подключение к hh.ru истекло. Переподключите аккаунт в «Настройках».' },
        { status: 401 },
      );
    }
    if (!hhProvider.apply) {
      return NextResponse.json({ error: 'Отклики на hh.ru недоступны' }, { status: 502 });
    }
    const sent = await hhProvider.apply(vacancy, {
      resumeId: hhResumeId,
      message: message || undefined,
      accessToken: valid.token,
    });
    if (!sent.ok) {
      return NextResponse.json(
        { error: `hh.ru отклонил отклик: ${sent.error ?? 'неизвестная ошибка'}` },
        { status: 502 },
      );
    }
  }

  const result = db
    .prepare(
      `INSERT INTO applications (user_id, job_slug, search_id, resume_id, letter_id, status, origin, message, external_url, sent_at)
       VALUES (?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?)`,
    )
    // Пишется именно selectedLetterId, а не переданный data.letterId.
    // Раньше туда уходил letterId из запроса, который для автоподбора всегда
    // null: в кабинете отклик показывался без письма, хотя в hh.ru уходило
    // персонализированное, и статистика «каким письмом откликнулись» была
    // бессмысленной.
    //
    // resume_id — ТОТ ЖЕ идентификатор, что ушёл в hh (hhResumeId), а не
    // локальный resumes.id. Раньше сюда писалось локальное число, тогда как
    // автоотклик писал hh-id, и колонка держала два разных вида значений.
    .run(
      user.id,
      vacancy.slug,
      data?.searchId ?? null,
      hhResumeId ?? null,
      selectedLetterId,
      origin,
      message,
      externalUrl,
      now,
    );
  const row = db
    .prepare('SELECT * FROM applications WHERE id = ?')
    .get(result.lastInsertRowid) as ApplicationRow;
  return Response.json(
    { application: serializeApplication(row) },
    { status: 201, headers: NO_STORE_HEADERS },
  );
}
