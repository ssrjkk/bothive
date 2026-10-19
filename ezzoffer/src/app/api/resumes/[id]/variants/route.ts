import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { parseParamId, NO_STORE_HEADERS } from '@/lib/http';
import { createVariant, getResumeForUser, compareVariants } from '@/lib/resume-variants';

/**
 * GET /api/resumes/[id]/variants — группа вариантов и честное сравнение.
 *
 * Резюме, которое никто не вариантировал, само себе группа не нужда: у него
 * variant_group = NULL, и сравнивать не с чем. Такой ответ — пустой, а не
 * 404: резюме существует, вариантов у него просто нет.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { id: rawId } = await ctx.params;
  const id = parseParamId(rawId);
  if (id === null) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

  const resume = getResumeForUser(user.id, id);
  if (!resume) return NextResponse.json({ error: 'Резюме не найдено' }, { status: 404 });

  if (!resume.variant_group) {
    return Response.json(
      { group: null, variants: [], comparison: null },
      { headers: NO_STORE_HEADERS },
    );
  }

  const comparison = compareVariants(user.id, resume.variant_group);
  return Response.json(
    { group: resume.variant_group, variants: comparison.variants, comparison },
    { headers: NO_STORE_HEADERS },
  );
}

/**
 * POST /api/resumes/[id]/variants — создать редакцию «B» из «A».
 *
 * Идиом общий: requireUser → parseParamId → владение внутри createVariant.
 * Владение проверяется в домене, а не здесь, чтобы прямые вызовы функции из
 * бота и из роута проверяли одно и то же место.
 *
 * Ответ 404 отдаётся одинаковый для чужого и несуществующего резюме: иначе
 * инвариант I3 «чужой ресурс неотличим от несуществующего» перестаёт держаться.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { id: rawId } = await ctx.params;
  const id = parseParamId(rawId);
  if (id === null) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

  const variant = createVariant(user.id, id);
  if (!variant) {
    return NextResponse.json({ error: 'Резюме не найдено' }, { status: 404 });
  }

  return Response.json({ resume: variant }, { status: 201, headers: NO_STORE_HEADERS });
}
