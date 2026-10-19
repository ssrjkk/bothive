import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { JobExplorer } from '@/components/dashboard/jobs-explorer';

export const metadata: Metadata = { title: 'Вакансии' };
export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return (
    <div>
      <h1 className="font-serif text-2xl leading-snug text-ink">Вакансии и автопоиск</h1>
      <p className="mt-1 text-sm text-muted">
        Используйте каталог для ручных откликов или настройте автопоиск — отклики полетят сами.
      </p>
      <div className="mt-6">
        <JobExplorer />
      </div>
    </div>
  );
}
