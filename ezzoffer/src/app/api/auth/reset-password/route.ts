import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { readJson, badRequest } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';

/**
 * Завершение сброса пароля по одноразовому токену из письма.
 *
 * Токен хранится в users.password_reset_token и гасится сразу после успешной
 * смены, поэтому ссылка из письма нельзя использовать повторно. Лимит привязан
 * к префиксу токена, а не к IP: перебор 32-байтного токена бессмысленен, но
 * ограничение защищает от лавины запросов к дорогостоящему хешированию и
 * работает независимо от TRUST_PROXY.
 */

const MAX_ATTEMPTS = { windowMs: 15 * 60 * 1000, max: 20 };

export async function POST(request: Request) {
  const { data, error } = await readJson<{ token?: string; password?: string }>(request);
  if (error) return error;

  const token = (data?.token ?? '').trim();
  const password = data?.password ?? '';

  if (!/^[0-9a-f]{64}$/.test(token)) {
    return badRequest('Некорректная ссылка восстановления');
  }
  if (password.length < 8 || password.length > 100) {
    return badRequest('Пароль должен быть от 8 до 100 символов');
  }

  const limiter = rateLimit(`reset-apply:${token.slice(0, 16)}`, MAX_ATTEMPTS);
  if (!limiter.allowed) {
    return NextResponse.json(
      { error: 'Слишком много попыток. Попробуйте позже.' },
      { status: 429, headers: { 'Retry-After': String(limiter.retryAfterSeconds) } },
    );
  }

  const user = db
    .prepare('SELECT id FROM users WHERE password_reset_token = ? AND password_reset_expires > ?')
    .get(token, Date.now()) as { id: number } | undefined;

  if (!user) {
    return badRequest('Ссылка недействительна или истекла');
  }

  // Хеш считаем до транзакции: hashPassword асинхронный (scrypt с N=65536
  // держит CPU ~100 мс), а better-sqlite3 требует синхронный callback.
  // Между проверкой токена и записью проходит время, поэтому токен
  // перепроверяется внутри транзакции — иначе два параллельных запроса
  // с одним токеном оба успели бы сменить пароль.
  const newHash = await hashPassword(password);

  const changed = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE users
            SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL
          WHERE id = ? AND password_reset_token = ?`,
      )
      .run(newHash, user.id, token);
    if (result.changes === 0) return false;

    // Смена пароля обрывает все сессии: украденная сессия не должна
    // пережить смену пароля, даже если злоумышленник вошёл раньше.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    return true;
  })();

  if (!changed) {
    return badRequest('Ссылка недействительна или истекла');
  }

  return NextResponse.json({ ok: true });
}
