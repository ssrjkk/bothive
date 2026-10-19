import { NextResponse } from 'next/server';
import { requireUser, unauthorized, readJson } from '@/lib/api';
import { db } from '@/lib/db';
import { parseParamId } from '@/lib/http';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const { id: rawId } = await ctx.params;
  const id = parseParamId(rawId);
  if (id === null) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

  const existing = db
    .prepare('SELECT * FROM resumes WHERE id = ? AND user_id = ?')
    .get(id, user.id) as { id: number } | undefined;
  if (!existing) return NextResponse.json({ error: 'Резюме не найдено' }, { status: 404 });

  const { data, error } = await readJson<{ title?: string; content?: string; yearsLabel?: string }>(
    request,
  );
  if (error) return error;

  const title = (data?.title ?? '').trim().slice(0, 100);
  const content = (data?.content ?? '').trim().slice(0, 20000);
  if (!title || !content) {
    return NextResponse.json({ error: 'Укажите название и текст резюме' }, { status: 400 });
  }
  const yearsLabel = (data?.yearsLabel ?? '').trim().slice(0, 60);

  // Владение проверяется в самой записи, а не только SELECT'ом выше: см.
  // api/letters/[id]/route.ts — там же разбор, почему проверка «сначала
  // прочитать, потом записать» недостаточна как единственная защита.
  const updated = db
    .prepare(
      `UPDATE resumes SET title = ?, content = ?, years_label = ?, ai_improved = 0, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(title, content, yearsLabel, Date.now(), id, user.id);
  if (updated.changes === 0) {
    return NextResponse.json({ error: 'Резюме не найдено' }, { status: 404 });
  }

  const row = db.prepare('SELECT * FROM resumes WHERE id = ?').get(id);
  return Response.json({ resume: row });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const { id: rawId } = await ctx.params;
  const id = parseParamId(rawId);
  if (id === null) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

  const result = db.prepare('DELETE FROM resumes WHERE id = ? AND user_id = ?').run(id, user.id);
  if (result.changes === 0) {
    return NextResponse.json({ error: 'Резюме не найдено' }, { status: 404 });
  }
  return Response.json({ ok: true });
}
