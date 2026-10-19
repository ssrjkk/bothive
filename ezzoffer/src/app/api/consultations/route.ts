import { NextResponse } from 'next/server';
import { requireUser, unauthorized, readJson } from '@/lib/api';
import { db } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { NO_STORE_HEADERS } from '@/lib/http';

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();
  const rows = db
    .prepare('SELECT * FROM consultations WHERE user_id = ? ORDER BY booked_at DESC')
    .all(user.id);
  return Response.json({ consultations: rows }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const limiter = rateLimit(`consultations:${user.id}`, { windowMs: 60 * 60 * 1000, max: 5 });
  if (!limiter.allowed) {
    return NextResponse.json(
      { error: 'Слишком много заявок. Попробуйте позже.' },
      { status: 429, headers: { 'Retry-After': String(limiter.retryAfterSeconds) } },
    );
  }

  const { data, error } = await readJson<{ theme?: string; note?: string }>(request);
  if (error) return error;
  if (!data?.theme?.trim()) {
    return NextResponse.json({ error: 'Выберите тему консультации' }, { status: 400 });
  }
  const result = db
    .prepare('INSERT INTO consultations (user_id, theme, note, booked_at) VALUES (?, ?, ?, ?)')
    .run(
      user.id,
      data.theme.trim().slice(0, 120),
      (data.note ?? '').trim().slice(0, 2000),
      Date.now(),
    );
  const row = db.prepare('SELECT * FROM consultations WHERE id = ?').get(result.lastInsertRowid);
  return Response.json({ consultation: row }, { status: 201 });
}
