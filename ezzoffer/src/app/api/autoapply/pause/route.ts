import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { db } from '@/lib/db';

/**
 * Мгновенная пауза всех автооткликов пользователя.
 *
 * Раньше здесь дополнительно ставились `searches.active = 0`, но /resume эту
 * метку не восстанавливал — после паузы и возобновления все автопоиски оставались
 * выключены навсегда, и автоотклики больше не запускались. Флага
 * `autoapply_paused` достаточно: runAutoApply проверяет его до любой отправки,
 * поэтому пауза мгновенная без потери настроек поисков.
 */
export async function POST() {
  const user = await requireUser();
  if (!user) return unauthorized();

  db.prepare('UPDATE users SET autoapply_paused = 1 WHERE id = ?').run(user.id);
  return NextResponse.json({ paused: true });
}
