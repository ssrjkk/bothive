import Link from 'next/link';
import { jobs, type Job } from '@/lib/data';

/*
 * Список вакансий.
 *
 * Прежняя версия — сетка карточек: логотип из двух букв в градиентной
 * плашке, «пилюля» уровня, виляющая карточка при наведении и пульсирующая
 * точка «свежести». Список вакансий — это табличные данные: их читают,
 * сравнивают по зарплате и уровню, и карточная сетка для этого хуже
 * обычного списка — сравнивать не с чем.
 *
 * Теперь это полоса в газетном стиле: строки, разделённые линейками,
 * колонки с фиксированным смыслом. На узком экране строка складывается
 * в два блока, но порядок «должность → компания → деньги» сохраняется.
 */

function levelTone(level: Job['level']): string {
  return {
    Intern: 'text-accent-2',
    Junior: 'text-accent-2',
    Middle: 'text-ink',
    Senior: 'text-ink',
  }[level];
}

function JobRow({ job }: { job: Job }) {
  return (
    <Link
      href={`/jobs/${job.slug}`}
      className="group block border-b border-line py-6 transition-colors hover:bg-surface-2 md:px-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-baseline md:gap-8">
        {/* Уровень и компания — узкая колонка */}
        <div className="flex items-baseline gap-3 md:w-44 md:shrink-0 md:flex-col md:gap-1">
          <span
            className={`font-mono text-[11px] uppercase tracking-[0.14em] ${levelTone(job.level)}`}
          >
            {job.level}
          </span>
          <span className="text-sm text-muted">{job.company}</span>
        </div>

        {/* Должность — главное, поэтому самая широкая колонка */}
        <div className="min-w-0 flex-1">
          <p className="font-serif text-xl leading-snug text-ink group-hover:text-accent">
            {job.title}
          </p>
          <p className="mt-1 text-xs text-muted">
            {job.category} · {job.city} · {job.format}
          </p>
        </div>

        {/* Деньги моноширинным: цифры в одной колонке выравниваются,
            и их можно сравнивать не читая каждую строку целиком. */}
        <div className="shrink-0 md:w-40 md:text-right">
          <p className="font-mono text-sm tabular-nums text-ink">{job.salary}</p>
          <p className="mt-1 font-mono text-[11px] text-muted">{job.posted}</p>
        </div>
      </div>
    </Link>
  );
}

export function JobsGrid() {
  return (
    <div>
      {/* Шапка колонок — только на широком экране, где есть смысл
          в горизонтальном сравнении. */}
      <div className="hidden border-b-2 border-ink pb-3 md:flex md:gap-8 md:px-4">
        <span className="w-44 shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Уровень · компания
        </span>
        <span className="flex-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Вакансия
        </span>
        <span className="w-40 shrink-0 text-right font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
          Зарплата
        </span>
      </div>

      <div>
        {jobs.map((job) => (
          <JobRow key={job.slug} job={job} />
        ))}
      </div>
    </div>
  );
}
