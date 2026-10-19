import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { listApplications } from '@/lib/applications';
import { ApplicationsView } from '@/components/dashboard/applications-view';

export const metadata: Metadata = { title: 'Отклики' };
export const dynamic = 'force-dynamic';

export default async function ApplicationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const initial = listApplications(user.id);
  return (
    <div>
      <h1 className="font-serif text-2xl leading-snug text-ink">Отклики</h1>
      <p className="mt-1 text-sm text-muted">
        Статусы обновляются автоматически: отправлен → просмотрен → ответ HR.
      </p>
      <div className="mt-6">
        <ApplicationsView initial={initial} />
      </div>
    </div>
  );
}
