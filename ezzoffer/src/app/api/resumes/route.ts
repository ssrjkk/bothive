import { NextResponse } from 'next/server';
import { requireUser, unauthorized, readJson } from '@/lib/api';
import { db } from '@/lib/db';
import { isPlanActive, planResumeLimit } from '@/lib/plans';
import { getValidHhToken } from '@/lib/hh-oauth';
import { fetchHhResumeContent } from '@/lib/hh-resumes';
import { NO_STORE_HEADERS } from '@/lib/http';

export async function GET() {
  const user = await requireUser();
  if (!user) return unauthorized();
  const rows = db
    .prepare('SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC')
    .all(user.id);
  return Response.json({ resumes: rows }, { headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  if (!isPlanActive(user)) {
    return NextResponse.json(
      { error: 'Сначала активируйте пробный период или тариф' },
      { status: 403 },
    );
  }
  const resumeLimit = planResumeLimit(user.plan);
  if (resumeLimit > 0) {
    const { c } = db
      .prepare('SELECT COUNT(*) AS c FROM resumes WHERE user_id = ?')
      .get(user.id) as { c: number };
    if (c >= resumeLimit) {
      return NextResponse.json(
        {
          error: `На тарифе «${user.plan === 'start' ? 'Старт' : user.plan}» доступно ${resumeLimit} резюме. Обновите тариф для большего количества.`,
        },
        { status: 403 },
      );
    }
  }

  const { data, error } = await readJson<{
    title?: string;
    content?: string;
    yearsLabel?: string;
    /** id резюме на hh для импорта. */
    fromHh?: string;
  }>(request);
  if (error) return error;

  /*
   * Импорт из hh.
   *
   * Человек, который ищет работу, уже имеет резюме на hh — иначе он и не
   * искал бы. Заставлять его перепечатывать то же самое в сторонний сервис —
   * преграда на входе: половина людей уходит, не увидев пользы.
   *
   * Содержимое берётся с токена пользователя, а не из формы: иначе это был
   * бы не импорт, а ручной ввод с новым именем.
   */
  if (data?.fromHh?.trim()) {
    const token = (await getValidHhToken(user))?.token;
    if (!token) {
      return NextResponse.json(
        { error: 'Сначала привяжите аккаунт hh.ru в настройках' },
        { status: 403 },
      );
    }

    const imported = await fetchHhResumeContent(token, data.fromHh.trim());
    if (!imported || !imported.text.trim()) {
      return NextResponse.json(
        { error: 'Не удалось прочитать резюме с hh.ru. Проверьте, что аккаунт привязан.' },
        { status: 502 },
      );
    }

    const now = Date.now();
    const hhId = data.fromHh.trim();
    /*
     * Повторный импорт того же резюме hh.
     *
     * Уникальный индекс (user_id, hh_id) не даст вставить дубль, и API ответил
     * бы 500 — человеку с понятным намерением «обновить резюме из hh» это
     * невыносимо. Поэтому дубль обновляет существующую запись: так и работает
     * повторный импорт на hh, где резюме одно и его перезаливают.
     */
    const existing = db
      .prepare('SELECT id FROM resumes WHERE user_id = ? AND hh_id = ?')
      .get(user.id, hhId) as { id: number } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE resumes SET title = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      ).run(
        (data.title?.trim() || imported.title || 'Резюме').slice(0, 100),
        imported.text.slice(0, 20000),
        now,
        existing.id,
        user.id,
      );
      const row = db.prepare('SELECT * FROM resumes WHERE id = ?').get(existing.id);
      return Response.json({ resume: row, imported: true, updated: true }, { status: 200 });
    }

    const result = db
      .prepare(
        `INSERT INTO resumes (user_id, title, content, years_label, ai_improved, hh_id, created_at, updated_at)
         VALUES (?, ?, ?, '', 0, ?, ?, ?)`,
      )
      .run(
        user.id,
        (data.title?.trim() || imported.title || 'Резюме').slice(0, 100),
        imported.text.slice(0, 20000),
        hhId,
        now,
        now,
      );

    const row = db.prepare('SELECT * FROM resumes WHERE id = ?').get(result.lastInsertRowid);
    return Response.json({ resume: row, imported: true }, { status: 201 });
  }

  if (!data?.title?.trim() || !data?.content?.trim()) {
    return NextResponse.json({ error: 'Укажите название и текст резюме' }, { status: 400 });
  }
  const title = data.title.trim().slice(0, 100);
  const content = data.content.trim().slice(0, 20000);
  const yearsLabel = (data.yearsLabel ?? '').trim().slice(0, 60);

  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO resumes (user_id, title, content, years_label, ai_improved, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(user.id, title, content, yearsLabel, now, now);

  const row = db.prepare('SELECT * FROM resumes WHERE id = ?').get(result.lastInsertRowid);
  return Response.json({ resume: row }, { status: 201 });
}
