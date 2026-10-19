import { NextResponse } from 'next/server';
import { requireUser, unauthorized, readJson } from '@/lib/api';
import { db } from '@/lib/db';
import { parseParamId, NO_STORE_HEADERS } from '@/lib/http';
import { resumeMatch } from '@/lib/employer-dictionary';

/**
 * POST /api/resumes/[id]/match — разрыв между резюме и текстом вакансии.
 *
 * Вход: текст вакансии от самого человека. Не slug каталога: список
 * требований строится из того описания, на которое человек реально
 * откликается, а вакансий с одним и тем же текстом в каталоге много.
 *
 * Идиом общий: requireUser → parseParamId → владение → readJson.
 *
 * Ответ 404 одинаков для чужого и несуществующего резюме (инвариант I3).
 *
 * Ограничение длины входа — 20 000 символов: это описание вакансии, а не
 * документ. Без предела один запрос может утащить мегабайт текста и
 * разбирать его впустую.
 */
const MAX_VACANCY_CHARS = 20_000;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { id: rawId } = await ctx.params;
  const id = parseParamId(rawId);
  if (id === null) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

  const resume = db
    .prepare('SELECT content FROM resumes WHERE id = ? AND user_id = ?')
    .get(id, user.id) as { content: string } | undefined;
  if (!resume) return NextResponse.json({ error: 'Резюме не найдено' }, { status: 404 });

  const { data, error } = await readJson<{ vacancy?: string }>(request);
  if (error) return error;

  const vacancy = (data?.vacancy ?? '').trim().slice(0, MAX_VACANCY_CHARS);
  if (!vacancy) {
    return NextResponse.json(
      { error: 'Вставьте текст вакансии — без него нечего сравнивать' },
      { status: 400 },
    );
  }

  const match = resumeMatch(resume.content, vacancy);
  return Response.json({ match }, { headers: NO_STORE_HEADERS });
}
