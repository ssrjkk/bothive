import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { hhConfigured, hhAuthUrl, generateOauthState } from '@/lib/hh-oauth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http';

// Старт OAuth-подключения к hh.ru
export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  if (!hhConfigured()) {
    return NextResponse.json(
      { error: 'Подключение к hh.ru не настроено на сервере' },
      { status: 503 },
    );
  }

  const state = generateOauthState();
  const expires = Date.now() + 15 * 60 * 1000;
  db.prepare('INSERT INTO oauth_states (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    state,
    user.id,
    expires,
  );

  return NextResponse.json({ url: hhAuthUrl(state) }, { headers: NO_STORE_HEADERS });
}
