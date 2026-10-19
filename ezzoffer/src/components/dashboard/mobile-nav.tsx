'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  FileText,
  Briefcase,
  Bookmark,
  Send,
  Mail,
  MessageCircle,
  Settings,
  LogOut,
  GraduationCap,
  BriefcaseBusiness,
  ChevronDown,
} from 'lucide-react';
import { Badge } from '@/components/dashboard/ui';

/**
 * Навигация кабинета на телефоне.
 *
 * ## Почему это отдельный компонент
 *
 * На узком экране колонка разделов занимала больше экрана целиком: десять
 * пунктов плюс блок тарифа плюс кнопка выхода — измерено 737px при
 * доступной высоте около 680px. То есть на каждой из десяти страниц кабинета
 * человек сначала прокручивал длинный список ссылок и только потом добирался
 * до содержания. И это не «неудобно», а прямое препятствие: на длинных
 * страницах (вакансии, резюме, настройки) меню оказывалось тысячи пикселей
 * выше большого пальца.
 *
 * Здесь оно сворачивается в одну строку с названием текущего раздела.
 * Развернуть — нажатие; закрыть происходит само при переходе.
 *
 * ## Почему `<details>`, а не кнопка с состоянием
 *
 * Нативный элемент раскрывается без JavaScript: если скрипты не загрузились,
 * список всё равно доступен, просто сразу раскрытый. Это тот же довод, по
 * которому здесь не `<summary>` на `useState` — самый частый способ
 * «сэкономить» разметку, который оставляет страницу нефункциональной без JS.
 * Закрыть его программно нельзя, поэтому переход по ссылке закрывает меню
 * через перезагрузку маршрута — так оно и работает.
 */

const items = [
  { href: '/dashboard', label: 'Обзор', icon: LayoutDashboard },
  { href: '/dashboard/resumes', label: 'Резюме', icon: FileText },
  { href: '/dashboard/jobs', label: 'Вакансии', icon: Briefcase },
  { href: '/dashboard/bookmarks', label: 'Избранное', icon: Bookmark },
  { href: '/dashboard/applications', label: 'Отклики', icon: Send },
  { href: '/dashboard/letters', label: 'Письма', icon: Mail },
  { href: '/dashboard/gigs', label: 'Подработка', icon: BriefcaseBusiness },
  { href: '/dashboard/skills', label: 'Навыки', icon: GraduationCap },
  { href: '/dashboard/consultations', label: 'Консультации', icon: MessageCircle },
  { href: '/dashboard/settings', label: 'Настройки', icon: Settings },
];

export function MobileNav({
  planLabel,
  planActive,
  planDays,
  planLimit,
  planPermanent,
}: {
  planLabel: string;
  planActive: boolean;
  planDays: number;
  planLimit: number;
  /** Вечный тариф: вместо «осталось 0 дн.» показывается «без срока». */
  planPermanent?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const active =
    items.find((i) =>
      i.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(i.href),
    ) ?? items[0]!;
  const ActiveIcon = active.icon;

  const logout = async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <details className="group rounded-sm border border-line bg-surface">
      <summary
        className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden"
        /* min-h-11 = 44px: палец, а не курсор. */
      >
        <ActiveIcon className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 truncate">{active.label}</span>
        <span className="ml-auto shrink-0 text-xs font-normal text-muted">меню</span>
        <ChevronDown
          className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <nav aria-label="Разделы кабинета" className="border-t border-line">
        <ul>
          {items.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href} className="border-b border-line last:border-b-0">
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                    isActive ? 'bg-surface-2 font-semibold text-ink' : 'text-muted hover:text-ink'
                  }`}
                >
                  {isActive ? (
                    <span aria-hidden className="absolute left-0 h-full w-0.5 bg-accent" />
                  ) : null}
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="border-t-2 border-ink p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              Тариф
            </span>
            <Badge tone={planActive ? 'success' : 'warn'}>
              {planActive ? 'Активен' : 'Не активен'}
            </Badge>
          </div>
          <p className="mt-2 font-serif text-base text-ink">{planLabel}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {planActive
              ? planPermanent
                ? `${planLimit} откликов/день · без срока`
                : `${planLimit} откликов/день · осталось ${planDays} дн.`
              : 'Активируйте пробный период в настройках'}
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-3 inline-flex min-h-11 items-center gap-2 border-b border-ink text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Управлять тарифом
            <span aria-hidden>→</span>
          </Link>
        </div>

        <button
          type="button"
          onClick={logout}
          disabled={busy}
          className="flex min-h-11 w-full items-center gap-3 border-t border-line px-4 py-2.5 text-sm text-muted transition-colors hover:text-danger"
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          {busy ? 'Выход…' : 'Выйти'}
        </button>
      </nav>
    </details>
  );
}
