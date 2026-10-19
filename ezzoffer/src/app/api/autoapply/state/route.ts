import { requireUser, unauthorized } from '@/lib/api';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http';
import { loadLastRun } from '@/lib/autoapply-store';

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();
  const row = db
    .prepare(
      'SELECT autoapply_paused, autoapply_blocked_until, autoapply_block_reason FROM users WHERE id = ?',
    )
    .get(user.id) as {
    autoapply_paused: number;
    autoapply_blocked_until: number;
    autoapply_block_reason: string;
  };

  /*
   * Ограничение площадки отдаётся отдельными полями, а не прячется в paused.
   *
   * Это разные вещи с разными действиями: паузу человек ставит и снимает сам,
   * а ограничение от hh снимается только там — и нажатие «возобновить» здесь
   * ничего не меняет. Если показать это как паузу, человек будет жать
   * «возобновить» и не поймёт, почему отклики не уходят.
   */
  const until = row.autoapply_blocked_until ?? 0;
  const blocked = until > Date.now();

  return Response.json(
    {
      paused: Boolean(row.autoapply_paused),
      blocked,
      blockedUntil: blocked ? until : 0,
      blockedReason: blocked ? (row.autoapply_block_reason ?? '') : '',
      lastRun: loadLastRun(),
    },
    { headers: NO_STORE_HEADERS },
  );
}
