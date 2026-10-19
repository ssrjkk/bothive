import { NextResponse } from 'next/server';
import { requireUser, unauthorized, readJson } from '@/lib/api';
import { db } from '@/lib/db';
import { getVacancyBySlug } from '@/lib/vacancies';
import { NO_STORE_HEADERS } from '@/lib/http';

/**
 * Избранные вакансии.
 *
 * Недостающая вещь, без которой воронка рвётся: человек видит хорошую
 * вакансию вечером, вспоминает про неё утром — а каталог к тому моменту
 * обновился, и вакансия ушла из выдачи. Без закладки он её теряет.
 *
 * Намеренно хранится slug, а не копия вакансии. Копия разъехалась бы с
 * оригиналом: изменилась зарплата или компания закрылась, а в избранном лежит
 * старый текст, который выглядит как актуальный. Ссылка честнее: открыли —
 * увидели, что там сейчас.
 */

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const rows = db
    .prepare(
      'SELECT job_slug, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC',
    )
    .all(user.id) as { job_slug: string; created_at: number }[];

  const bookmarks = rows.map((r) => {
    const vacancy = getVacancyBySlug(r.job_slug);
    return {
      slug: r.job_slug,
      createdAt: r.created_at,
      // Вакансия могла исчезнуть из каталога — тогда показываем это прямо,
      // а не пустую карточку и не «откликнитесь», который никуда не ведёт.
      available: Boolean(vacancy),
      title: vacancy?.title ?? null,
      company: vacancy?.company ?? null,
      salary: vacancy?.salary ?? null,
      city: vacancy?.city ?? null,
      sourceUrl: vacancy?.source_url ?? null,
      publishedAt: vacancy?.published_at ?? null,
    };
  });

  return Response.json({ bookmarks }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await readJson<{ slug?: string }>(request);
  if (error) return error;

  const slug = (data?.slug ?? '').trim();
  if (!slug) return NextResponse.json({ error: 'Не указана вакансия' }, { status: 400 });

  // Привязка только к существующей вакансии: иначе в избранном копились бы
  // пустые записи от битых ссылок, и человек не смог бы их объяснить.
  if (!getVacancyBySlug(slug)) {
    return NextResponse.json({ error: 'Вакансия не найдена' }, { status: 404 });
  }

  db.prepare(
    'INSERT OR IGNORE INTO bookmarks (user_id, job_slug, created_at) VALUES (?, ?, ?)',
  ).run(user.id, slug, Date.now());

  return Response.json({ ok: true, slug }, { headers: NO_STORE_HEADERS });
}

export async function DELETE(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await readJson<{ slug?: string }>(request);
  if (error) return error;

  const slug = (data?.slug ?? '').trim();
  if (!slug) return NextResponse.json({ error: 'Не указана вакансия' }, { status: 400 });

  // user_id в условии обязателен: без него удаление сняло бы чужую закладку.
  db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND job_slug = ?').run(user.id, slug);

  return Response.json({ ok: true, slug }, { headers: NO_STORE_HEADERS });
}
