import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getStats, type Stats } from '@/lib/stats';
import { isPlanActive, planDailyLimit, planLabel, daysLeft } from '@/lib/plans';
import { StatsPanel } from '@/components/dashboard/stats-panel';
import { NextActionsPanel } from '@/components/dashboard/next-actions';
import { nextActions } from '@/lib/pipeline';
import { Badge, Panel, btnPrimary, btnGhost } from '@/components/dashboard/ui';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Обзор' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const stats = getStats(user.id);
  const actions = nextActions(user.id);
  const active = isPlanActive(user);
  const limit = planDailyLimit(user.plan);
  const days = daysLeft(user);

  return (
    <div className="space-y-8">
      {/*
        Панель приветствия. Раньше — градиент с двумя размытыми пятнами и
        «стеклянная» рамка: на бумаге это давало серую подложку с
        фиолетовым туманом, то есть оформление осталось от тёмной темы.
        Теперь — плоская поверхность с линейкой сверху: приветствие
        читается как заголовок раздела, а не как баннер.
      */}
      <div className="border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-serif text-2xl leading-snug sm:text-3xl">
                Добро пожаловать{user.name ? `, ${user.name}` : ''}
              </h1>
              <Badge tone={active ? 'success' : 'warn'}>{active ? 'Активен' : 'Не активен'}</Badge>
            </div>
            <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed text-muted sm:text-sm">
              {active
                ? `Тариф «${planLabel(user)}» · ${limit} откликов/день · осталось ${days} дн.`
                : 'Активируйте пробный период, чтобы запустить автоматические отклики.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/dashboard/jobs" className={btnPrimary}>
              <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path
                  d="m21 21-4.3-4.3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              Каталог вакансий
            </Link>
            <Link href="/dashboard/applications" className={btnGhost}>
              <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
                <path
                  d="m22 2-7 20-4-9-9-4 20-7Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
              Мои отклики
            </Link>
          </div>
        </div>
      </div>

      {/*
        Что делать дальше — первым. Человек открыл кабинет с вопросом
        «что делать», и статистика на этот вопрос не отвечает: она отвечает
        на другой («как идут дела»). Ставить её первой было значит перехватить
        внимание, не дав ответить на главный.
      */}
      <NextActionsPanel actions={actions} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Отправлено" value={stats.sent} trend={weeklyTrend(stats.series, 'sent')} />
        <StatCard
          label="Просмотрено"
          value={stats.viewed}
          trend={weeklyTrend(stats.series, 'viewed')}
        />
        <StatCard
          label="Ответов HR"
          value={stats.responded}
          trend={weeklyTrend(stats.series, 'responded')}
        />
        <StatCard
          label="Приглашения"
          value={stats.invited}
          trend={weeklyTrend(stats.series, 'invited')}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <StatsPanel initial={stats} />
        </div>
        <div className="space-y-4">
          <Panel>
            <h3 className="font-serif text-lg leading-snug text-ink">Быстрые действия</h3>
            <div className="mt-3">
              <QuickLink href="/dashboard/resumes" label="Загрузить резюме" />
              <QuickLink href="/dashboard/letters" label="Настроить письмо" />
              <QuickLink href="/dashboard/consultations" label="Консультации" />
              <QuickLink href="/dashboard/settings" label="Настройки аккаунта" />
            </div>
          </Panel>
          <Panel>
            <h3 className="font-serif text-lg leading-snug text-ink">Статистика за неделю</h3>
            <div className="mt-4 space-y-3">
              {stats.series.length === 0 ? (
                <p className="text-sm text-muted">Пока нет данных за неделю.</p>
              ) : (
                weekRows(stats).map((row) => (
                  <WeekRow key={row.day} day={row.day} value={row.value} max={row.max} />
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

type Series = Stats['series'];
type SeriesKey = 'sent' | 'viewed' | 'responded' | 'invited';

/**
 * Раньше карточки и «недельная» таблица были зашиты на константы (+12%, 12/18/15/20…),
 * то есть показывали выдуманные числа рядом с реальной статистикой из getStats.
 * Теперь обе витрины считаются по той же series, что и график в StatsPanel.
 */
function weeklyTrend(series: Series, key: SeriesKey): string | null {
  const totals = series.reduce(
    (acc, d) => {
      acc.sent += d.sent;
      acc.viewed += d.viewed;
      acc.invited += d.invited;
      acc.responded += d.viewed > 0 ? d.sent - d.viewed : 0;
      return acc;
    },
    { sent: 0, viewed: 0, invited: 0, responded: 0 } as Record<SeriesKey, number>,
  );
  const total = totals[key];
  if (total === 0) return null;
  const week = Math.round(total / series.length);
  return week > 0 ? `~${week}/день` : null;
}

function weekRows(stats: Stats): { day: string; value: number; max: number }[] {
  const max = Math.max(1, ...stats.series.map((d) => d.sent));
  return stats.series.map((d) => ({ day: d.label, value: d.sent, max }));
}

function StatCard({ label, value, trend }: { label: string; value: number; trend: string | null }) {
  return (
    <div className="border border-line bg-surface p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</p>
      {/* Число моноширинным: четыре карточки в ряд выравниваются по
          разрядам, и их можно сравнивать не читая подписи. Раньше здесь
          стоял эмодзи-иконка, которая ничего не кодировала. */}
      <p className="mt-3 font-mono text-3xl tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-xs text-muted">{trend ?? 'за неделю нет данных'}</p>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between border-b border-line py-2.5 text-sm text-ink transition-colors last:border-b-0 hover:text-accent"
    >
      {label}
      <span aria-hidden className="text-muted transition-transform group-hover:translate-x-0.5">
        →
      </span>
    </Link>
  );
}

/**
 * Строка недельного графика.
 *
 * Полоса была градиентом фиолетовый→циан: два оттенка на элементе,
 * который показывает одно число. Теперь одна заливка акцентом, а сам
 * ряд — полосами строк, как в сводке.
 */
function WeekRow({ day, value, max }: { day: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 border-b border-line pb-2 last:border-b-0">
      <span className="w-6 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{day}</span>
      <div className="h-1.5 flex-1 bg-line">
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right font-mono text-xs tabular-nums text-ink">{value}</span>
    </div>
  );
}
