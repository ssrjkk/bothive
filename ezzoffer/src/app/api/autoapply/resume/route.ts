import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { db } from '@/lib/db';

/**
 * Возобновление автооткликов: снимаем глобальную паузу. Активность поисков не
 * меняется — её переключает пользователь в разделе «Вакансии».
 */
export async function POST() {
  const user = await requireUser();
  if (!user) return unauthorized();
  db.prepare('UPDATE users SET autoapply_paused = 0 WHERE id = ?').run(user.id);
  return NextResponse.json({ paused: false });
}
