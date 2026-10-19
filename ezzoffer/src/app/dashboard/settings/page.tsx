import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isPlanActive, planDailyLimit, planLabel, daysLeft } from '@/lib/plans';
import { catalogItem } from '@/lib/payments/catalog';
import { PlanSettings } from '@/components/dashboard/plan-settings';
import { ProfileForm } from '@/components/dashboard/profile-form';
import { HhConnect } from '@/components/dashboard/hh-connect';
import { ModeSwitch } from '@/components/dashboard/mode-switch';
import { AutoApplyPause } from '@/components/dashboard/autoapply-pause';
import { TelegramConnect } from '@/components/dashboard/telegram-connect';
import { isHhConnected } from '@/lib/hh-oauth';

export const metadata: Metadata = { title: 'Настройки' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const active = isPlanActive(user);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl leading-snug text-ink">Настройки</h1>
        <p className="mt-1 text-sm text-muted">Профиль, тариф и данные аккаунта.</p>
      </div>

      <HhConnect />

      <ModeSwitch initialMode={user.mode} hhConnected={isHhConnected(user)} />

      <TelegramConnect />

      <AutoApplyPause initialPaused={Boolean(user.autoapply_paused)} />

      <PlanSettings
        plan={user.plan}
        planLabel={planLabel(user)}
        active={active}
        planDays={daysLeft(user)}
        planLimit={active ? planDailyLimit(user.plan) : 0}
        planPermanent={Boolean(catalogItem(user.plan)?.permanent)}
        trialStarted={Boolean(user.trial_started_at)}
        trialExpiresAt={user.plan_expires_at}
      />

      <ProfileForm
        name={user.name}
        email={user.email}
        salaryExpectation={user.salary_expectation ?? null}
        cityPreference={user.city_preference ?? ''}
      />
    </div>
  );
}
