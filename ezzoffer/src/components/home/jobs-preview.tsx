import Link from 'next/link';
import { Section, Eyebrow } from '@/components/ui';
import { jobs } from '@/lib/data';

/*
 * Превью вакансий на главной.
 *
 * Раньше это была та же сетка карточек, что и на /jobs, плюс «LevelPill» —
 * пилюля с обводкой. Пилюля кодировала уровень цветом фона, а цвет на
 * бумаге приходилось выбирать под тёмную тему предыдущей версии.
 *
 * Теперь уровень — это слово моноширинным, без подложки: читается как
 * рубрика в объявлении, а не как ярлык в интерфейсе.
 */

export function LevelPill({ level }: { level: string }) {
  return (
    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{level}</span>
  );
}

export function JobsPreview() {
  const preview = jobs.slice(0, 6);

  return (
    <Section>
      <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <Eyebrow>Вакансии со всего рынка</Eyebrow>
          <h2 className="display mt-4 text-3xl text-balance md:text-5xl">
            Тысячи вакансий — <span className="text-accent">в одном месте</span>
          </h2>
        </div>
        <Link
          href="/jobs"
          className="inline-flex w-fit items-center gap-2 -my-1 inline-flex min-h-11 items-center border-b border-ink py-1 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
        >
          Смотреть все вакансии
          <span aria-hidden>→</span>
        </Link>
      </div>

      {/* Пять вакансий строкой, как рубрика в газете: превью показывает
          формат данных, а не пытается быть каталогом. */}
      <div className="border-t-2 border-ink">
        {preview.map((job) => (
          <Link
            key={job.slug}
            href={`/jobs/${job.slug}`}
            className="group flex flex-col gap-2 border-b border-line py-5 transition-colors hover:bg-surface-2 md:flex-row md:items-baseline md:gap-8 md:px-4"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted md:w-24 md:shrink-0">
              {job.level}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-serif text-lg leading-snug text-ink group-hover:text-accent">
                {job.title}
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                {job.company} · {job.city} · {job.format}
              </span>
            </span>
            <span className="shrink-0 font-mono text-sm tabular-nums text-ink md:w-40 md:text-right">
              {job.salary}
            </span>
          </Link>
        ))}
      </div>
    </Section>
  );
}
