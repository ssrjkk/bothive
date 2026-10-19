import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isPlanActive, planDailyLimit, planLabel, daysLeft } from '@/lib/plans';
import { catalogItem } from '@/lib/payments/catalog';
import { DashboardNav } from '@/components/dashboard/nav';
import { MobileNav } from '@/components/dashboard/mobile-nav';
import { DemoBanner } from '@/components/dashboard/demo-banner';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const active = isPlanActive(user);
  const nav = {
    name: user.name,
    email: user.email,
    planLabel: planLabel(user),
    planActive: active,
    planDays: daysLeft(user),
    planLimit: active ? planDailyLimit(user.plan) : 0,
    planPermanent: Boolean(catalogItem(user.plan)?.permanent),
  };

  /*
   * Раскладка кабинета.
   *
   * Был градиент бумага→бирюза на всей странице: он не обозначал ничего,
   * но «приподнимал» интерфейс над сайтом. Вместо него — колонка
   * навигации на отдельной поверхности с правой линейкой. Так кабинет
   * читается как двукнижная вёрстка: слева содержание, справа полоса,
   * а не как окно поверх сайта.
   */
  return (
    <div className="min-h-screen bg-paper lg:flex">
      {/*
          top-16, а не top-0: сайт-шапка липкая и имеет h-16 от lg, поэтому
          при top-0 верхние 64px колонки навигации уходили под неё. Видно
          становилось то, что должно быть видно при любой прокрутке.
        */}
      <aside className="hidden shrink-0 border-r border-line bg-surface lg:sticky lg:top-16 lg:flex lg:h-[calc(100vh-4rem)] lg:w-72 lg:flex-col">
        <div className="flex h-full flex-col overflow-y-auto px-7 py-8">
          <DashboardNav {...nav} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <main className="px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-6xl">
            {/*
              Баннер стоит в раскладке, а не на каждой странице: пометка
              «здесь демо» обязана быть на каждом экране, где показываются
              цифры. На странице без чисел он лишний, но счёт страниц кабинета
              мал, а риск пропустить пометку на одной из них — обман.
            */}
            <DemoBanner mode={user.mode} />
            {/*
              На телефоне колонка разделов занимала 737px — больше экрана
              целиком, и до содержания страницы человек доходил только после
              длинной прокрутки мимо десяти ссылок. Здесь вместо неё одна
              сворачивающаяся строка с названием текущего раздела
              (MobileNav), которая работает и без JavaScript.
            */}
            <div className="mb-5 lg:hidden">
              <MobileNav {...nav} />
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
