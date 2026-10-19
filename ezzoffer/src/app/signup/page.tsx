import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { AuthForm } from '@/components/auth-form';

export const metadata: Metadata = {
  title: 'Регистрация',
  description:
    'Создайте аккаунт EZOffer и получите 24 часа бесплатного доступа без привязки карты.',
};

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  return (
    <div className="container-x py-16 md:py-20">
      <AuthForm mode="signup" />
    </div>
  );
}
