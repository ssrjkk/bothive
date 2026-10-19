import { NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/api';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http';
import { renderResumePdf } from '@/lib/resume-pdf';

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const parsed = Number(searchParams.get('resumeId') ?? 0);
  const resumeId = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;

  const resume = (
    resumeId > 0
      ? db
          .prepare('SELECT title, content, years_label FROM resumes WHERE id = ? AND user_id = ?')
          .get(resumeId, user.id)
      : db
          .prepare(
            'SELECT title, content, years_label FROM resumes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
          )
          .get(user.id)
  ) as { title: string; content: string; years_label: string } | undefined;

  if (!resume) {
    return NextResponse.json({ error: 'Резюме не найдено' }, { status: 404 });
  }

  const result = await renderResumePdf({
    title: resume.title,
    content: resume.content,
    yearsLabel: resume.years_label,
  });

  if (!result.ok) {
    // 503, а не 500: это конфигурационная проблема окружения, а не баг запроса.
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="resume-${resumeId || 'latest'}.pdf"`,
      ...NO_STORE_HEADERS,
    },
  });
}
