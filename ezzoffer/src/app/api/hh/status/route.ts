import { requireUser, unauthorized } from '@/lib/api';
import { db, type User } from '@/lib/db';
import { hhConfigured, isHhConnected } from '@/lib/hh-oauth';
import { NO_STORE_HEADERS } from '@/lib/http';

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  // Читаем актуальное состояние напрямую из БД, а не из объекта сессии:
  // токен мог обновиться между запросами. Если строки нет — сессия недействительна.
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as User | undefined;
  if (!fresh) return unauthorized();
  const tokenValid = Boolean(
    fresh.hh_token && fresh.hh_token_expires_at && fresh.hh_token_expires_at > Date.now(),
  );
  // Протухший access-токен не значит «не подключено»: getValidHhToken умеет
  // обновить его по refresh_token, и автоотклики продолжат работать. Раньше
  // UI в этом случае предлагал подключиться заново, хотя всё работало.
  const canRefresh = Boolean(fresh.hh_refresh_token) && hhConfigured();
  const connected = isHhConnected(fresh);
  const resumeId = fresh.hh_resume_id;

  return Response.json(
    {
      configured: hhConfigured(),
      connected,
      /** Токен протух, но будет обновлён автоматически. */
      refreshable: !tokenValid && canRefresh,
      resume_id: resumeId ?? null,
      expires_at: fresh.hh_token_expires_at,
    },
    { headers: NO_STORE_HEADERS },
  );
}
