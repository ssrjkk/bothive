import { authMethods, authMethodReady } from '@/lib/auth-methods';
import { NO_STORE_HEADERS } from '@/lib/http';

/**
 * GET /api/auth/methods — какие способы входа настроены прямо сейчас.
 *
 * Роут открытый и не отдаёт ничего секретного: только идентификатор, название
 * и признак готовности. Он идёт ДО входа — по нему страница решает, какие
 * кнопки рисовать.
 *
 * Готовность проверяется на сервере, а не присылается клиентом: клиент,
 * которому видно «готово», не может решить, готов ли способ на самом деле.
 * Неготовые способы в ответе тоже перечислены — с причиной, чтобы человек
 * понимал, чего ему не хватает.
 */
export async function GET() {
  const methods = authMethods()
    .filter((m) => !m.passwordless || m.env)
    .map((m) => ({
      id: m.id,
      title: m.title,
      ready: authMethodReady(m.id),
    }));

  return Response.json({ methods }, { headers: NO_STORE_HEADERS });
}
