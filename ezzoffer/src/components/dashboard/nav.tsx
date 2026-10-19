'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
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
} from 'lucide-react';
import { Badge } from '@/components/dashboard/ui';

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

/*
 * Навигация кабинета.
 *
 * Прежний вид — кружок с инициалом, пункты в скруглённых плашках и
 * карточка тарифа с заливкой. То есть кабинет повторял приёмы витрины,
 * из которой он вырос, хотя это рабочий инструмент: здесь нужен список
 * разделов и факты, а не витрина.
 *
 * Теперь колонка газетного содержания: имя антиквой, почта моноширинным,
 * пункты списком через волосяную линейку, активный помечен красной
 * полосой слева. Тариф — те же цифры, что и везде на сайте: под линейкой,
 * моноширинным, без отдельной коробки.
 */
export function DashboardNav({
  name,
  email,
  planLabel,
  planActive,
  planDays,
  planLimit,
  planPermanent,
  onMobile,
  onClose,
}: {
  name: string;
  email: string;
  planLabel: string;
  planActive: boolean;
  planDays: number;
  planLimit: number;
  /** Вечный тариф: вместо «осталось 0 дн.» показывается «без срока». */
  planPermanent?: boolean;
  onMobile?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // framer-motion анимирует через requestAnimationFrame, а не через CSS, поэтому
  // prefers-reduced-motion в globals.css на него не действует. Пользователь,
  // попросивший систему уменьшить движение, всё равно получал анимированный
  // «ползунок» активного пункта — это WCAG 2.3.3.
  const reduceMotion = useReducedMotion();

  const logout = async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  const initial = name.trim().charAt(0).toUpperCase() || 'U';

  return (
    <nav
      className={`flex flex-col ${onMobile ? 'flex lg:hidden' : 'hidden lg:flex'}`}
      aria-label="Навигация кабинета"
    >
      <div className="mb-6 flex items-baseline gap-3 border-b border-line pb-5">
        <span aria-hidden className="font-serif text-3xl leading-none text-accent">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate font-serif text-base leading-snug text-ink">{name}</p>
          <p className="truncate font-mono text-[11px] text-muted">{email}</p>
        </div>
      </div>

      <div>
        {items.map((item) => {
          const active =
            item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={active ? 'page' : undefined}
              className={`relative -ml-3.5 flex items-center gap-3 border-b border-line py-2.5 pl-3.5 text-sm transition-colors ${
                active ? 'font-semibold text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  // При включённом reduced-motion переход мгновенный, но сам
                  // элемент остаётся: положение активного пункта по-прежнему
                  // видно, просто без движения.
                  transition={reduceMotion ? { duration: 0 } : undefined}
                  className="absolute left-0 top-0 h-full w-0.5 bg-accent"
                />
              )}
              <Icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto pt-8">
        <div className="border-t-2 border-ink pt-4">
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
            onClick={onClose}
            className="-my-1 mt-3 inline-flex min-h-11 items-center gap-2 border-b border-ink py-1 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Управлять тарифом
            <span aria-hidden>→</span>
          </Link>
        </div>

        <button
          type="button"
          onClick={logout}
          disabled={busy}
          className="mt-6 flex items-center gap-3 border-b border-line pb-2.5 text-sm text-muted transition-colors hover:text-danger"
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          {busy ? 'Выход…' : 'Выйти'}
        </button>
      </div>
    </nav>
  );
}
