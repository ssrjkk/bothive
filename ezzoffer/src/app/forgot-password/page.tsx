import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/forgot-password-form';

export const metadata: Metadata = {
  title: 'Восстановление пароля',
  description: 'Отправка ссылки для восстановления пароля EZOffer.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <div className="container-x py-16 md:py-20">
      <ForgotPasswordForm />
    </div>
  );
}
