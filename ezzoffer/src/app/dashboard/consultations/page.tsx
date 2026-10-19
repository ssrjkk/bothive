import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { ConsultationsManager } from '@/components/dashboard/consultations-manager';

export const metadata: Metadata = { title: 'Консультации' };
export const dynamic = 'force-dynamic';

export default async function ConsultationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const consultations = db
    .prepare('SELECT * FROM consultations WHERE user_id = ? ORDER BY booked_at DESC')
    .all(user.id) as { id: number; theme: string; note: string; booked_at: number; done: number }[];

  return (
    <div>
      <h1 className="font-serif text-2xl leading-snug text-ink">Консультации</h1>
      <p className="mt-1 text-sm text-muted">
        Запишитесь на встречу с карьерным стратегом — разберём резюме, воронку откликов и офферы.
      </p>
      <div className="mt-6">
        <ConsultationsManager initial={consultations} />
      </div>
    </div>
  );
}
