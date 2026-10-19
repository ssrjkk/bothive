import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { db } from '@/lib/db';
import { getVacancyBySlug } from '@/lib/vacancies';
import { prepareInterview, vacancyBrief } from '@/lib/interview';
import { NO_STORE_HEADERS, parseParamId } from '@/lib/http';

/**
 * Подготовка к собеседованию по отклику.
 *
 * Отдельный маршрут, а не поле в списке откликов: подготовка нужна для
 * одного отклика, а список отдаётся целиком и на каждый. Считать её для
 * каждой строки означало бы прогонять скоринг по резюме десятки раз на
 * страницу — ради одного приглашения, которое человек откроет один раз.
 *
 * Резюме берётся то, что отправлялось в этот отклик (applications.resume_id),
 * а не «последнее обновлённое»: готовиться нужно к тому резюме, которое
 * компания уже видела.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { id: rawId } = await params;
  /*
   * Разбор через общий помощник, а не через Number.
   *
   * Number("") даёт 0 и проходит проверку Number.isFinite, поэтому пустой
   * идентификатор в адресе приводил к запросу за откликом с id = 0 вместо
   * отказа. Number("1e5") и " 1 " тоже проходят. В проекте для этого есть
   * parseParamId, и тридцать шесть роутов из тридцати семи его используют.
   */
  const appId = parseParamId(rawId);
  if (appId === null) {
    return NextResponse.json({ error: 'Некорректный идентификатор отклика' }, { status: 400 });
  }

  const app = db
    .prepare('SELECT job_slug, resume_id FROM applications WHERE id = ? AND user_id = ?')
    .get(appId, user.id) as { job_slug: string; resume_id: string | null } | undefined;

  if (!app) {
    return NextResponse.json({ error: 'Отклик не найден' }, { status: 404 });
  }

  const vacancy = getVacancyBySlug(app.job_slug);
  if (!vacancy) {
    return NextResponse.json(
      { error: 'Вакансия недоступна: возможно, она была удалена с площадки' },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  /*
   * Резюме, отправленное в этом отклике.
   *
   * Ищем по hh_id, а не по id. В applications.resume_id лежит идентификатор
   * резюме на hh — строка, потому что именно её отправляли в POST /negotiations.
   * Локальный resumes.id здесь не подходит: сравнение `id = 'abc'` в SQLite
   * молча не находит ничего, а `id = '123'` — находит, и это хуже: вернётся
   * чужое резюме той же учётной записи, и подготовка к собеседованию будет
   * построена по резюме на другую роль.
   *
   * Если резюме удалили или отвязали — берём последнее: готовиться лучше по
   * чужому резюме, чем не готовиться совсем, но это уже должен быть видимый
   * компромисс, а не случайный.
   */
  const resume = (
    app.resume_id
      ? db
          .prepare('SELECT * FROM resumes WHERE user_id = ? AND hh_id = ?')
          .get(user.id, app.resume_id)
      : undefined
  ) as { title: string; content: string } | undefined;

  const resumeForPrep =
    resume ??
    (db
      .prepare('SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(user.id) as { title: string; content: string } | undefined);

  if (!resumeForPrep) {
    return NextResponse.json(
      { error: 'Сначала добавьте резюме — без него нечего готовить' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  return Response.json(
    {
      prep: prepareInterview(vacancy, resumeForPrep.content, resumeForPrep.title),
      brief: vacancyBrief(vacancy, resumeForPrep.content, resumeForPrep.title),
    },
    { headers: NO_STORE_HEADERS },
  );
}
