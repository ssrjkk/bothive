import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { getVacancyBySlug } from '@/lib/vacancies';
import { BookmarksList } from '@/components/dashboard/bookmarks-list';

export const metadata: Metadata = { title: 'Избранное' };
export const dynamic = 'force-dynamic';

type BookmarkRow = {
  job_slug: string;
  created_at: number;
};

export default async function BookmarksPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  /*
   * Данные собираются на сервере, а не отдельным запросом из браузера: список
   * нужен сразу при открытии, и мигающая пустая страница выглядела бы как
   * «избранное пропало».
   */
  const rows = db
    .prepare(
      'SELECT job_slug, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC',
    )
    .all(user.id) as BookmarkRow[];

  const bookmarks = rows.map((r) => {
    const v = getVacancyBySlug(r.job_slug);
    return {
      slug: r.job_slug,
      createdAt: r.created_at,
      available: Boolean(v),
      title: v?.title ?? null,
      company: v?.company ?? null,
      salary: v?.salary ?? null,
      city: v?.city ?? null,
      sourceUrl: v?.source_url ?? null,
      publishedAt: v?.published_at ?? null,
    };
  });

  return (
    <div>
      <h1 className="font-serif text-2xl leading-snug text-ink">Избранное</h1>
      <p className="mt-1 text-sm text-muted">
        Вакансии, которые вы отложили. Каталог обновляется каждые полчаса, поэтому хорошую вакансию
        стоит сохранить — иначе она уйдёт из подбора.
      </p>
      <div className="mt-6">
        <BookmarksList bookmarks={bookmarks} />
      </div>
    </div>
  );
}
