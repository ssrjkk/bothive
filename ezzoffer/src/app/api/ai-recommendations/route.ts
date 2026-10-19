import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { db } from '@/lib/db';
import { getCatalog } from '@/lib/vacancies';
import { rankVacanciesForResume, getRecommendations } from '@/lib/ai-matching';
import { NO_STORE_HEADERS } from '@/lib/http';

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const resume = db
    .prepare(
      'SELECT content, title FROM resumes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
    )
    .get(user.id) as { content: string; title: string } | undefined;

  if (!resume) {
    return NextResponse.json({ error: 'Сначала создайте резюме' }, { status: 400 });
  }

  const vacancies = getCatalog();

  /*
   * Зарплатные ожидания берём из профиля.
   *
   * Раньше зарплата в оценку не входила вообще, хотя именно по ней человек
   * решает, стоит ли отклик: одна и та же вакансия на 80к и на 250к — это
   * разные предложения. Профиль — единственное место, где пользователь
   * мог назвать ожидания; если их нет, зарплатный фактор остаётся нейтральным
   * (отсутствие цифры — не «зарплата плохая»).
   */
  const profile = db.prepare('SELECT salary_expectation FROM users WHERE id = ?').get(user.id) as
    { salary_expectation: number | null } | undefined;

  const ranked = rankVacanciesForResume(
    vacancies,
    resume.content,
    resume.title,
    profile?.salary_expectation ?? null,
  );
  const recommendations = getRecommendations(resume.content, resume.title, ranked);

  return NextResponse.json(
    {
      recommendations,
      topVacancies: ranked.slice(0, 5).map((r) => ({
        slug: r.vacancy.slug,
        title: r.vacancy.title,
        company: r.vacancy.company,
        salary: r.vacancy.salary,
        score: r.score,
        matchedSkills: r.matchedSkills,
        missingSkills: r.missingSkills,
        /*
         * Разбор оценки. Число «72 из 100» без объяснения не вызывает
         * доверия: пользователь не понимает, что с ним не так и что исправить.
         * Факторы отдаются наружу, чтобы показать в кабинете.
         */
        factors: r.factors,
      })),
    },
    { headers: NO_STORE_HEADERS },
  );
}
