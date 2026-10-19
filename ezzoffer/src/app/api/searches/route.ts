import {
  requireUser,
  unauthorized,
  readJson,
  toPositiveNumber,
  validateSalaryRange,
  badRequest,
} from '@/lib/api';
import { db } from '@/lib/db';
import { matchCount, type SearchRow } from '@/lib/matcher';
import { NO_STORE_HEADERS } from '@/lib/http';

function serialize(row: SearchRow) {
  return { ...row, match_count: matchCount(row) };
}

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();
  const rows = db
    .prepare('SELECT * FROM searches WHERE user_id = ? ORDER BY created_at DESC')
    .all(user.id) as SearchRow[];
  return Response.json({ searches: rows.map(serialize) }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();
  const { data, error } = await readJson<{
    title?: string;
    keywords?: string;
    salary_min?: number;
    salary_max?: number;
    format?: string;
    city?: string;
    level?: string;
    company_blacklist?: string;
  }>(request);
  if (error) return error;

  const title = (data?.title?.trim() || 'Новый поиск').slice(0, 100);
  const keywords = (data?.keywords?.trim() ?? '').slice(0, 400);
  const format = (data?.format?.trim() ?? '').slice(0, 20);
  const city = (data?.city?.trim() ?? '').slice(0, 60);
  const level = (data?.level?.trim() ?? '').slice(0, 20);
  const companyBlacklist = (data?.company_blacklist?.trim() ?? '').slice(0, 400);
  const salaryMin = toPositiveNumber(data?.salary_min);
  const salaryMax = toPositiveNumber(data?.salary_max);

  const rangeError = validateSalaryRange(salaryMin, salaryMax);
  if (rangeError) return badRequest(rangeError);

  const result = db
    .prepare(
      `INSERT INTO searches (user_id, title, keywords, salary_min, salary_max, format, city, level, company_blacklist, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.id,
      title,
      keywords,
      salaryMin,
      salaryMax,
      format,
      city,
      level,
      companyBlacklist,
      Date.now(),
    );

  const row = db
    .prepare('SELECT * FROM searches WHERE id = ?')
    .get(result.lastInsertRowid) as SearchRow;
  return Response.json({ search: serialize(row) }, { status: 201 });
}
