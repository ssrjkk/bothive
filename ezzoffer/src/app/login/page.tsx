import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { AuthForm } from '@/components/auth-form';
import { authMethods, authMethodReady } from '@/lib/auth-methods';

export const metadata: Metadata = {
  title: 'Вход',
  description: 'Вход в аккаунт EZOffer.',
};

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; verified?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  const { next, verified } = await searchParams;
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : undefined;

  /*
   * Список способов считается здесь, на сервере, и попадает в HTML.
   *
   * Раньше он запрашивался на клиенте, и кнопки в исходном коде страницы не
   * было вовсе: она появлялась после гидрации. Проверка «есть ли кнопка в
   * HTML» это показывала — и заодно показывала настоящий изъян: при медленном
   * JS человек видел форму входа без альтернативы, и это выглядело как
   * «входа через GitHub тут нет».
   *
   * Готовность читается из окружения сервера — того самого, где ключи и
   * лежат. Клиент не решает, готов ли способ.
   */
  const methods = authMethods().map((m) => ({
    id: m.id,
    title: m.title,
    ready: authMethodReady(m.id),
  }));

  return (
    <div className="container-x py-16 md:py-20">
      {/*
       * Итог подтверждения почты из ссылки в письме.
       *
       * Серверный рендер намеренно: человек открывает ссылку без JS или с
       * медленной сетью и всё равно видит, получилось или нет, а не пустую
       * форму входа. verified — это "0"/"1" из нашего же редиректа, токен в
       * URL не светится: он уже сгорел в роуте подтверждения.
       */}
      {verified === '1' ? (
        <p
          role="status"
          className="mx-auto mb-6 max-w-md rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink"
        >
          Почта подтверждена — входите.
        </p>
      ) : null}
      {verified === '0' ? (
        <p
          role="alert"
          className="mx-auto mb-6 max-w-md rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink"
        >
          Ссылка недействительна или истекла. Зарегистрируйтесь заново — мы вышлем новую.
        </p>
      ) : null}
      <AuthForm mode="login" next={safeNext} methods={methods} />
    </div>
  );
}
