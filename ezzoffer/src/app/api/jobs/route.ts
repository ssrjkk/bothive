import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { getCatalog, listSources, refreshProviders } from '@/lib/vacancies';
import { NO_STORE_HEADERS } from '@/lib/http';

export const dynamic = 'force-dynamic';

const MAX_VACANCIES = 300;

function clampStr(v: string | null, max: number): string {
  if (!v) return '';
  return v.trim().slice(0, max);
}

function parseMin(v: string | null): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const wantRefresh = searchParams.get('refresh') === '1';

  let sources = listSources();
  let refreshed = false;

  if (wantRefresh) {
    const rl = rateLimit(`jobs-refresh:${user.id}`, { windowMs: 5 * 60 * 1000, max: 10 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Слишком часто запрашиваете обновление каталога' },
        {
          status: 429,
          headers: { 'Retry-After': String(rl.retryAfterSeconds) },
        },
      );
    }
    const text = clampStr(searchParams.get('text'), 200);
    const city = clampStr(searchParams.get('city'), 60);
    sources = await refreshProviders({ text, city, limit: 50 });
    refreshed = true;
  }

  const text = clampStr(searchParams.get('text'), 200).toLowerCase();
  const level = clampStr(searchParams.get('level'), 20);
  const format = clampStr(searchParams.get('format'), 20);
  const city = clampStr(searchParams.get('city'), 60).toLowerCase();
  const minSalary = parseMin(searchParams.get('salaryMin'));

  let list = getCatalog();
  if (text) {
    list = list.filter((v) => `${v.title} ${v.company} ${v.category}`.toLowerCase().includes(text));
  }
  if (level) list = list.filter((v) => v.level === level);
  if (format) list = list.filter((v) => v.format === format);
  if (city) list = list.filter((v) => v.city.toLowerCase().includes(city));
  if (minSalary > 0) {
    list = list.filter((v) => {
      const salary = v.salary_min ?? 0;
      return salary === 0 || salary >= minSalary;
    });
  }

  return Response.json(
    {
      vacancies: list.slice(0, MAX_VACANCIES),
      total: list.length,
      sources,
      refreshed,
    },
    { headers: NO_STORE_HEADERS },
  );
}
