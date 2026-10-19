import { NextResponse } from 'next/server';
import { requireUser, unauthorized, readJson } from '@/lib/api';
import { db, type User } from '@/lib/db';
import { isHhConnected } from '@/lib/hh-oauth';
import { NO_STORE_HEADERS } from '@/lib/http';

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();
  const fresh = db.prepare('SELECT mode FROM users WHERE id = ?').get(user.id) as
    { mode: string } | undefined;
  if (!fresh) return unauthorized();
  return Response.json({ mode: fresh.mode }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { data, error } = await readJson<{ mode?: string }>(request);
  if (error) return error;
  const wanted = data?.mode;
  if (wanted !== 'demo' && wanted !== 'live') {
    return NextResponse.json({ error: 'Режим должен быть demo или live' }, { status: 400 });
  }

  /*
   * live включается только с подключённым hh и только явным действием.
   * Само подключение (OAuth-колбэк) режим не меняет: saveHhConnection
   * колонку mode не трогает. Без площадки live невозможен — иначе кабинет
   * показывал бы «живые» цифры, которым не на чем жить.
   */
  if (wanted === 'live') {
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as User | undefined;
    if (!fresh) return unauthorized();
    if (!isHhConnected(fresh)) {
      return NextResponse.json(
        { error: 'Сначала подключите аккаунт hh.ru в разделе «Настройки»' },
        { status: 400 },
      );
    }
  }

  db.prepare('UPDATE users SET mode = ? WHERE id = ?').run(wanted, user.id);
  return Response.json({ mode: wanted }, { headers: NO_STORE_HEADERS });
}
