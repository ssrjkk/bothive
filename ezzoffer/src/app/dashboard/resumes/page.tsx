import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { ResumesManager } from '@/components/dashboard/resumes-manager';

export const metadata: Metadata = { title: 'Резюме' };
export const dynamic = 'force-dynamic';

export default async function ResumesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const resumes = db
    .prepare('SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC')
    .all(user.id) as {
    id: number;
    title: string;
    content: string;
    years_label: string;
    ai_improved: number;
    /** id резюме на hh; null — отправлено не будет, только подбор. */
    hh_id: string | null;
    created_at: number;
    updated_at: number;
  }[];

  return (
    <div>
      <h1 className="font-serif text-2xl leading-snug text-ink">Резюме</h1>
      <p className="mt-1 text-sm text-muted">
        Создайте резюме, и AI усилит его под требования рынка. Отклики отправляются от его имени.
      </p>
      <div className="mt-6">
        <ResumesManager initial={resumes} />
      </div>
    </div>
  );
}
