import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import {
  DIRECTION_LABELS,
  WORK_MODE_LABELS,
  availableDirections,
  findGigs,
  gigCounts,
  type Gig,
} from '@/lib/gigs';
import type { Direction, WorkMode } from '@/lib/direction';
import type { Level } from '@/lib/data';
import { Panel } from '@/components/dashboard/ui';
import { Section, SectionHead } from '@/components/ui';

export const metadata: Metadata = { title: 'Подработка и фриланс' };
export const dynamic = 'force-dynamic';

const MODES: WorkMode[] = ['подработка', 'фриланс'];
const LEVELS: Level[] = ['Intern', 'Junior', 'Middle', 'Senior'];

type Search = {
  mode?: WorkMode;
  dir?: Direction;
  level?: Level;
};

/**
 * Подработка и фриланс.
 *
 * Фильтр, а не список: человек приходит с запросом «подработка на вечер,
 * фронтенд, джуном», и без направления и грейда такой запрос превращается в
 * «вот всё, ищи сам».
 *
 * Обещания здесь нет ровно потому, что его не может быть: источники конечны,
 * подработка на hh попадает в ленту по формулировкам в тексте вакансии, а
 * структурное поле площадки отсюда проверить нельзя — поиск требует токена
 * приложения и отдаёт 403 на любые параметры, включая рабочие. Поэтому пустой
 * результат показывается как пустой результат, а не списывается на «обновите
 * позже».
 */
export default async function GigsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const sp = await searchParams;
  const mode = MODES.includes(sp.mode as WorkMode) ? (sp.mode as WorkMode) : undefined;
  const direction =
    sp.dir && DIRECTION_LABELS[sp.dir as Direction] ? (sp.dir as Direction) : undefined;
  const level = LEVELS.includes(sp.level as Level) ? (sp.level as Level) : undefined;

  const gigs = findGigs({ mode, direction, level });
  const counts = gigCounts({});
  const directions = availableDirections(mode);

  const qs = (next: { mode?: WorkMode; direction?: Direction; level?: Level }): string => {
    const p = new URLSearchParams();
    const merged = { mode, direction, level, ...next };
    if (merged.mode) p.set('mode', merged.mode);
    if (merged.direction) p.set('dir', merged.direction);
    if (merged.level) p.set('level', merged.level);
    return p.toString();
  };

  return (
    <>
      <Section className="border-t-0 pt-16 md:pt-24">
        <SectionHead
          center={false}
          eyebrow="Подработка"
          level="h1"
          title={
            <>
              Работа <span className="text-accent">по часам</span> и заказы
            </>
          }
          sub="Подработка с частичной занятостью и заказы с фриланс-досок. Это разные вещи, поэтому и фильтра два: заказ — не подработка."
        />

        <div className="mt-6 flex flex-wrap gap-2">
          <FilterChip
            href={`/dashboard/gigs?${qs({ mode: undefined, direction: undefined, level: undefined })}`}
            active={!mode}
          >
            Всё ({counts.всего})
          </FilterChip>
          {MODES.map((m) => (
            <FilterChip key={m} href={`/dashboard/gigs?${qs({ mode: m })}`} active={mode === m}>
              {WORK_MODE_LABELS[m]} ({m === 'подработка' ? counts.подработка : counts.фриланс})
            </FilterChip>
          ))}
        </div>

        {directions.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <FilterChip
              href={`/dashboard/gigs?${qs({ direction: undefined })}`}
              active={!direction}
            >
              Любое направление
            </FilterChip>
            {directions.map((d) => (
              <FilterChip
                key={d.key}
                href={`/dashboard/gigs?${qs({ direction: d.key })}`}
                active={direction === d.key}
              >
                {d.label} ({d.count})
              </FilterChip>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <FilterChip href={`/dashboard/gigs?${qs({ level: undefined })}`} active={!level}>
            Любой грейд
          </FilterChip>
          {LEVELS.map((l) => (
            <FilterChip key={l} href={`/dashboard/gigs?${qs({ level: l })}`} active={level === l}>
              {l}
            </FilterChip>
          ))}
        </div>

        <div className="mt-8 space-y-3">
          {gigs.length === 0 ? (
            <EmptyGigs mode={mode} direction={direction} level={level} />
          ) : (
            <>
              <p className="text-sm text-muted">
                Нашлось {gigs.length} из каталога. Заказы отправляются на площадке — автоматической
                отправки на фриланс-досках нет и быть не может.
              </p>
              {gigs.map((g) => (
                <GigCard key={g.slug} gig={g} />
              ))}
            </>
          )}
        </div>
      </Section>
    </>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'border border-ink bg-ink px-3.5 py-1.5 text-sm text-paper transition-colors'
          : 'border border-line bg-surface px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-accent-2/40 hover:text-ink'
      }
    >
      {children}
    </Link>
  );
}

function GigCard({ gig }: { gig: Gig }) {
  return (
    <Panel>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-serif text-lg leading-snug text-ink">{gig.title}</h2>
        <span className="font-mono text-xs tabular-nums text-muted">{gig.posted}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
        {gig.company ? <span>{gig.company}</span> : null}
        <span>{gig.city}</span>
        <span>{gig.level}</span>
        <span>{gig.directionLabel}</span>
        <span>{gig.sourceLabel}</span>
        {gig.mode === 'подработка' && gig.employment ? (
          <span className="border border-line px-1.5 py-0.5 text-xs">{gig.employment}</span>
        ) : null}
      </div>
      {gig.sourceUrl ? (
        <a
          href={gig.sourceUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-3 inline-block text-sm font-medium text-accent-2 underline-offset-2 hover:underline"
        >
          Открыть на площадке →
        </a>
      ) : (
        <p className="mt-3 text-sm text-muted">
          Ссылка на площадку недоступна — заказ виден в разделе подбора.
        </p>
      )}
    </Panel>
  );
}

function EmptyGigs({
  mode,
  direction,
  level,
}: {
  mode?: WorkMode;
  direction?: Direction;
  level?: Level;
}) {
  const narrow = Boolean(direction || level);
  return (
    <Panel>
      <p className="text-sm leading-relaxed text-muted">
        {narrow
          ? 'Под выбранный фильтр ничего не подошло.'
          : 'Подработки и заказов в каталоге сейчас нет.'}{' '}
        {narrow
          ? 'Снимите часть фильтров — так бывает, когда направление выбрано точнее, чем то, что площадки публикуют.'
          : 'Источники конечны, и пустой список — это факт, а не сбой: подработка публикуется на hh и собирается из текста вакансий, а заказы — с фриланс-досок, где сегодня может быть тихо.'}
      </p>
      {narrow ? (
        <Link
          href="/dashboard/gigs"
          className="mt-3 inline-block text-sm font-medium text-accent-2 underline-offset-2 hover:underline"
        >
          Снять фильтры →
        </Link>
      ) : mode === 'фриланс' ? (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Заказы появляются волнами и могут закончиться за день: несколько десятков заказов
          удерживают ленту, потом она пустеет. Обновление — раз в сутки. На заказы отклик
          отправляется на самой площадке, автоматической отправки нет.
        </p>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Подработка обычно появляется в течение дня. Автоотклик на подработку работает так же, как
          на основную работу, — с паузами и лимитами; заказы с фриланс-досок отправляются вручную.
        </p>
      )}
    </Panel>
  );
}
