import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { LettersManager } from '@/components/dashboard/letters-manager';

export const metadata: Metadata = { title: 'Письма' };
export const dynamic = 'force-dynamic';

export default async function LettersPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const letters = db
    .prepare('SELECT * FROM letters WHERE user_id = ? ORDER BY updated_at DESC')
    .all(user.id) as {
    id: number;
    title: string;
    content: string;
    updated_at: number;
  }[];
  return (
    <div>
      <h1 className="font-serif text-2xl leading-snug text-ink">Сопроводительные письма</h1>
      <p className="mt-1 text-sm text-muted">
        Шаблоны писем подставляются в отклики и делают их персональными для каждого работодателя.
      </p>
      <div className="mt-6">
        <LettersManager initial={letters} />
      </div>
    </div>
  );
}
