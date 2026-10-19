import { NextResponse } from 'next/server';
import {
  requireUser,
  unauthorized,
  readJson,
  toPositiveNumber,
  validateSalaryRange,
  badRequest,
} from '@/lib/api';
import { db } from '@/lib/db';
import { matchCount, type SearchRow } from '@/lib/matcher';
import { parseParamId } from '@/lib/http';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const { id: rawId } = await ctx.params;
  const id = parseParamId(rawId);
  if (id === null) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });
  const existing = db
    .prepare('SELECT * FROM searches WHERE id = ? AND user_id = ?')
    .get(id, user.id) as SearchRow | undefined;
  if (!existing) return NextResponse.json({ error: 'Поиск не найден' }, { status: 404 });

  const { data, error } = await readJson<{
    title?: string;
    keywords?: string;
    salary_min?: number | null;
    salary_max?: number | null;
    format?: string;
    city?: string;
    level?: string;
    company_blacklist?: string;
    active?: boolean;
  }>(request);
  if (error) return error;

  /*
   * Владение проверяется в самой записи, а не только SELECT'ом выше: см.
   * api/letters/[id]/route.ts — там же разбор, почему проверка «сначала
   * прочитать, потом записать» недостаточна как единственная защита.
   */
  if (typeof data?.active === 'boolean') {
    db.prepare('UPDATE searches SET active = ?, started_at = ? WHERE id = ? AND user_id = ?').run(
      data.active ? 1 : 0,
      data.active ? (existing.started_at ?? Date.now()) : null,
      id,
      user.id,
    );
  } else {
    const clamp = (v: unknown, max: number) =>
      typeof v === 'string'
        ? v.trim().slice(0, max)
        : String(v ?? '')
            .trim()
            .slice(0, max);
    const salaryMin =
      data?.salary_min !== undefined ? toPositiveNumber(data.salary_min) : existing.salary_min;
    const salaryMax =
      data?.salary_max !== undefined ? toPositiveNumber(data.salary_max) : existing.salary_max;
    const rangeError = validateSalaryRange(salaryMin, salaryMax);
    if (rangeError) return badRequest(rangeError);
    db.prepare(
      `UPDATE searches SET title = ?, keywords = ?, salary_min = ?, salary_max = ?, format = ?, city = ?, level = ?, company_blacklist = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      clamp(data?.title ?? existing.title, 100),
      clamp(data?.keywords ?? existing.keywords, 400),
      salaryMin,
      salaryMax,
      clamp(data?.format ?? existing.format, 20),
      clamp(data?.city ?? existing.city, 60),
      clamp(data?.level ?? existing.level, 20),
      clamp(data?.company_blacklist ?? existing.company_blacklist, 400),
      id,
      user.id,
    );
  }

  const row = db.prepare('SELECT * FROM searches WHERE id = ?').get(id) as SearchRow;
  return Response.json({ search: { ...row, match_count: matchCount(row) } });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const { id: rawId } = await ctx.params;
  const id = parseParamId(rawId);
  if (id === null) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });
  const result = db.prepare('DELETE FROM searches WHERE id = ? AND user_id = ?').run(id, user.id);
  if (result.changes === 0) return NextResponse.json({ error: 'Поиск не найден' }, { status: 404 });
  return Response.json({ ok: true });
}
