'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/*
 * Шапка.
 *
 * Прежний вариант: пилюли в навигации, полупрозрачные белые подложки,
 * фиолетовое свечение под кнопками, градиентная подложка логотипа и
 * градиентное слово в логотипе. На бумаге белые полупрозрачные слои
 * исчезают, а свечения остаются сиять — то есть шапка выглядела бы
 * «частично переведённой».
 *
 * Теперь это газетная шапка: линейка снизу, навигация моноширинным
 * (как колонтитул), активный пункт отмечен красной черточкой, а не заливкой.
 */

const nav = [
  { href: '/#how-it-work', label: 'Как это работает' },
  { href: '/pricing', label: 'Тарифы' },
  { href: '/jobs', label: 'Вакансии' },
  { href: '/resume-examples', label: 'Примеры резюме' },
  { href: '/internships', label: 'Стажировки' },
  { href: '/blog', label: 'Блог' },
  { href: '/faq', label: 'FAQ' },
];

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`flex items-center gap-2.5 ${className}`}
      aria-label="EZOffer — на главную"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-ink">
        <svg viewBox="0 0 24 24" fill="none" className="size-4 text-paper" aria-hidden>
          <path d="M13 2 4.5 13.5h6L11 22l8.5-11.5h-6L13 2Z" fill="currentColor" />
        </svg>
      </span>
      <span className="font-serif text-lg font-semibold tracking-tight text-ink">EZOffer</span>
    </Link>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<{ name: string } | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setUser(d?.user ?? null))
      .catch(() => setUser(null));
  }, [pathname]);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg">
      {/*
        pt под safe-area, а не только h.

        Шапка липкая и есть на каждой странице. В iOS standalone и под челкой
        `sticky top-0` прижимает её к самому краю, и логотип уезжает под
        строку состояния. `env(safe-area-inset-top)` равен нулю везде, где
        выреза нет, поэтому на обычных экранах вид не меняется.
      */}
      <div className="container-x flex min-h-14 items-center justify-between gap-4 pt-[env(safe-area-inset-top)] md:min-h-16">
        <Logo />

        <nav className="hidden items-center gap-6 lg:flex" aria-label="Основная навигация">
          {nav.map((item) => {
            const active = item.href !== '/#how-it-work' && pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`relative py-2 font-mono text-xs uppercase tracking-[0.1em] transition-colors ${
                  active ? 'text-accent' : 'text-muted hover:text-ink'
                }`}
              >
                {item.label}
                {active ? (
                  <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <Link
              href="/dashboard"
              className="hidden rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover sm:block"
            >
              Кабинет
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden text-sm font-medium text-muted transition-colors hover:text-ink sm:block"
              >
                Войти
              </Link>
              <Link
                href="/signup"
                className="hidden rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover sm:block"
              >
                24 часа бесплатно
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="grid size-11 place-items-center rounded-sm border border-line-strong lg:hidden"
            aria-expanded={open}
            aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
          >
            <span className="sr-only">Меню</span>
            <div className="flex w-4 flex-col gap-1">
              <span
                className={`h-px w-full bg-ink transition-transform ${open ? 'translate-y-[3px] rotate-45' : ''}`}
              />
              <span
                className={`h-px w-full bg-ink transition-opacity ${open ? 'opacity-0' : ''}`}
              />
              <span
                className={`h-px w-full bg-ink transition-transform ${open ? '-translate-y-[3px] -rotate-45' : ''}`}
              />
            </div>
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-line bg-bg lg:hidden">
          <nav className="container-x flex flex-col py-3" aria-label="Мобильная навигация">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="border-b border-line py-3 font-mono text-xs uppercase tracking-[0.1em] text-muted transition-colors last:border-b-0 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-4 flex flex-col gap-2">
              {user ? (
                <Link
                  href="/dashboard"
                  onClick={() => setOpen(false)}
                  className="rounded-sm bg-accent px-4 py-2.5 text-center text-sm font-semibold text-white"
                >
                  Кабинет
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="rounded-sm border border-line-strong px-4 py-2.5 text-center text-sm font-semibold text-ink"
                  >
                    Войти
                  </Link>
                  <Link
                    href="/signup"
                    onClick={() => setOpen(false)}
                    className="rounded-sm bg-accent px-4 py-2.5 text-center text-sm font-semibold text-white"
                  >
                    24 часа бесплатно
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
