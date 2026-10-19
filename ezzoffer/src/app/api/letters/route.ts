import { NextResponse } from 'next/server';
import { requireUser, unauthorized, readJson } from '@/lib/api';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http';

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();
  const rows = db
    .prepare('SELECT * FROM letters WHERE user_id = ? ORDER BY updated_at DESC')
    .all(user.id);
  return Response.json({ letters: rows }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const { data, error } = await readJson<{ title?: string; content?: string }>(request);
  if (error) return error;
  if (!data?.title?.trim() || !data?.content?.trim()) {
    return NextResponse.json({ error: 'Укажите название и текст письма' }, { status: 400 });
  }
  const now = Date.now();
  const result = db
    .prepare(
      'INSERT INTO letters (user_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(user.id, data.title.trim().slice(0, 100), data.content.trim().slice(0, 20000), now, now);
  const row = db.prepare('SELECT * FROM letters WHERE id = ?').get(result.lastInsertRowid);
  return Response.json({ letter: row }, { status: 201 });
}
