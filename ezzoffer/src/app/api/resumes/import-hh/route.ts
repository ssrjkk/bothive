import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { getValidHhToken } from '@/lib/hh-oauth';
import { listHhResumes } from '@/lib/hh-resumes';
import { NO_STORE_HEADERS } from '@/lib/http';

/**
 * Список резюме пользователя на hh.ru — для выбора при импорте.
 *
 * Отдельный маршрут, а не поле в /api/resumes: список нужен до того, как
 * импорт решен, и тянуть его вместе с нашими резюме означало бы опрашивать
 * hh при каждом открытии страницы, даже если человек импортом не
 * пользуется.
 */
export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();

  const token = (await getValidHhToken(user))?.token;
  if (!token) {
    return NextResponse.json(
      { error: 'Аккаунт hh.ru не привязан', resumes: [] },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const resumes = await listHhResumes(token);

  return Response.json({ resumes }, { headers: NO_STORE_HEADERS });
}
