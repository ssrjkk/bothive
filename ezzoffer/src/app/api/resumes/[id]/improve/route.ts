import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { db } from '@/lib/db';
import { isPlanActive } from '@/lib/plans';
import { enhanceResume, scoreResume, detectKeywords } from '@/lib/resume-enhance';
import { enhanceResumeWithAi } from '@/lib/ai';
import { parseParamId } from '@/lib/http';
import { rateLimit } from '@/lib/rate-limit';

/**
 * Улучшение резюме вызывает внешний AI-провайдер (или дорогой локальный разбор)
 * и перезаписывает содержимое. Без лимита один запрос в цикле выжигал бы
 * API-ключ владельца сервиса и перезаписывал резюме мусором.
 */
const AI_LIMIT = { windowMs: 60 * 60 * 1000, max: 20 };

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return unauthorized();

  /*
   * Улучшение — тарифная фича.
   *
   * Вызов уходит во внешний ИИ за ключ владельца (AI_API_KEY): каждый запрос
   * стоит денег и жжёт квоту. Без гейта любой зарегистрированный выжигал бы
   * ключ в цикле — rate-limit (20/час) лишь растягивал бы это во времени.
   * 402, а не 403: дело не в запрете, а в оплате — семантически точно.
   *
   * Тариф читается из БД, а не из объекта сессии: сессия — снимок на момент
   * входа, а срок мог истечь после. Тот же приём, что в applications route.
   */
  const fresh = db.prepare('SELECT plan, plan_expires_at FROM users WHERE id = ?').get(user.id) as
    { plan: string; plan_expires_at: number | null } | undefined;
  if (!fresh || !isPlanActive(fresh)) {
    return NextResponse.json(
      {
        error:
          'Улучшение резюме доступно на активном тарифе. Активируйте тариф или пробный период.',
      },
      { status: fresh ? 402 : 401 },
    );
  }

  const { id: rawId } = await ctx.params;
  const id = parseParamId(rawId);
  if (id === null) return NextResponse.json({ error: 'Некорректный id' }, { status: 400 });

  const resume = db
    .prepare('SELECT * FROM resumes WHERE id = ? AND user_id = ?')
    .get(id, user.id) as { id: number; content: string } | undefined;
  if (!resume) return NextResponse.json({ error: 'Резюме не найдено' }, { status: 404 });

  const limiter = rateLimit(`resume-improve:${user.id}`, AI_LIMIT);
  if (!limiter.allowed) {
    return NextResponse.json(
      { error: 'Слишком много улучшений подряд. Попробуйте через час.' },
      { status: 429, headers: { 'Retry-After': String(limiter.retryAfterSeconds) } },
    );
  }

  const before = scoreResume(resume.content);

  // Сначала пробуем реальный ИИ-провайдер, если настроен; иначе — локальные эвристики.
  const ai = await enhanceResumeWithAi(resume.content);
  const enhanced = ai
    ? {
        content: ai.content,
        notes: ai.notes,
        tips: ai.tips,
        keywords: detectKeywords(ai.content),
        before,
        after: scoreResume(ai.content),
        engine: 'ai' as const,
      }
    : {
        ...enhanceResume(resume.content),
        before,
        engine: 'rules' as const,
      };

  // Владение проверяется в самой записи, а не только SELECT'ом выше: см.
  // api/letters/[id]/route.ts.
  const updated = db
    .prepare(
      `UPDATE resumes SET content = ?, ai_improved = 1, updated_at = ? WHERE id = ? AND user_id = ?`,
    )
    .run(enhanced.content, Date.now(), id, user.id);
  if (updated.changes === 0) {
    return NextResponse.json({ error: 'Резюме не найдено' }, { status: 404 });
  }
  const row = db.prepare('SELECT * FROM resumes WHERE id = ?').get(id);

  return Response.json({
    resume: row,
    notes: enhanced.notes,
    tips: enhanced.tips,
    keywords: enhanced.keywords,
    score: { before: enhanced.before, after: enhanced.after },
    engine: enhanced.engine,
  });
}
