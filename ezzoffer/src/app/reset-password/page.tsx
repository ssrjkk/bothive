import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/reset-password-form';

export const metadata: Metadata = {
  title: 'Новый пароль',
  description: 'Задайте новый пароль для аккаунта EZOffer.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  return (
    <div className="container-x py-16 md:py-20">
      <ResetPasswordForm />
    </div>
  );
}
