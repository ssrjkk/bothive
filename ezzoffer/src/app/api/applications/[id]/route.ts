import { NextResponse } from 'next/server';
import { requireUser, unauthorized, readJson } from '@/lib/api';
import { db } from '@/lib/db';
import { parseParamId } from '@/lib/http';
import { sanitizeExternalUrl } from '@/lib/vacancies/util';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const { id: rawId } = await ctx.params;
  const id = parseParamId(rawId);
  if (id === null) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

  const { data, error } = await readJson<{
    externalUrl?: string | null;
    markExternal?: boolean;
  }>(request);
  if (error) return error;

  const existing = db
    .prepare('SELECT id FROM applications WHERE id = ? AND user_id = ?')
    .get(id, user.id);
  if (!existing) return NextResponse.json({ error: 'Отклик не найден' }, { status: 404 });

  const markExternal = data?.markExternal === true;

  // Ссылка рендерится как href — принимаем только http(s), иначе в БД попадёт
  // javascript:/data: и клик по ссылке выполнит скрипт.
  let externalUrl: string | null | undefined;
  if (data?.externalUrl !== undefined) {
    externalUrl = sanitizeExternalUrl(data.externalUrl);
    if (data.externalUrl && !externalUrl) {
      return NextResponse.json({ error: 'Ссылка должна быть http(s)-адресом' }, { status: 400 });
    }
  }

  if (externalUrl !== undefined || markExternal) {
    db.prepare(
      "UPDATE applications SET external_url = ?, status = CASE WHEN ? THEN 'sent' ELSE status END WHERE id = ? AND user_id = ?",
    ).run(externalUrl ?? null, markExternal ? 1 : 0, id, user.id);
  }

  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const { id: rawId } = await ctx.params;
  const id = parseParamId(rawId);
  if (id === null) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });
  const result = db
    .prepare('UPDATE applications SET withdrawn = 1 WHERE id = ? AND user_id = ?')
    .run(id, user.id);
  if (result.changes === 0) {
    return NextResponse.json({ error: 'Отклик не найден' }, { status: 404 });
  }
  return Response.json({ ok: true });
}
